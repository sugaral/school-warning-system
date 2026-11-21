import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { ConfigService as SystemConfigService } from '../config/config.service';
import {
  isEmailConfigReady,
  normalizeEmailConfig,
  sendEmail,
} from '../shared/email.util';
import { RedisService } from '../shared/redis.service';
import { PrismaService } from '../shared/prisma.service';
import {
  NotificationCenterService,
} from '../shared/notification-center.service';
import { renderTemplate } from '../shared/template.util';
import { WarningCasesService } from '../warning-cases/warning-cases.service';
import {
  getAcademicWeekInfo,
  resolveSemesterStartDate,
  resolveSemesterTotalWeeks,
} from '../shared/academic-calendar.util';
import { serializeForAudit } from '../shared/json.util';
import { WarningProcessingService } from './warning-processing.service';
import { WarningSnapshotService } from './warning-snapshot.service';
import {
  MergedWarningRecalcTarget,
  WarningRecalcTarget,
} from './warning.types';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = 'Asia/Shanghai';
const CACHE_TTL = 5 * 60 * 1000;
const WINDOW_ORDER = ['day', 'week', 'month', 'term'];
const DEFAULT_METRICS = ['late', 'absent', 'early_leave'];
const CUMULATIVE_WARNING_METRIC = 'warning_total';
const ENABLE_CUMULATIVE_WARNING =
  String(process.env.ENABLE_CUMULATIVE_WARNING || '').toLowerCase() === 'true' ||
  String(process.env.ENABLE_CUMULATIVE_WARNING || '') === '1';
const ATTENDANCE_METRICS = [...DEFAULT_METRICS];

/**
 * P1-6 扩展指标：`daily_records` 上的非考勤类指标。
 *
 * 这些字段以前没有录入入口（10 处写入点硬编码 homework_status='unknown'，
 * class_behavior 零引用），因此这几个指标**永远无法触发**。
 * 现在配套 `POST /attendance/daily-records` 录入入口后，它们才真正可用。
 *
 * 注意：`leave` 虽然可选，但**不放进默认启用列表** —— 请假是经审批的合规行为，
 * 默认对它告警会产生大量误报。管理员可显式建规则启用。
 */
const DAILY_RECORD_FIELD_METRICS: Record<string, { field: string; value: string }> = {
  homework_not_submit: { field: 'homework_status', value: 'not_submit' },
  homework_late_submit: { field: 'homework_status', value: 'late_submit' },
  class_behavior: { field: 'class_behavior', value: 'disruptive' },
  leave: { field: 'attendance_status', value: 'leave' },
};

/**
 * 学期级学业指标（§6.1.1 的学分 / 挂科 / GPA 三项）
 *
 * 与考勤/日记录类指标的**根本差异**：这三项不是"次数累加"，而是
 * 从学期汇总表读出的**区间数值**并做「越低越危险 / 越高越危险」比较：
 *   - failed_courses ：挂科门数，**≥ 阈值** 触发（同其它指标方向）
 *   - credits        ：已修学分，**< 阈值** 触发（方向相反）
 *   - gpa            ：平均绩点，**< 阈值** 触发（方向相反）
 *
 * 数据源是 P1-5 落地的 term_summaries（由学期汇总任务按
 * grades + courses.credit 计算），因此必须保证汇总先跑。
 */
const TERM_SUMMARY_METRICS: Record<string, { field: string; compare: 'gte' | 'lt' }> = {
  failed_courses: { field: 'failed_course_count', compare: 'gte' },
  credits: { field: 'earned_credits', compare: 'lt' },
  gpa: { field: 'gpa', compare: 'lt' },
};

/**
 * 学期级指标的**阈值单位约定**（务必与规则配置保持一致）
 *
 * 引擎内部以整数做阈值比较（避免浮点误差，且 warning_rules.threshold 是 Int），
 * 因此对小数类指标做定点放大：
 *   - gpa     × 100  → 阈值 200 表示「GPA < 2.00」
 *   - credits × 10   → 阈值 1200 表示「已修学分 < 120.0」
 *   - failed_courses × 1（整数，无需放大）→ 阈值 3 表示「挂科 ≥ 3 门」
 *
 * 前端规则配置页与文档必须使用同一套口径，否则会出现
 * 「配了 2 却希望表示 GPA 2.0」这类 100 倍误配。
 */
const TERM_METRIC_SCALE: Record<string, number> = {
  failed_courses: 1,
  credits: 10,
  gpa: 100,
};

export const TERM_METRIC_THRESHOLD_UNITS: Record<string, string> = {
  failed_courses: '门（整数）',
  credits: '×10（如 1200 = 120.0 学分）',
  gpa: '×100（如 200 = 2.00）',
};

/**
 * 指标 → 该指标自己的计数占位符（P1-11 第三批）
 *
 * 用于 buildCountParams 的兜底：单指标预警的 trigger_detail_json
 * （buildTriggerDetail :3355）只写 `violation_count`，不写分指标键，
 * 而模板会直接引用 `{late_count}` / `{absent_count}`。
 * 当 metric='late' 时，迟到次数就等于该预警的 violation_count。
 *
 * 取值必须与 buildCourseAggregateTriggerDetail（:1963-1965）和
 * session-warning-generation.service.ts（:246-248）的键名保持一致。
 */
const METRIC_COUNT_PARAM: Record<string, string> = {
  late: 'late_count',
  absent: 'absent_count',
  early_leave: 'early_leave_count',
  leave: 'leave_count',
  homework_not_submit: 'homework_not_submit_count',
  homework_late_submit: 'homework_late_submit_count',
  class_behavior: 'class_behavior_count',
};

/**
 * 指标的「危险方向」（修复：lower-is-worse 指标被误判）
 *
 * 引擎原本统一按 `count >= threshold` 匹配规则，这对"次数越多越危险"的
 * 指标成立（迟到、缺勤、挂科…），但对**越低越危险**的指标完全失效：
 * 实测发现 GPA 3.40（很优秀）反而触发了 red 预警 —— 因为 340 >= 200。
 *
 * 因此为每个指标显式声明危险方向：
 *   'higher' —— 值越高越危险，count >= threshold 触发（默认）
 *   'lower'  —— 值越低越危险，count <= threshold 触发
 */
const METRIC_RISK_DIRECTION: Record<string, 'higher' | 'lower'> = {
  credits: 'lower',
  gpa: 'lower',
};

/** 按指标的危险方向判断是否命中阈值 */
function isThresholdHit(metric: string, value: number, threshold: number): boolean {
  const direction = METRIC_RISK_DIRECTION[metric] || 'higher';
  return direction === 'lower' ? value <= threshold : value >= threshold;
}

/** 未确认预警数：读 warnings.acknowledged_at 为空且仍处于活动状态的条数 */
const UNACKNOWLEDGED_METRIC = 'unacknowledged';

const SUPPORTED_METRICS = new Set([
  ...DEFAULT_METRICS,
  CUMULATIVE_WARNING_METRIC,
  ...Object.keys(DAILY_RECORD_FIELD_METRICS),
  ...Object.keys(TERM_SUMMARY_METRICS),
  UNACKNOWLEDGED_METRIC,
]);
const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];
const TRANSACTION_RETRY_LIMIT = 3;
const DEFAULT_WARNING_TRANSACTION_TIMEOUT_MS = 30_000;
const DEFAULT_WARNING_TRANSACTION_MAX_WAIT_MS = 10_000;
const DEFAULT_WARNING_SYNC_RECALC_CONCURRENCY = 6;
const DEFAULT_WARNING_STUDENT_LOCK_TTL_MS = 30_000;
const DEFAULT_WARNING_STUDENT_LOCK_RETRY_COUNT = 3;
const DEFAULT_WARNING_STUDENT_LOCK_RETRY_DELAY_MS = 80;

type StudentContext = {
  id: bigint;
  class_id: bigint;
  org_id: bigint | null;
  /**
   * users.id
   *
   * 站内消息表 `notification.user_id` 指向它（不是 student_profiles.id）。
   * 引擎在加载学生上下文时必须带上，否则无法写站内消息。
   */
  user_id?: bigint | null;
  email?: string | null;
  users?: {
    name: string | null;
    email: string | null;
  } | null;
};

type WarningPostCommitTask =
  | {
      type: 'warning_notification';
      warningId: bigint;
      studentId: bigint;
      warningLevel: string;
      warningWindow: string;
      warningMetric: string;
      notifyStrategy: any;
      student: StudentContext;
      triggerSummary: string;
      /** P1-1：参与频控键构造，保证不同规则之间互不压制 */
      ruleId?: bigint | number | null;
      /** P1-1：参与频控键构造，保证跨周期不误杀 */
      periodStart?: Date | string | null;
    }
  | {
      type: 'absent_threshold_email';
      warningId: string;
      studentId: string;
      studentName: string;
      studentEmail: string;
      warningLevel: string;
      warningWindow: string;
      absentCount: number;
      triggerSummary: string;
    }
  | {
      type: 'warning_case_sync';
      studentId: bigint;
      student: StudentContext;
    };

type WarningEmailConfig = {
  enabled: boolean;
  threshold: number;
  templateCode: string;
  maxPerHour: number;
};

type WarningTriggerContext = {
  sessionId: string | null;
  sessionStart: Date | null;
  triggerAt: Date | null;
};

type WarningWindowContext = {
  weekNumber?: number;
  weekLabel?: string;
};

type CourseAggregate = {
  courseId: bigint | null;
  count: number;
};

type AttendanceAggregateRow = {
  course_id: bigint | number | string | null;
  total_count: bigint | number | string;
};

type AttendanceCoveredKeyRow = {
  session_date_key: string;
  course_id: bigint | number | string | null;
  attendance_status?: string;
};

type WarningEvaluationResult = {
  warnings_generated: number;
  skipped_locked?: boolean;
  lock_attempts?: number;
};

type WarningEmailQuotaRow = {
  sent_count: bigint | number | string | null;
  oldest_sent_at: Date | string | null;
};

type WarningDeletionIdentity = {
  student_id: bigint;
  metric: string;
  level: string;
  window: string;
  period_start: Date;
  period_end: Date;
  course_id?: bigint | null;
};

type WarningPendingJob = {
  id: bigint;
};


@Injectable()
export class WarningService {
  private readonly logger = new Logger(WarningService.name);
  private rulesCache: any[] | null = null;
  private rulesCacheTime = 0;
  private postCommitTaskQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly warningCasesService: WarningCasesService,
    private readonly systemConfigService: SystemConfigService,
    private readonly warningSnapshotService: WarningSnapshotService,
    private readonly warningProcessingService: WarningProcessingService,
    private readonly notificationCenter: NotificationCenterService,
  ) {}

  invalidateRulesCache() {
    this.rulesCache = null;
    this.rulesCacheTime = 0;
  }

  private isRetryableTransactionError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2034' || error.code === 'P2028';
    }

    return /write conflict|deadlock|transaction already closed|expired transaction/i.test(
      String((error as any)?.message || error || ''),
    );
  }

  private async withTransactionRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= TRANSACTION_RETRY_LIMIT; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        lastError = error;
        if (!this.isRetryableTransactionError(error) || attempt >= TRANSACTION_RETRY_LIMIT) {
          throw error;
        }

        const delayMs = attempt * 120;
        this.logger.warn(
          `[预警] ${label} 发生写冲突，第 ${attempt} 次重试，${delayMs}ms 后再次执行`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  private async getRules(forceRefresh = false): Promise<any[]> {
    const now = Date.now();
    if (!forceRefresh && this.rulesCache && now - this.rulesCacheTime < CACHE_TTL) {
      return this.rulesCache;
    }

    const rules = await this.prisma.warning_rules.findMany({
      where: { enabled: true },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    });

    this.rulesCache = rules;
    this.rulesCacheTime = now;
    return rules;
  }

  async rescanAllViolations() {
    this.logger.log('[预警] 开始重扫当前预警窗口');

    const allRules = await this.getRules();
    const concurrency = await this.getWarningRecalcConcurrency();
    let warningsGenerated = 0;
    const batchSize = 100;
    let skip = 0;

    while (true) {
      const students = await this.prisma.student_profiles.findMany({
        skip,
        take: batchSize,
        select: {
          id: true,
          // 站内消息表 notification.user_id 指向 users.id
          user_id: true,
          class_id: true,
          org_id: true,
          email: true,
          users: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (students.length === 0) {
        break;
      }

      const referenceDate = new Date();
      const workerCount = Math.min(concurrency, students.length);
      let nextIndex = 0;

      const totals = await Promise.all(
        Array.from({ length: workerCount }, async () => {
          let subtotal = 0;

          while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= students.length) {
              return { warningsGenerated: subtotal };
            }

            const student = students[currentIndex];

            try {
              const result = await this.evaluateStudentRules(student, referenceDate, allRules);
              subtotal += result.warnings_generated;
            } catch (error: any) {
              this.logger.error(
                `[预警] 重扫学生 ${student.id.toString()} 失败`,
                error?.stack || error?.message || String(error),
              );
            }
          }
        }),
      );

      warningsGenerated += totals.reduce((sum, item) => sum + item.warningsGenerated, 0);

      await this.warningSnapshotService.refreshStudents(students.map((student) => student.id));
      skip += batchSize;
      await new Promise((resolve) => setImmediate(resolve));
    }

    this.logger.log(`[预警] 重扫完成，本轮生成 ${warningsGenerated} 条预警`);

    const result = {
      rules_processed: allRules.length,
      warnings_generated: warningsGenerated,
    };

    this.prisma.audit_logs.create({
      data: {
        actor_user_id: 0n,
        action: 'warning.rescan_all',
        entity_type: 'warning',
        entity_id: 0n,
        after_json: serializeForAudit(result) as any,
        ip: '',
        user_agent: 'system',
      },
    }).catch(() => {});

    return result;
  }

  /**
   * 预警起算日（WARNING_BASELINE_DATE，格式 YYYY-MM-DD，按东八区零点计）。
   *
   * 用途：业务上要求「预警从某一天开始算」，早于该日期的异常不再产生/复活预警。
   * 未配置或格式非法时返回 null（即不设下限，保持原有行为）。
   */
  private getWarningBaselineDate(): Date | null {
    const raw = String(process.env.WARNING_BASELINE_DATE || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return null;
    }
    const parsed = new Date(`${raw}T00:00:00+08:00`);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  /** 该记录日期是否早于预警起算日（早于则不应再产生预警） */
  private isBeforeWarningBaseline(recordDate: Date): boolean {
    const baseline = this.getWarningBaselineDate();
    if (!baseline || !(recordDate instanceof Date) || !Number.isFinite(recordDate.getTime())) {
      return false;
    }
    return recordDate.getTime() < baseline.getTime();
  }

  async generateWarningForStudent(
    studentId: bigint,
    recordDate: Date,
    courseId?: bigint,
    options?: {
      skipSnapshotRefresh?: boolean;
    },
  ) {
    const startedAt = Date.now();

    // 起算日之前的记录直接跳过，避免清理掉的远古预警被重算复活
    if (this.isBeforeWarningBaseline(recordDate)) {
      this.logger.log(
        `[预警][学生] 跳过（早于预警起算日 ${String(process.env.WARNING_BASELINE_DATE || '')}） 学生=${studentId.toString()} 日期=${this.toDateOnlyKey(recordDate)}`,
      );
      return { warnings_generated: 0 } as WarningEvaluationResult;
    }

    this.logger.log(
      `[预警][学生] 开始 学生=${studentId.toString()} 日期=${this.toDateOnlyKey(recordDate)} 课程=${courseId?.toString?.() || '全部'} 跳过快照=${Boolean(options?.skipSnapshotRefresh)}`,
    );
    const allRules = await this.getRules();
    const student = await this.getStudentContext(studentId);
    if (!student) {
      this.logger.warn(
        `[预警][学生] 跳过缺失学生 学生=${studentId.toString()} 耗时=${Date.now() - startedAt}ms`,
      );
      return { warnings_generated: 0 };
    }

    const result = await this.syncStudentWarningCounters(student, recordDate, allRules, courseId);
    if (!options?.skipSnapshotRefresh && !result?.skipped_locked) {
      await this.warningSnapshotService.refreshStudents([student.id]);
    }

    this.logger.log(
      `[预警][学生] 完成 学生=${studentId.toString()} 耗时=${Date.now() - startedAt}ms 新建=${Number(result?.warnings_generated || 0)} 跳过锁=${Boolean(result?.skipped_locked)} 锁尝试=${Number(result?.lock_attempts || 0)}`,
    );

    return result;
  }

  private async syncStudentWarningCounters(
    student: StudentContext,
    referenceDate: Date,
    rules: any[],
    courseId?: bigint,
  ): Promise<WarningEvaluationResult> {
    const effectiveRules = this.resolveEffectiveRules(rules, student);
    const attendanceMetrics = Array.from(
      new Set([
        ...DEFAULT_METRICS,
        ...effectiveRules
          .map((rule) => String(rule.metric || '').trim())
          .filter((metric) => DEFAULT_METRICS.includes(metric)),
      ]),
    );
    const cumulativeMetricEnabled = effectiveRules.some(
      (rule) => String(rule.metric || '').trim() === CUMULATIVE_WARNING_METRIC,
    );

    const [transactionTimeoutMs, transactionMaxWaitMs] = await Promise.all([
      this.getWarningTransactionTimeoutMs(),
      this.getWarningTransactionMaxWaitMs(),
    ]);
    const transactionOptions = {
      maxWait: transactionMaxWaitMs,
      timeout: transactionTimeoutMs,
    };

    let warningsGenerated = 0;
    const postCommitTasks: WarningPostCommitTask[] = [];

    const lockResult = await this.withWarningStudentLock(student.id, async () => {
      warningsGenerated = 0;
      postCommitTasks.length = 0;

      for (const windowType of WINDOW_ORDER) {
        const attendanceRulesForWindow = effectiveRules
          .filter(
            (rule) =>
              attendanceMetrics.includes(String(rule.metric || '').trim()) &&
              String(rule.window || '').trim() === windowType,
          )
          .sort((left, right) => right.threshold - left.threshold);

        const windowPostCommitTasks: WarningPostCommitTask[] = [];
        let created = 0;

        if (windowType === 'day') {
          const dayEnd = new Date(referenceDate);
          dayEnd.setUTCHours(23, 59, 59, 999);
          for (const metric of attendanceMetrics) {
            const metricRulesForWindow = attendanceRulesForWindow.filter(
              (rule) => String(rule.metric || '').trim() === metric,
            );
            created += await this.executeWarningTransaction(
              `warning sync student ${student.id.toString()} ${metric}/${windowType}`,
              transactionOptions,
              async (tx) =>
                this.evaluateDailyAttendanceEventWarnings(
                  tx,
                  student,
                  metric,
                  metricRulesForWindow,
                  referenceDate,
                  dayEnd,
                  windowPostCommitTasks,
                  courseId,
                ),
            );
          }
        } else {
          created = await this.executeWarningTransaction(
            `warning sync student ${student.id.toString()} course-aggregate/${windowType}`,
            transactionOptions,
            async (tx) =>
              this.evaluateCourseWindow(
                tx,
                student,
                windowType,
                attendanceRulesForWindow,
                referenceDate,
                windowPostCommitTasks,
                courseId,
              ),
          );
        }

        warningsGenerated += Number(created || 0);
        postCommitTasks.push(...windowPostCommitTasks);

        if (!cumulativeMetricEnabled) {
          continue;
        }

        const cumulativeRulesForWindow = effectiveRules
          .filter(
            (rule) =>
              String(rule.metric || '').trim() === CUMULATIVE_WARNING_METRIC &&
              String(rule.window || '').trim() === windowType,
          )
          .sort((left, right) => right.threshold - left.threshold);
        const cumulativePostCommitTasks: WarningPostCommitTask[] = [];
        const cumulativeCreated = await this.executeWarningTransaction(
          `warning sync student ${student.id.toString()} ${CUMULATIVE_WARNING_METRIC}/${windowType}`,
          transactionOptions,
          async (tx) =>
            this.evaluateMetricWindow(
              tx,
              student,
              CUMULATIVE_WARNING_METRIC,
              windowType,
              cumulativeRulesForWindow,
              referenceDate,
              cumulativePostCommitTasks,
              undefined,
            ),
        );

        warningsGenerated += Number(cumulativeCreated || 0);
        postCommitTasks.push(...cumulativePostCommitTasks);
      }

      this.queueWarningCaseSync(postCommitTasks, student);
    });

    if (!lockResult.locked) {
      return {
        warnings_generated: 0,
        skipped_locked: true,
        lock_attempts: lockResult.attempts,
      };
    }

    this.enqueuePostCommitTasks(postCommitTasks);
    return {
      warnings_generated: warningsGenerated,
      lock_attempts: lockResult.attempts,
    };
  }

  async generateWarningsForAffectedRecords(records: WarningRecalcTarget[]) {
    return this.generateWarningsForAffectedRecordsWithOptions(records);
  }

  async generateWarningsForAffectedRecordsSync(records: WarningRecalcTarget[]) {
    return this.generateWarningsForAffectedRecordsWithOptions(records, {
      concurrencyOverride: await this.getWarningSyncRecalcConcurrency(),
      failOnError: true,
    });
  }

  async startBackgroundWarningRecalc(
    records: WarningRecalcTarget[],
    processingText = '正在生成预警',
  ) {
    const targets = this.mergeWarningRecalcTargets(records);
    if (targets.length === 0) {
      return {
        accepted: 0,
      };
    }

    const studentIds = Array.from(
      new Map(targets.map((target) => [target.studentId.toString(), target.studentId])).values(),
    );

    await Promise.all(
      studentIds.map((studentId) =>
        this.warningProcessingService.markStudentProcessing(studentId, processingText),
      ),
    );

    void this.generateWarningsForAffectedRecordsSync(records)
      .catch(async (error: any) => {
        await Promise.all(
          studentIds.map((studentId) =>
            this.warningProcessingService.markStudentFailed(
              studentId,
              '预警生成失败',
            ),
          ),
        );
        this.logger.error(
          `[预警][后台] 异步生成预警失败，学生数=${studentIds.length}`,
          error?.stack || error?.message || String(error),
        );
      });

    return {
      accepted: targets.length,
    };
  }

  async generateWarningsForAffectedRecordsWithOptions(
    records: WarningRecalcTarget[],
    options?: {
      concurrencyOverride?: number;
      failOnError?: boolean;
      collectLockedKeys?: boolean;
    },
  ) {
    const startedAt = Date.now();
    const targets = this.mergeWarningRecalcTargets(records);
    if (targets.length === 0) {
      this.logger.log('[预警][批量] 合并后无目标，无需重算');
      return {
        warnings_generated: 0,
        targets_processed: 0,
        targets_merged: 0,
        targets_locked: 0,
      };
    }

    const configuredConcurrency = await this.getWarningRecalcConcurrency();
    const concurrency = Number.isFinite(Number(options?.concurrencyOverride))
      ? Math.max(1, Math.round(Number(options?.concurrencyOverride)))
      : configuredConcurrency;
    const workerCount = Math.min(concurrency, targets.length);
    this.logger.log(
      `[预警][批量] 开始 原始=${records.length} 合并后=${targets.length} 并发=${concurrency} 工作数=${workerCount} 失败即终止=${Boolean(options?.failOnError)}`,
    );
    let nextIndex = 0;
    const processedStudentIds = new Set<string>();

    const totals = await Promise.all(
      Array.from({ length: workerCount }, async () => {
        let subtotal = 0;
        let lockedCount = 0;
        const lockedKeys: string[] = [];

        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;

          if (currentIndex >= targets.length) {
            return {
              warningsGenerated: subtotal,
              lockedCount,
              lockedKeys,
            };
          }

          const target = targets[currentIndex];

          try {
            const targetStartedAt = Date.now();
            const result = await this.generateWarningForStudent(
              target.studentId,
              target.recordDate,
              target.courseIds.length === 1 ? target.courseIds[0] : undefined,
              { skipSnapshotRefresh: true },
            );
            this.logger.log(
              `[预警][批量] 目标完成 学生=${target.studentId.toString()} 日期=${this.toDateOnlyKey(target.recordDate)} 课程=${target.courseIds.length === 1 ? target.courseIds[0].toString() : '多课程'} 耗时=${Date.now() - targetStartedAt}ms 新建=${Number(result?.warnings_generated || 0)} 跳过锁=${Boolean(result?.skipped_locked)}`,
            );
            subtotal += Number(result?.warnings_generated || 0);
            if (result?.skipped_locked) {
              lockedCount += 1;
              if (options?.collectLockedKeys) {
                lockedKeys.push(`${target.studentId.toString()}_${this.toDateOnlyKey(target.recordDate)}`);
              }
            }
            if (!result?.skipped_locked) {
              processedStudentIds.add(target.studentId.toString());
            }
          } catch (error: any) {
            if (options?.failOnError) {
              throw error;
            }
            this.logger.error(
              `[预警] 批量重算学生 ${target.studentId.toString()} 失败`,
              error?.stack || error?.message || String(error),
            );
          }
        }

      }),
    );

    const lockedKeySet = new Set<string>();
    totals.forEach((item) => {
      for (const key of item.lockedKeys || []) {
        lockedKeySet.add(key);
      }
    });

    if (processedStudentIds.size > 0) {
      await this.warningSnapshotService.refreshStudents(
        Array.from(processedStudentIds).map((studentId) => BigInt(studentId)),
      );
    }

    const batchResult = {
      warnings_generated: totals.reduce((sum, value) => sum + Number(value.warningsGenerated || 0), 0),
      targets_processed: targets.length,
      targets_merged: Math.max(0, records.length - targets.length),
      targets_locked: totals.reduce((sum, value) => sum + Number(value.lockedCount || 0), 0),
      locked_target_keys: Array.from(lockedKeySet.values()),
    };
    this.logger.log(
      `[预警][批量] 完成 耗时=${Date.now() - startedAt}ms 处理=${batchResult.targets_processed} 合并=${batchResult.targets_merged} 新建=${batchResult.warnings_generated} 锁跳过=${batchResult.targets_locked} 快照刷新=${processedStudentIds.size}`,
    );

    return batchResult;
  }

  async runDailyWarning(date?: string) {
    const targetDate = date ? dayjs.tz(date, DEFAULT_TZ).toDate() : new Date();

    // 起算日之前不做日重算（否则会把已清理的远古预警重新生成出来）
    if (this.isBeforeWarningBaseline(targetDate)) {
      this.logger.warn(
        `[预警][日重算] 跳过：目标日期 ${dayjs(targetDate).tz(DEFAULT_TZ).format('YYYY-MM-DD')} 早于预警起算日 ${String(process.env.WARNING_BASELINE_DATE || '')}`,
      );
      return {
        date: dayjs(targetDate).tz(DEFAULT_TZ).format('YYYY-MM-DD'),
        rules_processed: 0,
        warnings_generated: 0,
      };
    }
    const allRules = await this.getRules();
    const concurrency = await this.getWarningRecalcConcurrency();
    let warningsGenerated = 0;
    const batchSize = 100;
    let skip = 0;

    while (true) {
      const students = await this.prisma.student_profiles.findMany({
        skip,
        take: batchSize,
        select: {
          id: true,
          // 站内消息表 notification.user_id 指向 users.id
          user_id: true,
          class_id: true,
          org_id: true,
          email: true,
          users: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      if (students.length === 0) {
        break;
      }

      const workerCount = Math.min(concurrency, students.length);
      let nextIndex = 0;

      const totals = await Promise.all(
        Array.from({ length: workerCount }, async () => {
          let subtotal = 0;

          while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= students.length) {
              return { warningsGenerated: subtotal };
            }

            const student = students[currentIndex];

            try {
              const result = await this.evaluateStudentRules(student, targetDate, allRules);
              subtotal += result.warnings_generated;
            } catch (error: any) {
              this.logger.error(
                `[预警] 为学生 ${student.id.toString()} 执行日预警失败`,
                error?.stack || error?.message || String(error),
              );
            }
          }
        }),
      );

      warningsGenerated += totals.reduce((sum, item) => sum + item.warningsGenerated, 0);

      await this.warningSnapshotService.refreshStudents(students.map((student) => student.id));
      skip += batchSize;
      await new Promise((resolve) => setImmediate(resolve));
    }

    const result = {
      date: dayjs(targetDate).tz(DEFAULT_TZ).format('YYYY-MM-DD'),
      rules_processed: allRules.length,
      warnings_generated: warningsGenerated,
    };

    this.prisma.audit_logs.create({
      data: {
        actor_user_id: 0n,
        action: 'warning.run_daily',
        entity_type: 'warning',
        entity_id: 0n,
        after_json: serializeForAudit(result) as any,
        ip: '',
        user_agent: 'system',
      },
    }).catch(() => {});

    return result;
  }

  private buildWarningRecalcTargetKey(target: WarningRecalcTarget) {
    const dateKey = this.toDateOnlyKey(target.recordDate);
    if (!dateKey) {
      return '';
    }
    return [
      target.studentId.toString(),
      dateKey,
      target.courseId?.toString?.() || '',
      target.sessionId?.toString?.() || '',
    ].join('_');
  }

  private normalizeWarningRecalcTargetDate(value: Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  private async getNightlyReconcileRetryRounds() {
    const configured = await this.systemConfigService.getNumberConfig(
      'warning.nightlyReconcileRetryRounds',
      2,
    );
    if (!Number.isFinite(configured)) {
      return 2;
    }
    return Math.min(5, Math.max(1, Math.round(configured)));
  }

  private async getNightlyReconcileRetryDelayMs() {
    const configured = await this.systemConfigService.getNumberConfig(
      'warning.nightlyReconcileRetryDelayMs',
      800,
    );
    if (!Number.isFinite(configured)) {
      return 800;
    }
    return Math.min(5_000, Math.max(100, Math.round(configured)));
  }

  private async collectRecentWarningReconcileTargets(days = 7) {
    const safeDays = Math.min(30, Math.max(1, Math.floor(Number(days) || 7)));
    const startDate = dayjs().tz(DEFAULT_TZ).subtract(safeDays - 1, 'day').startOf('day').toDate();
    const now = new Date();
    const targetMap = new Map<string, WarningRecalcTarget>();
    const addTarget = (target: WarningRecalcTarget) => {
      const key = this.buildWarningRecalcTargetKey(target);
      if (!key) {
        return;
      }
      targetMap.set(key, target);
    };

    const [recentAttendanceRecords, legacyDailyRecords, recentWarnings] = await Promise.all([
      this.prisma.attendance_records.findMany({
        where: {
          attendance_status: { in: ATTENDANCE_METRICS },
          sessions: {
            session_start: { gte: startDate, lte: now },
          },
        },
        select: {
          student_id: true,
          session_id: true,
          sessions: {
            select: {
              session_start: true,
              course_id: true,
            },
          },
        },
      }),
      this.prisma.daily_records.findMany({
        where: {
          attendance_status: { in: ATTENDANCE_METRICS },
          record_date: { gte: startDate, lte: now },
        },
        select: {
          student_id: true,
          record_date: true,
          course_id: true,
        },
      }),
      this.prisma.warnings.findMany({
        where: {
          OR: [
            { created_at: { gte: startDate } },
            { updated_at: { gte: startDate } },
            { period_end: { gte: startDate } },
          ],
        },
        select: {
          student_id: true,
          period_end: true,
          trigger_detail_json: true,
        },
      }),
    ]);

    const coveredLegacyKeys = new Set<string>();
    for (const record of recentAttendanceRecords) {
      const recordDate = this.normalizeWarningRecalcTargetDate(
        new Date(
          Date.UTC(
            record.sessions.session_start.getFullYear(),
            record.sessions.session_start.getMonth(),
            record.sessions.session_start.getDate(),
          ),
        ),
      );
      addTarget({
        studentId: record.student_id,
        recordDate,
        courseId: record.sessions.course_id,
        sessionId: record.session_id,
      });
      coveredLegacyKeys.add(
        [
          record.student_id.toString(),
          this.toDateOnlyKey(recordDate),
          record.sessions.course_id?.toString?.() || '',
        ].join('_'),
      );
    }

    for (const record of legacyDailyRecords) {
      const recordDate = this.normalizeWarningRecalcTargetDate(new Date(record.record_date));
      const key = [
        record.student_id.toString(),
        this.toDateOnlyKey(recordDate),
        record.course_id?.toString?.() || '',
      ].join('_');
      if (coveredLegacyKeys.has(key)) {
        continue;
      }
      addTarget({
        studentId: record.student_id,
        recordDate,
        courseId: record.course_id || undefined,
      });
    }

    for (const warning of recentWarnings) {
      const detail = (warning.trigger_detail_json as Record<string, any>) || {};
      const recordDate = this.normalizeWarningRecalcTargetDate(new Date(warning.period_end || now));
      addTarget({
        studentId: warning.student_id,
        recordDate,
        courseId:
          detail.course_id && /^\d+$/.test(String(detail.course_id))
            ? BigInt(String(detail.course_id))
            : undefined,
      });
    }

    return {
      days: safeDays,
      startDate,
      endDate: now,
      targets: Array.from(targetMap.values()),
      targets_collected: targetMap.size,
    };
  }

  private async runRecentWarningReconcileRounds(targets: WarningRecalcTarget[]) {
    const startedAt = Date.now();
    const retryRounds = await this.getNightlyReconcileRetryRounds();
    const retryDelayMs = await this.getNightlyReconcileRetryDelayMs();
    let pendingTargets = [...targets];
    let warningsGenerated = 0;
    let targetsProcessed = 0;
    let targetsMerged = 0;
    let targetsLockedInitial = 0;
    let roundsExecuted = 0;

    for (let round = 1; round <= retryRounds; round += 1) {
      if (pendingTargets.length === 0) {
        break;
      }

      roundsExecuted = round;
      const roundResult = await this.generateWarningsForAffectedRecordsWithOptions(pendingTargets, {
        collectLockedKeys: true,
      });
      warningsGenerated += Number(roundResult?.warnings_generated || 0);
      targetsProcessed += Number(roundResult?.targets_processed || 0);
      targetsMerged += Number(roundResult?.targets_merged || 0);
      const lockedCount = Number(roundResult?.targets_locked || 0);
      if (round === 1) {
        targetsLockedInitial = lockedCount;
      }

      const lockedKeys = new Set<string>(
        Array.isArray((roundResult as any)?.locked_target_keys)
          ? ((roundResult as any).locked_target_keys as string[])
          : [],
      );
      pendingTargets = pendingTargets.filter((target) =>
        lockedKeys.has(`${target.studentId.toString()}_${this.toDateOnlyKey(target.recordDate)}`),
      );

      this.logger.log(
        `[预警][对账] 轮次=${round} 目标=${Number(roundResult?.targets_processed || 0)} 新建=${Number(roundResult?.warnings_generated || 0)} 锁定=${lockedCount} 剩余=${pendingTargets.length}`,
      );

      if (pendingTargets.length === 0 || round >= retryRounds) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    return {
      warnings_generated: warningsGenerated,
      targets_processed: targetsProcessed,
      targets_merged: targetsMerged,
      reconcile_rounds: roundsExecuted,
      targets_locked_initial: targetsLockedInitial,
      targets_locked_remaining: pendingTargets.length,
      remaining_locked_targets: pendingTargets,
      duration_ms: Date.now() - startedAt,
    };
  }
  async reconcileRecentWarnings(days = 7) {
    const startedAt = Date.now();
    const collected = await this.collectRecentWarningReconcileTargets(days);
    const executionResult =
      collected.targets.length > 0
        ? await this.runRecentWarningReconcileRounds(collected.targets)
        : {
            warnings_generated: 0,
            targets_processed: 0,
            targets_merged: 0,
            reconcile_rounds: 0,
            targets_locked_initial: 0,
            targets_locked_remaining: 0,
            remaining_locked_targets: [] as WarningRecalcTarget[],
            duration_ms: 0,
          };

    const auditResult = {
      days: collected.days,
      targets_collected: collected.targets_collected,
      warnings_generated: Number(executionResult.warnings_generated || 0),
      targets_processed: Number(executionResult.targets_processed || 0),
      targets_merged: Number(executionResult.targets_merged || 0),
      reconcile_rounds: Number(executionResult.reconcile_rounds || 0),
      targets_locked_initial: Number(executionResult.targets_locked_initial || 0),
      targets_locked_remaining: Number(executionResult.targets_locked_remaining || 0),
      duration_ms: Date.now() - startedAt,
    };

    this.prisma.audit_logs.create({
      data: {
        actor_user_id: 0n,
        action: 'warning.reconcile_recent',
        entity_type: 'warning',
        entity_id: 0n,
        after_json: serializeForAudit(auditResult) as any,
        ip: '',
        user_agent: 'system',
      },
    }).catch(() => {});

    return {
      ...auditResult,
      remaining_locked_targets: executionResult.remaining_locked_targets,
      execution_duration_ms: Number(executionResult.duration_ms || 0),
    };
  }

  private async getStudentContext(studentId: bigint): Promise<StudentContext | null> {
    return this.prisma.student_profiles.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        // 站内消息表 notification.user_id 指向 users.id，必须带出来
        user_id: true,
        class_id: true,
        org_id: true,
        email: true,
        users: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });
  }

  private async getWarningRecalcConcurrency() {
    const envDefault = Number(process.env.WARNING_RECALC_CONCURRENCY || 4);
    const fallback = Number.isFinite(envDefault) ? envDefault : 4;
    const configured = await this.systemConfigService.getNumberConfig(
      'warning.recalcConcurrency',
      fallback,
    );

    if (!Number.isFinite(configured)) {
      return fallback;
    }

    return Math.min(12, Math.max(1, Math.round(configured)));
  }

  private async getWarningSyncRecalcConcurrency() {
    const envDefault = Number(
      process.env.WARNING_SYNC_RECALC_CONCURRENCY || DEFAULT_WARNING_SYNC_RECALC_CONCURRENCY,
    );
    const fallback = Number.isFinite(envDefault)
      ? envDefault
      : DEFAULT_WARNING_SYNC_RECALC_CONCURRENCY;
    const configured = await this.systemConfigService.getNumberConfig(
      'warning.syncRecalcConcurrency',
      fallback,
    );

    if (!Number.isFinite(configured)) {
      return fallback;
    }

    return Math.min(8, Math.max(1, Math.round(configured)));
  }

  private async getWarningStudentLockTtlMs() {
    const envDefault = Number(
      process.env.WARNING_STUDENT_LOCK_TTL_MS || DEFAULT_WARNING_STUDENT_LOCK_TTL_MS,
    );
    const fallback = Number.isFinite(envDefault)
      ? envDefault
      : DEFAULT_WARNING_STUDENT_LOCK_TTL_MS;
    const configured = await this.systemConfigService.getNumberConfig(
      'warning.studentLockTtlMs',
      fallback,
    );

    if (!Number.isFinite(configured)) {
      return fallback;
    }

    return Math.min(120_000, Math.max(10_000, Math.round(configured)));
  }

  private async withWarningStudentLock<T>(studentId: bigint, task: () => Promise<T>) {
    const lockTtlMs = await this.getWarningStudentLockTtlMs();
    const lockKey = `lock:warning:student:${studentId.toString()}`;

    for (let attempt = 1; attempt <= DEFAULT_WARNING_STUDENT_LOCK_RETRY_COUNT; attempt += 1) {
      const lockResult = await this.redis.withLock(lockKey, lockTtlMs, task);
      if (lockResult.locked) {
        return {
          locked: true,
          result: lockResult.result,
          attempts: attempt,
        };
      }

      if (attempt < DEFAULT_WARNING_STUDENT_LOCK_RETRY_COUNT) {
        const delayMs = attempt * DEFAULT_WARNING_STUDENT_LOCK_RETRY_DELAY_MS;
        this.logger.warn(
          `[预警] 学生 ${studentId.toString()} 重算锁被占用，第 ${attempt} 次重试，${delayMs}ms 后再次尝试`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    this.logger.warn(
      `[预警] 学生 ${studentId.toString()} 重算锁持续被占用，已跳过本次重算`,
    );

    return {
      locked: false,
      attempts: DEFAULT_WARNING_STUDENT_LOCK_RETRY_COUNT,
    };
  }

  private async getWarningTransactionTimeoutMs() {
    const envDefault = Number(
      process.env.WARNING_TRANSACTION_TIMEOUT_MS || DEFAULT_WARNING_TRANSACTION_TIMEOUT_MS,
    );
    const fallback = Number.isFinite(envDefault)
      ? envDefault
      : DEFAULT_WARNING_TRANSACTION_TIMEOUT_MS;
    const configured = await this.systemConfigService.getNumberConfig(
      'warning.transactionTimeoutMs',
      fallback,
    );

    if (!Number.isFinite(configured)) {
      return fallback;
    }

    return Math.min(120_000, Math.max(5_000, Math.round(configured)));
  }

  private async getWarningTransactionMaxWaitMs() {
    const envDefault = Number(
      process.env.WARNING_TRANSACTION_MAX_WAIT_MS || DEFAULT_WARNING_TRANSACTION_MAX_WAIT_MS,
    );
    const fallback = Number.isFinite(envDefault)
      ? envDefault
      : DEFAULT_WARNING_TRANSACTION_MAX_WAIT_MS;
    const configured = await this.systemConfigService.getNumberConfig(
      'warning.transactionMaxWaitMs',
      fallback,
    );

    if (!Number.isFinite(configured)) {
      return fallback;
    }

    return Math.min(60_000, Math.max(1_000, Math.round(configured)));
  }

  private mergeWarningRecalcTargets(records: WarningRecalcTarget[]): MergedWarningRecalcTarget[] {
    const merged = new Map<
      string,
      {
        studentId: bigint;
        recordDate: Date;
        courseIds: Map<string, bigint>;
      }
    >();

    for (const record of records) {
      if (!(record?.recordDate instanceof Date) || Number.isNaN(record.recordDate.getTime())) {
        continue;
      }

      const dateKey = this.toDateOnlyKey(record.recordDate);
      if (!dateKey) {
        continue;
      }

      const studentKey = record.studentId.toString();
      const mergedKey = `${studentKey}_${dateKey}`;
      const current =
        merged.get(mergedKey) ||
        {
          studentId: record.studentId,
          recordDate: record.recordDate,
          courseIds: new Map<string, bigint>(),
        };

      if (record.recordDate.getTime() > current.recordDate.getTime()) {
        current.recordDate = record.recordDate;
      }

      if (record.courseId) {
        current.courseIds.set(record.courseId.toString(), record.courseId);
      }

      merged.set(mergedKey, current);
    }

    return Array.from(merged.values()).map((item) => ({
      studentId: item.studentId,
      recordDate: item.recordDate,
      courseIds: Array.from(item.courseIds.values()),
    }));
  }

  private async evaluateStudentRules(
    student: StudentContext,
    referenceDate: Date,
    rules: any[],
    courseId?: bigint,
  ): Promise<WarningEvaluationResult> {
    const effectiveRules = this.resolveEffectiveRules(rules, student);
    const metrics = Array.from(
      new Set([...DEFAULT_METRICS, ...effectiveRules.map((rule) => rule.metric)]),
    );
    const [transactionTimeoutMs, transactionMaxWaitMs] = await Promise.all([
      this.getWarningTransactionTimeoutMs(),
      this.getWarningTransactionMaxWaitMs(),
    ]);
    const transactionOptions = {
      maxWait: transactionMaxWaitMs,
      timeout: transactionTimeoutMs,
    };
    let warningsGenerated = 0;
    const postCommitTasks: WarningPostCommitTask[] = [];

    const lockResult = await this.withWarningStudentLock(student.id, async () => {
      warningsGenerated = 0;
      postCommitTasks.length = 0;

      await this.executeWarningTransaction(
        `warning cleanup unsupported metrics for student ${student.id.toString()}`,
        transactionOptions,
        async (tx) => {
          await this.closeUnsupportedMetricWarnings(tx, student.id);
        },
      );

      for (const metric of metrics) {
        for (const windowType of WINDOW_ORDER) {
          const rulesForWindow = effectiveRules
            .filter((rule) => rule.metric === metric && rule.window === windowType)
            .sort((left, right) => right.threshold - left.threshold);
          const windowPostCommitTasks: WarningPostCommitTask[] = [];

          const created = await this.executeWarningTransaction(
            `warning recalc student ${student.id.toString()} ${metric}/${windowType}`,
            transactionOptions,
            async (tx) =>
              this.evaluateMetricWindow(
                tx,
                student,
                metric,
                windowType,
                rulesForWindow,
                referenceDate,
                windowPostCommitTasks,
                windowType === 'day' ? courseId : undefined,
              ),
          );

          warningsGenerated += created;
          postCommitTasks.push(...windowPostCommitTasks);
        }
      }

      await this.executeWarningTransaction(
        `warning finalize student ${student.id.toString()}`,
        transactionOptions,
        async (tx) => {
          await this.cleanupStudentDuplicateWarnings(tx, student.id);
        },
      );
      this.queueWarningCaseSync(postCommitTasks, student);
    });

    if (!lockResult.locked) {
      return {
        warnings_generated: 0,
        skipped_locked: true,
        lock_attempts: lockResult.attempts,
      };
    }

    this.enqueuePostCommitTasks(postCommitTasks);
    return {
      warnings_generated: warningsGenerated,
      lock_attempts: lockResult.attempts,
    };
  }



  private async executeWarningTransaction<T>(
    label: string,
    options: {
      maxWait: number;
      timeout: number;
    },
    task: (tx: any) => Promise<T>,
  ) {
    return this.withTransactionRetry(label, () =>
      this.prisma.$transaction((tx) => task(tx), {
        ...options,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }),
    );
  }

  private async runPostCommitTasks(tasks: WarningPostCommitTask[]) {
    for (const task of tasks) {
      try {
        if (task.type === 'warning_notification') {
          await this.sendWarningNotification(task);
          continue;
        }
        if (task.type === 'absent_threshold_email') {
          await this.sendAbsentThresholdEmail(task);
          continue;
        }
        if (task.type === 'warning_case_sync') {
          await this.runAsyncWarningCaseSync(task);
          continue;
        }
      } catch (error: any) {
        this.logger.error(
          `[预警] 执行后置任务 ${task.type} 失败，预警ID=${(task as any).warningId || 'n/a'}`,
          error?.stack || error?.message || String(error),
        );
      }
    }
  }

  private enqueuePostCommitTasks(tasks: WarningPostCommitTask[]) {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return;
    }

    const queuedTasks = [...tasks];
    this.postCommitTaskQueue = this.postCommitTaskQueue
      .catch(() => undefined)
      .then(() => this.runPostCommitTasks(queuedTasks))
      .catch((error: any) => {
        this.logger.error(
          `[预警] 后置任务队列执行失败，数量=${queuedTasks.length}`,
          error?.stack || error?.message || String(error),
        );
      });
  }

  private resolveEffectiveRules(rules: any[], student: StudentContext) {
    const selectedRules = new Map<string, any>();

    for (const rule of rules) {
      if (!SUPPORTED_METRICS.has(String(rule.metric || ''))) {
        continue;
      }
      if (
        !ENABLE_CUMULATIVE_WARNING &&
        String(rule.metric || '').trim() === CUMULATIVE_WARNING_METRIC
      ) {
        continue;
      }
      if (!this.ruleMatchesStudent(rule, student)) {
        continue;
      }

      const key = `${rule.metric}:${rule.window}:${rule.level}`;
      const currentRule = selectedRules.get(key);

      if (!currentRule || this.compareRulePriority(rule, currentRule) > 0) {
        selectedRules.set(key, rule);
      }
    }

    return Array.from(selectedRules.values());
  }

  private async closeUnsupportedMetricWarnings(tx: any, studentId: bigint) {
    const warnings = await tx.warnings.findMany({
      where: {
        student_id: studentId,
        metric: { notIn: Array.from(SUPPORTED_METRICS) },
        status: { in: ACTIVE_WARNING_STATUSES },
      },
      select: {
        id: true,
      },
    });

    if (warnings.length === 0) {
      return;
    }

    await tx.warnings.updateMany({
      where: {
        id: {
          in: warnings.map((warning: any) => warning.id),
        },
      },
      data: {
        status: 'closed',
        closed_at: new Date(),
        close_note: 'rule metric no longer supported, auto-closed by system',
        updated_at: new Date(),
      },
    });
  }

  private ruleMatchesStudent(rule: any, student: StudentContext) {
    const scope = this.normalizeScope(rule.scope);

    if (scope === 'school') {
      return true;
    }

    if (scope === 'org') {
      return Boolean(
        student.org_id &&
          rule.scope_id &&
          student.org_id.toString() === rule.scope_id.toString(),
      );
    }

    if (scope === 'class') {
      return Boolean(
        student.class_id &&
          rule.scope_id &&
          student.class_id.toString() === rule.scope_id.toString(),
      );
    }

    return false;
  }

  private normalizeScope(scope?: string) {
    if (scope === 'college') {
      return 'org';
    }

    if (scope === 'org' || scope === 'class' || scope === 'school') {
      return scope;
    }

    return 'school';
  }

  private compareRulePriority(left: any, right: any) {
    const scopeWeight = (rule: any) => {
      const scope = this.normalizeScope(rule.scope);
      if (scope === 'class') return 3;
      if (scope === 'org') return 2;
      return 1;
    };

    const scopeDiff = scopeWeight(left) - scopeWeight(right);
    if (scopeDiff !== 0) {
      return scopeDiff;
    }

    const leftTime = new Date(left.created_at || 0).getTime();
    const rightTime = new Date(right.created_at || 0).getTime();
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return String(left.id || '').localeCompare(String(right.id || ''));
  }

  private async evaluateCourseWindow(
    tx: any,
    student: StudentContext,
    windowType: string,
    rulesForWindow: any[],
    referenceDate: Date,
    postCommitTasks: WarningPostCommitTask[],
    courseId?: bigint,
  ) {
    const { start, end } = await this.getWindowBoundaries(referenceDate, windowType);
    const activeWarnings = await tx.warning_current_states.findMany({
      where: {
        student_id: student.id,
        metric: { in: DEFAULT_METRICS },
        window: windowType,
        period_start: { lte: end },
        period_end: { gte: start },
        status: { in: ACTIVE_WARNING_STATUSES },
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    });

    const courseMap = new Map<
      string,
      {
        courseId: bigint | null;
        counts: Record<string, number>;
      }
    >();
    const ruleMap = new Map<string, any[]>();

    for (const metric of DEFAULT_METRICS) {
      const metricRules = rulesForWindow
        .filter((rule) => String(rule.metric || '').trim() === metric)
        .sort((left, right) => right.threshold - left.threshold);
      ruleMap.set(metric, metricRules);

      const courseAggregates = await this.getAggregateCountsByCourse(
        tx,
        student.id,
        metric,
        start,
        end,
        windowType,
        courseId,
      );

      for (const aggregate of courseAggregates) {
        const courseKey = this.getCourseKey(aggregate.courseId || null);
        const current = courseMap.get(courseKey) || {
          courseId: aggregate.courseId || null,
          counts: {
            late: 0,
            absent: 0,
            early_leave: 0,
          },
        };
        current.counts[metric] = Number(aggregate.count || 0);
        if (aggregate.courseId) {
          current.courseId = aggregate.courseId;
        }
        courseMap.set(courseKey, current);
      }
    }

    let createdCount = 0;
    const touchedCourseKeys = new Set<string>();

    for (const [courseKey, aggregate] of courseMap.entries()) {
      touchedCourseKeys.add(courseKey);
      const matchedRules = DEFAULT_METRICS
        .map((metric) => {
          const count = Number(aggregate.counts[metric] || 0);
          if (count <= 0) {
            return null;
          }
          const matchedRule = (ruleMap.get(metric) || []).find((rule) => isThresholdHit(metric, count, rule.threshold)) || null;
          if (!matchedRule) {
            return null;
          }
          return {
            metric,
            count,
            rule: matchedRule,
          };
        })
        .filter(Boolean) as Array<{ metric: string; count: number; rule: any }>;

      const courseWarnings = activeWarnings.filter(
        (warning: any) => this.getWarningCourseKey(warning) === courseKey,
      );

      if (matchedRules.length === 0) {
        await this.closeCurrentWarningStates(
          tx,
          courseWarnings,
          '系统重算后该课程在当前时间窗内已不再满足预警条件',
        );
        continue;
      }

      const primary = this.pickPrimaryCourseRule(matchedRules);
      const totalViolationCount = Object.values(aggregate.counts).reduce(
        (sum, value) => sum + Number(value || 0),
        0,
      );

      createdCount += await this.syncCourseAggregateWarningState(
        tx,
        student,
        windowType,
        primary.metric,
        primary.rule,
        totalViolationCount,
        aggregate.counts,
        start,
        end,
        postCommitTasks,
        aggregate.courseId || undefined,
        courseWarnings,
      );
    }

    const warningsToClose = activeWarnings.filter((warning: any) => {
      const warningCourseKey = this.getWarningCourseKey(warning);
      if (courseId) {
        return warningCourseKey === this.getCourseKey(courseId);
      }
      return !touchedCourseKeys.has(warningCourseKey);
    });

    await this.closeCurrentWarningStates(
      tx,
      warningsToClose,
      '系统重算后该课程在当前时间窗内已不再满足预警条件',
    );

    return createdCount;
  }

  private pickPrimaryCourseRule(
    matchedRules: Array<{ metric: string; count: number; rule: any }>,
  ) {
    const levelWeight: Record<string, number> = {
      yellow: 1,
      orange: 2,
      red: 3,
      severe: 4,
    };
    const metricWeight: Record<string, number> = {
      absent: 3,
      early_leave: 2,
      late: 1,
    };

    return [...matchedRules].sort((left, right) => {
      const levelDiff =
        (levelWeight[String(right.rule?.level || '')] || 0) -
        (levelWeight[String(left.rule?.level || '')] || 0);
      if (levelDiff !== 0) {
        return levelDiff;
      }

      const metricDiff =
        (metricWeight[String(right.metric || '')] || 0) -
        (metricWeight[String(left.metric || '')] || 0);
      if (metricDiff !== 0) {
        return metricDiff;
      }

      return Number(right.count || 0) - Number(left.count || 0);
    })[0];
  }

  private async syncCourseAggregateWarningState(
    tx: any,
    student: StudentContext,
    windowType: string,
    dominantMetric: string,
    rule: any,
    totalViolationCount: number,
    metricCounts: Record<string, number>,
    periodStart: Date,
    periodEnd: Date,
    postCommitTasks: WarningPostCommitTask[],
    courseId?: bigint,
    activeWarnings?: any[],
  ) {
    const courseWarnings = Array.isArray(activeWarnings) ? activeWarnings : [];
    const canonicalWarning = courseWarnings
      .slice()
      .sort((left: any, right: any) => {
        const updatedAtDiff =
          new Date(right.updated_at || right.created_at || 0).getTime() -
          new Date(left.updated_at || left.created_at || 0).getTime();
        if (updatedAtDiff !== 0) {
          return updatedAtDiff;
        }
        return this.compareBigIntDesc(right.id, left.id);
      })[0] || null;

    await this.closeCurrentWarningStates(
      tx,
      courseWarnings.filter((warning: any) => !canonicalWarning || warning.id !== canonicalWarning.id),
      canonicalWarning ? '系统重算后已收敛为课程聚合预警' : '系统重算后已被课程聚合预警替代',
    );

    const courseName = courseId ? await this.getCourseName(tx, courseId) : '';
    const triggerContext = await this.resolveAggregatedWarningTriggerContext(
      tx,
      student.id,
      periodStart,
      periodEnd,
      courseId,
    );
    const windowContext = await this.resolveWarningWindowContext(windowType, periodStart);
    const summary = this.buildCourseAggregateWarningSummary(
      student,
      windowType,
      totalViolationCount,
      metricCounts,
      courseName,
      windowContext,
    );
    const detail = this.buildCourseAggregateTriggerDetail(
      dominantMetric,
      windowType,
      totalViolationCount,
      metricCounts,
      courseId,
      courseName,
      triggerContext,
      windowContext,
    );

    if (canonicalWarning) {
      const shouldReopen = this.shouldReopenAcknowledgedWarning(
        canonicalWarning,
        summary,
        detail,
      );

      const updatedWarning = await tx.warning_current_states.update({
        where: { id: canonicalWarning.id },
        data: {
          class_id: student.class_id,
          org_id: student.org_id || 0n,
          metric: dominantMetric,
          level: rule.level,
          course_id: courseId || null,
          course_key: this.getCourseKey(courseId || null),
          rule_id: rule.id,
          rule_snapshot_json: this.serializeRuleSnapshot(rule, windowType),
          trigger_summary: summary,
          trigger_detail_json: detail,
          current_count: totalViolationCount,
          ...(shouldReopen
            ? {
                status: 'open',
                acknowledged_at: null,
                acknowledged_by: null,
              }
            : {}),
          updated_at: new Date(),
        },
      });

      const historyWarning = await this.appendWarningHistory(tx, {
        student_id: updatedWarning.student_id,
        class_id: updatedWarning.class_id,
        org_id: updatedWarning.org_id,
        metric: updatedWarning.metric,
        level: updatedWarning.level,
        window: updatedWarning.window,
        period_start: updatedWarning.period_start,
        period_end: updatedWarning.period_end,
        rule_id: updatedWarning.rule_id,
        rule_snapshot_json: updatedWarning.rule_snapshot_json,
        trigger_summary: updatedWarning.trigger_summary,
        trigger_detail_json: updatedWarning.trigger_detail_json,
        course_id: updatedWarning.course_id || null,
        status: updatedWarning.status,
        acknowledged_at: updatedWarning.acknowledged_at || null,
        acknowledged_by: updatedWarning.acknowledged_by || null,
      });

      if (shouldReopen) {
        this.queueWarningNotification(postCommitTasks, {
          warningId: historyWarning.id,
          studentId: updatedWarning.student_id,
          warningLevel: String(updatedWarning.level || rule.level || ''),
          warningWindow: String(updatedWarning.window || windowType || ''),
          warningMetric: dominantMetric,
          notifyStrategy: rule.notify_strategy_json || null,
          student,
          triggerSummary: summary,
          ruleId: rule.id,
          periodStart,
        });
      }

      await this.closeLowerWindowWarnings(tx, student.id, dominantMetric, windowType, courseId);
      return 0;
    }

    await this.createCourseAggregateWarningRecord(
      tx,
      student,
      dominantMetric,
      windowType,
      rule,
      totalViolationCount,
      metricCounts,
      periodStart,
      periodEnd,
      detail,
      summary,
      postCommitTasks,
    );

    await this.closeLowerWindowWarnings(tx, student.id, dominantMetric, windowType, courseId);
    return 1;
  }

  private async resolveAggregatedWarningTriggerContext(
    tx: any,
    studentId: bigint,
    periodStart: Date,
    periodEnd: Date,
    courseId?: bigint,
  ): Promise<WarningTriggerContext> {
    const latestRecord = await tx.attendance_records.findFirst({
      where: {
        student_id: studentId,
        attendance_status: { in: ATTENDANCE_METRICS },
        sessions: {
          ...(courseId ? { course_id: courseId } : {}),
          session_start: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
      },
      orderBy: [
        { checkin_time: 'desc' },
        { created_at: 'desc' },
        { id: 'desc' },
      ],
      select: {
        session_id: true,
        checkin_time: true,
        created_at: true,
        sessions: {
          select: {
            session_start: true,
          },
        },
      },
    });

    if (latestRecord) {
      return {
        sessionId: latestRecord.session_id?.toString?.() || null,
        sessionStart: latestRecord.sessions?.session_start || null,
        triggerAt:
          latestRecord.checkin_time ||
          latestRecord.created_at ||
          latestRecord.sessions?.session_start ||
          null,
      };
    }

    return {
      sessionId: null,
      sessionStart: null,
      triggerAt: null,
    };
  }

  private buildCourseAggregateWarningSummary(
    student: StudentContext,
    windowType: string,
    totalViolationCount: number,
    metricCounts: Record<string, number>,
    courseName?: string,
    windowContext?: WarningWindowContext,
  ) {
    const breakdownText = this.buildMetricBreakdownText(metricCounts);
    return breakdownText;
  }

  private buildCourseAggregateTriggerDetail(
    dominantMetric: string,
    windowType: string,
    totalViolationCount: number,
    metricCounts: Record<string, number>,
    courseId: bigint | undefined,
    courseName: string,
    triggerContext?: WarningTriggerContext,
    windowContext?: WarningWindowContext,
  ) {
    return {
      violation_count: totalViolationCount,
      total_count: totalViolationCount,
      dominant_metric: dominantMetric,
      late_count: Number(metricCounts.late || 0),
      absent_count: Number(metricCounts.absent || 0),
      early_leave_count: Number(metricCounts.early_leave || 0),
      course_id: courseId?.toString?.() || null,
      course_name: courseName || '',
      session_id: triggerContext?.sessionId || null,
      session_start: triggerContext?.sessionStart || null,
      triggered_at: triggerContext?.triggerAt || null,
      week_label: windowContext?.weekLabel || null,
    };
  }

  private buildMetricBreakdownText(metricCounts: Record<string, number>) {
    return [
      `迟到${Number(metricCounts.late || 0)}次`,
      `缺勤${Number(metricCounts.absent || 0)}次`,
      `早退${Number(metricCounts.early_leave || 0)}次`,
    ].join('，');
  }

  private async createCourseAggregateWarningRecord(
    tx: any,
    student: StudentContext,
    dominantMetric: string,
    windowType: string,
    rule: any,
    totalViolationCount: number,
    metricCounts: Record<string, number>,
    periodStart: Date,
    periodEnd: Date,
    triggerDetail: Record<string, any>,
    triggerSummary: string,
    postCommitTasks: WarningPostCommitTask[],
  ) {
    const currentWarning = await tx.warning_current_states.create({
      data: {
        student_id: student.id,
        class_id: student.class_id,
        org_id: student.org_id || 0n,
        metric: dominantMetric,
        level: rule.level,
        window: windowType,
        period_start: periodStart,
        period_end: periodEnd,
        course_key: this.getCourseKey(
          triggerDetail?.course_id && /^\d+$/.test(String(triggerDetail.course_id))
            ? BigInt(String(triggerDetail.course_id))
            : null,
        ),
        course_id:
          triggerDetail?.course_id && /^\d+$/.test(String(triggerDetail.course_id))
            ? BigInt(String(triggerDetail.course_id))
            : null,
        rule_id: rule.id,
        rule_snapshot_json: this.serializeRuleSnapshot(rule, windowType),
        trigger_summary: triggerSummary,
        trigger_detail_json: triggerDetail,
        status: 'open',
        current_count: totalViolationCount,
      },
    });

    const warning = await this.appendWarningHistory(tx, {
      student_id: currentWarning.student_id,
      class_id: currentWarning.class_id,
      org_id: currentWarning.org_id,
      metric: currentWarning.metric,
      level: currentWarning.level,
      window: currentWarning.window,
      period_start: currentWarning.period_start,
      period_end: currentWarning.period_end,
      rule_id: currentWarning.rule_id,
      rule_snapshot_json: currentWarning.rule_snapshot_json,
      trigger_summary: currentWarning.trigger_summary,
      trigger_detail_json: currentWarning.trigger_detail_json,
      status: currentWarning.status,
    });

    this.queueWarningNotification(postCommitTasks, {
      warningId: warning.id,
      studentId: warning.student_id,
      warningLevel: String(warning.level || rule.level || ''),
      warningWindow: String(warning.window || windowType || ''),
      warningMetric: dominantMetric,
      notifyStrategy: rule.notify_strategy_json || null,
      student,
      triggerSummary,
      ruleId: rule.id,
      periodStart,
    });
    this.queueAbsentThresholdEmail(postCommitTasks, {
      warningId: warning.id.toString(),
      studentId: student.id.toString(),
      studentName: student.users?.name || '同学',
      studentEmail: String(student.users?.email || student.email || '').trim().toLowerCase(),
      warningLevel: rule.level,
      warningWindow: windowType,
      absentCount: Number(metricCounts.absent || 0),
      metric: dominantMetric,
      triggerSummary,
    });

    this.logger.log(
      `[预警] 已创建 ${windowType} 窗口课程聚合预警，学生=${student.id.toString()}，主指标=${dominantMetric}，级别=${rule.level}，总次数=${totalViolationCount}`,
    );

    return warning;
  }

  private async evaluateMetricWindow(
    tx: any,
    student: StudentContext,
    metric: string,
    windowType: string,
    rulesForWindow: any[],
    referenceDate: Date,
    postCommitTasks: WarningPostCommitTask[],
    courseId?: bigint,
  ) {
    const { start, end } = await this.getWindowBoundaries(referenceDate, windowType);
    const courseAggregates = await this.getAggregateCountsByCourse(
      tx,
      student.id,
      metric,
      start,
      end,
      windowType,
      courseId,
    );
    const activeWarnings = await tx.warning_current_states.findMany({
      where: {
        student_id: student.id,
        metric,
        window: windowType,
        period_start: { lte: end },
        period_end: { gte: start },
        status: { in: ACTIVE_WARNING_STATUSES },
      },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    });
    const suppressionKeys = new Set<string>();

    let createdCount = 0;
    const touchedCourseKeys = new Set<string>();

    for (const aggregate of courseAggregates) {
      touchedCourseKeys.add(this.getCourseKey(aggregate.courseId));
      const matchedRule =
        rulesForWindow.find((rule) => isThresholdHit(metric, aggregate.count, rule.threshold)) || null;
      createdCount += await this.syncWarningState(
        tx,
        student,
        metric,
        windowType,
        matchedRule,
        aggregate.count,
        start,
        end,
        postCommitTasks,
        aggregate.courseId || undefined,
        activeWarnings,
        suppressionKeys,
      );
    }

    const warningsToClose = activeWarnings.filter((warning: any) => {
      const warningCourseKey = this.getWarningCourseKey(warning);
      if (courseId) {
        return warningCourseKey === this.getCourseKey(courseId);
      }
      return !touchedCourseKeys.has(warningCourseKey);
    });

    await this.closeCurrentWarningStates(
      tx,
      warningsToClose,
      '系统重算后该课程在当前时间窗内已不再满足预警条件',
    );

    return createdCount;
  }

  private getWarningSessionKey(warning: any) {
    const detail = (warning?.trigger_detail_json as Record<string, any>) || {};
    return String(detail.session_id || '').trim();
  }

  private async evaluateDailyAttendanceEventWarnings(
    tx: any,
    student: StudentContext,
    metric: string,
    rulesForWindow: any[],
    periodStart: Date,
    periodEnd: Date,
    postCommitTasks: WarningPostCommitTask[],
    courseId?: bigint,
  ) {
    const attendanceStatus = this.getMetricValue(metric);
    const events = await tx.attendance_records.findMany({
      where: {
        student_id: student.id,
        attendance_status: attendanceStatus,
        sessions: {
          ...(courseId ? { course_id: courseId } : {}),
          session_start: {
            gte: periodStart,
            lte: periodEnd,
          },
        },
      },
      select: {
        session_id: true,
        checkin_time: true,
        created_at: true,
        sessions: {
          select: {
            session_start: true,
            course_id: true,
            courses: {
              select: {
                course_name: true,
              },
            },
          },
        },
      },
    });

    const allWindowWarnings = await tx.warnings.findMany({
      where: {
        student_id: student.id,
        metric,
        window: 'day',
        period_start: { lte: periodEnd },
        period_end: { gte: periodStart },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    const activeWarnings = allWindowWarnings.filter((warning: any) =>
      ACTIVE_WARNING_STATUSES.includes(String(warning.status || '').trim()),
    );
    const suppressionKeys = new Set<string>();
    const eventCountByCourse = new Map<string, number>();
    events.forEach((event: any) => {
      const key = this.getCourseKey(event.sessions?.course_id || null);
      eventCountByCourse.set(key, (eventCountByCourse.get(key) || 0) + 1);
    });

    let createdCount = 0;
    const touchedSessionKeys = new Set<string>();

    for (const event of events) {
      const eventCourseId = event.sessions?.course_id || null;
      const courseKey = this.getCourseKey(eventCourseId);
      const eventSessionKey = String(event.session_id || '').trim();
      if (!eventSessionKey) {
        continue;
      }

      touchedSessionKeys.add(eventSessionKey);
      let matchedRule =
        rulesForWindow.find((rule) => (eventCountByCourse.get(courseKey) || 0) >= rule.threshold) || null;
      if (!matchedRule && rulesForWindow.length > 0) {
        matchedRule = rulesForWindow[rulesForWindow.length - 1];
      }

      const sessionWarnings = allWindowWarnings.filter(
        (warning: any) =>
          this.getWarningCourseKey(warning) === courseKey &&
          this.getWarningSessionKey(warning) === eventSessionKey,
      );
      const activeSessionWarnings = sessionWarnings.filter((warning: any) =>
        ACTIVE_WARNING_STATUSES.includes(String(warning.status || '').trim()),
      );

      if (!matchedRule) {
        await this.closeWarnings(
          tx,
          activeSessionWarnings,
          '系统重算后该异常事件已不再命中日预警规则',
        );
        continue;
      }

      const courseName = String(event.sessions?.courses?.course_name || '').trim();
      const triggerContext = {
        sessionId: eventSessionKey,
        sessionStart: event.sessions?.session_start || null,
        triggerAt:
          event.checkin_time || event.created_at || event.sessions?.session_start || null,
      };
      const suppressionKey = '';
      const summary = this.buildTriggerSummary(
        student,
        metric,
        'day',
        1,
        courseName,
      );
      const detail = this.buildTriggerDetail(
        metric,
        'day',
        1,
        eventCourseId || undefined,
        courseName,
        triggerContext,
      );
      const canonicalWarning = activeSessionWarnings.sort((left: any, right: any) => {
        const createdAtDiff =
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return this.compareBigIntDesc(right.id, left.id);
      })[0] || null;

      await this.closeWarnings(
        tx,
        activeSessionWarnings.filter((warning: any) => !canonicalWarning || warning.id !== canonicalWarning.id),
        '系统重算后同一异常事件仅保留一条日预警记录',
      );

      if (canonicalWarning) {
        const shouldReopen = this.shouldReopenAcknowledgedWarning(
          canonicalWarning,
          summary,
          detail,
        );

        const updatedWarning = await tx.warnings.update({
          where: { id: canonicalWarning.id },
          data: {
            class_id: student.class_id,
            org_id: student.org_id || 0n,
            rule_id: matchedRule.id,
            rule_snapshot_json: this.serializeRuleSnapshot(matchedRule, 'day'),
            trigger_summary: summary,
            trigger_detail_json: detail,
            ...(shouldReopen
              ? {
                  status: 'open',
                  acknowledged_at: null,
                  acknowledged_by: null,
                }
              : {}),
            updated_at: new Date(),
          },
        });

        // 注：这里只更新 warnings 历史行。current_states 的累计次数口径
        // 需要连同唯一键一起改（见 docs/warning-system-redo.md 待办），
        // 单独在这里累加会与状态生命周期耦合，暂不在此处改动。

        if (shouldReopen) {
          this.queueWarningNotification(postCommitTasks, {
            warningId: updatedWarning.id,
            studentId: updatedWarning.student_id,
            warningLevel: String(updatedWarning.level || matchedRule.level || ''),
            warningWindow: 'day',
            warningMetric: String(metric || matchedRule.metric || ''),
            notifyStrategy: matchedRule.notify_strategy_json || null,
            student,
            triggerSummary: summary,
            ruleId: matchedRule.id,
            periodStart,
          });
        }

        continue;
      }

      if (suppressionKeys.has(suppressionKey)) {
        await this.closeWarnings(
          tx,
          activeSessionWarnings,
          '该异常预警已被人工删除，当前周期内不再自动生成',
        );
        continue;
      }

      await this.createWarningRecord(
        tx,
        student,
        metric,
        'day',
        matchedRule,
        1,
        periodStart,
        periodEnd,
        detail,
        summary,
        postCommitTasks,
      );
      createdCount += 1;
    }

    // P0-1 修复（跨表误删）：
    //   activeWarnings 来自 `warnings` 表（第 2229 行 findMany），
    //   而 closeCurrentWarningStates 内部执行的是
    //   `warning_current_states.deleteMany({ where: { id: { in: [...] } } })`，
    //   两张表 id 各自从 1 自增、区间高度重叠 → 会按 warnings 的 id 删掉
    //   毫不相干的 current_states 行，并把它们当成 closed 再 append 一遍。
    //   实测后果：360 条 open warnings 配 0 条 current_states，管理端活跃列表恒为空。
    //   这里必须用操作 warnings 表的 closeWarnings。
    await this.closeWarnings(
      tx,
      activeWarnings.filter(
        (warning: any) =>
          this.getWarningCourseKey(warning) === this.getCourseKey(courseId || null) ||
          !courseId,
      ).filter((warning: any) => {
        const sessionKey = this.getWarningSessionKey(warning);
        return sessionKey ? !touchedSessionKeys.has(sessionKey) : false;
      }),
      '系统重算后该异常事件已不存在，自动关闭对应日预警',
    );

    return createdCount;
  }

  private async syncWarningState(
    tx: any,
    student: StudentContext,
    metric: string,
    windowType: string,
    rule: any | null,
    violationCount: number,
    periodStart: Date,
    periodEnd: Date,
    postCommitTasks: WarningPostCommitTask[],
    courseId?: bigint,
    allWindowWarnings?: any[],
    suppressionKeys?: Set<string>,
  ) {
    const activeWarnings = (allWindowWarnings || []).filter(
      (warning: any) => this.getWarningCourseKey(warning) === this.getCourseKey(courseId || null),
    );

    if (!rule) {
      await this.closeWarnings(tx, activeWarnings, '系统重算后已不再满足当前预警规则');
      return 0;
    }

    const courseName = courseId ? await this.getCourseName(tx, courseId) : '';
    const triggerContext = await this.resolveWarningTriggerContext(
      tx,
      student.id,
      metric,
      periodStart,
      periodEnd,
      courseId,
    );
    const windowContext = await this.resolveWarningWindowContext(windowType, periodStart);
    const summary = this.buildTriggerSummary(
      student,
      metric,
      windowType,
      violationCount,
      courseName,
      windowContext,
    );
    const detail = this.buildTriggerDetail(
      metric,
      windowType,
      violationCount,
      courseId,
      courseName,
      triggerContext,
      windowContext,
    );
    const canonicalWarning = this.pickCanonicalWarning(activeWarnings, rule.level);

    // 幂等（防「多」）：同一学生同一窗口重复重算时，若状态、级别、规则、计数、
    // 摘要与触发详情都没变化，就不要再 update + append 历史行。
    // 旧实现每次重算都 append 一条 warnings，队列重投/恢复扫描一多就堆积。
    if (canonicalWarning) {
      const unchanged =
        String(canonicalWarning.level || '') === String(rule.level || '') &&
        String(canonicalWarning.rule_id || '') === String(rule.id || '') &&
        Number(canonicalWarning.current_count || 0) === Number(violationCount || 0) &&
        String(canonicalWarning.trigger_summary || '') === String(summary || '') &&
        this.buildDetailFingerprint(canonicalWarning.trigger_detail_json) ===
          this.buildDetailFingerprint(detail);

      if (unchanged) {
        await this.closeLowerWindowWarnings(tx, student.id, metric, windowType, courseId);
        return 0;
      }
    }

    await this.closeCurrentWarningStates(
      tx,
      activeWarnings.filter((warning: any) => !canonicalWarning || warning.id !== canonicalWarning.id),
      canonicalWarning ? '系统重算后已由当前预警级别替代' : '系统重算后已被新的预警状态替代',
    );

    if (canonicalWarning) {
      const shouldReopen = this.shouldReopenAcknowledgedWarning(
        canonicalWarning,
        summary,
        detail,
      );

      const updatedWarning = await tx.warning_current_states.update({
        where: { id: canonicalWarning.id },
        data: {
          class_id: student.class_id,
          org_id: student.org_id || 0n,
          level: rule.level,
          course_id: courseId || null,
          course_key: this.getCourseKey(courseId || null),
          rule_id: rule.id,
          rule_snapshot_json: this.serializeRuleSnapshot(rule, windowType),
          trigger_summary: summary,
          trigger_detail_json: detail,
          current_count: violationCount,
          ...(shouldReopen
            ? {
                status: 'open',
                acknowledged_at: null,
                acknowledged_by: null,
              }
            : {}),
          updated_at: new Date(),
        },
      });

      const historyWarning = await this.appendWarningHistory(tx, {
        student_id: updatedWarning.student_id,
        class_id: updatedWarning.class_id,
        org_id: updatedWarning.org_id,
        metric: updatedWarning.metric,
        level: updatedWarning.level,
        window: updatedWarning.window,
        period_start: updatedWarning.period_start,
        period_end: updatedWarning.period_end,
        rule_id: updatedWarning.rule_id,
        rule_snapshot_json: updatedWarning.rule_snapshot_json,
        trigger_summary: updatedWarning.trigger_summary,
        trigger_detail_json: updatedWarning.trigger_detail_json,
        course_id: updatedWarning.course_id || null,
        status: updatedWarning.status,
        acknowledged_at: updatedWarning.acknowledged_at || null,
        acknowledged_by: updatedWarning.acknowledged_by || null,
      });

      if (shouldReopen) {
        this.queueWarningNotification(postCommitTasks, {
          warningId: historyWarning.id,
          studentId: updatedWarning.student_id,
          warningLevel: String(updatedWarning.level || rule.level || ''),
          warningWindow: String(updatedWarning.window || windowType || ''),
          warningMetric: String(rule.metric || metric || ''),
          notifyStrategy: rule.notify_strategy_json || null,
          student,
          triggerSummary: summary,
          ruleId: rule.id,
          periodStart,
        });
      }

      await this.closeLowerWindowWarnings(tx, student.id, metric, windowType, courseId);
      return 0;
    }

    await this.createWarningRecord(
      tx,
      student,
      metric,
      windowType,
      rule,
      violationCount,
      periodStart,
      periodEnd,
      detail,
      summary,
      postCommitTasks,
    );

    await this.closeLowerWindowWarnings(tx, student.id, metric, windowType, courseId);
    return 1;
  }

  private pickCanonicalWarning(warnings: any[], desiredLevel: string) {
    const sameLevelWarnings = warnings
      .filter((warning) => warning.level === desiredLevel)
      .sort((left, right) => {
        const createdAtDiff =
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }

        return this.compareBigIntDesc(right.id, left.id);
      });

    return sameLevelWarnings[0] || null;
  }

  /** 触发详情指纹：键名排序后序列化，避免 MySQL JSON 列键序变化导致误判「有变化」 */
  private buildDetailFingerprint(detail: unknown): string {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      return String(detail ?? '');
    }

    const record = detail as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return JSON.stringify(keys.map((key) => [key, record[key] ?? null]));
  }

  private async cleanupStudentDuplicateWarnings(tx: any, studentId: bigint) {
    const warnings = await tx.warnings.findMany({
      where: {
        student_id: studentId,
        status: { in: ACTIVE_WARNING_STATUSES },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    if (warnings.length <= 1) {
      return;
    }

    const seenExactKeys = new Set<string>();
    const seenFallbackKeys = new Set<string>();
    const seenFallbackKeysWithoutSession = new Set<string>();
    const duplicateIds: bigint[] = [];

    for (const warning of warnings) {
      const duplicateContext = this.getWarningDuplicateContext(warning);
      if (!duplicateContext) {
        continue;
      }

      const { exactKey, fallbackKey, hasSessionId } = duplicateContext;
      const isDuplicate =
        seenExactKeys.has(exactKey) ||
        (!hasSessionId && seenFallbackKeys.has(fallbackKey)) ||
        (hasSessionId && seenFallbackKeysWithoutSession.has(fallbackKey));

      if (isDuplicate) {
        duplicateIds.push(warning.id);
        continue;
      }

      seenExactKeys.add(exactKey);
      seenFallbackKeys.add(fallbackKey);
      if (!hasSessionId) {
        seenFallbackKeysWithoutSession.add(fallbackKey);
      }
    }

    if (duplicateIds.length === 0) {
      return;
    }

    const notificationJobIds = (
      await tx.notification_jobs.findMany({
        where: { warning_id: { in: duplicateIds } },
        select: { id: true },
      })
    ).map((item: any) => item.id as bigint);

    if (notificationJobIds.length > 0) {
      await tx.notification_logs.deleteMany({
        where: { job_id: { in: notificationJobIds } },
      });
    }

    await tx.notification_jobs.deleteMany({
      where: { warning_id: { in: duplicateIds } },
    });
    await tx.warnings.deleteMany({
      where: { id: { in: duplicateIds } },
    });

    this.logger.log(
      `[预警] 已清理学生 ${studentId.toString()} 的重复预警 ${duplicateIds.length} 条`,
    );
  }

  private async closeWarnings(tx: any, warnings: any[], closeNote: string) {
    if (warnings.length === 0) {
      return;
    }

    await tx.warnings.updateMany({
      where: {
        id: {
          in: warnings.map((warning) => warning.id),
        },
      },
      data: {
        status: 'closed',
        closed_at: new Date(),
        close_note: closeNote,
        updated_at: new Date(),
      },
    });
  }

  private async appendWarningHistory(
    tx: any,
    payload: {
      student_id: bigint;
      class_id: bigint;
      org_id: bigint;
      metric: string;
      level: string;
      window: string;
      period_start: Date;
      period_end: Date;
      rule_id: bigint;
      rule_snapshot_json: any;
      trigger_summary: string;
      trigger_detail_json?: any;
      course_id?: bigint | null;
      status: string;
      acknowledged_at?: Date | null;
      acknowledged_by?: bigint | null;
      closed_at?: Date | null;
      closed_by?: bigint | null;
      close_note?: string | null;
    },
  ) {
    return tx.warnings.create({
      data: {
        student_id: payload.student_id,
        class_id: payload.class_id,
        org_id: payload.org_id,
        metric: payload.metric,
        level: payload.level,
        window: payload.window,
        period_start: payload.period_start,
        period_end: payload.period_end,
        rule_id: payload.rule_id,
        rule_snapshot_json: payload.rule_snapshot_json,
        trigger_summary: payload.trigger_summary,
        trigger_detail_json: payload.trigger_detail_json || null,
        status: payload.status,
        course_id: payload.course_id || null,
        acknowledged_at: payload.acknowledged_at || null,
        acknowledged_by: payload.acknowledged_by || null,
        closed_at: payload.closed_at || null,
        closed_by: payload.closed_by || null,
        close_note: payload.close_note || null,
      },
    });
  }

  private async closeCurrentWarningStates(tx: any, currentStates: any[], closeNote: string) {
    if (currentStates.length === 0) {
      return;
    }

    const closedAt = new Date();
    for (const state of currentStates) {
      await this.appendWarningHistory(tx, {
        student_id: state.student_id,
        class_id: state.class_id,
        org_id: state.org_id,
        metric: state.metric,
        level: state.level,
        window: state.window,
        period_start: state.period_start,
        period_end: state.period_end,
        rule_id: state.rule_id,
        rule_snapshot_json: state.rule_snapshot_json,
        trigger_summary: state.trigger_summary,
        trigger_detail_json: state.trigger_detail_json,
        course_id: state.course_id || null,
        status: 'closed',
        acknowledged_at: state.acknowledged_at || null,
        acknowledged_by: state.acknowledged_by || null,
        closed_at: closedAt,
        close_note: closeNote,
      });
    }

    await tx.warning_current_states.deleteMany({
      where: {
        id: { in: currentStates.map((state: any) => state.id) },
      },
    });
  }

  private async closeLowerWindowWarnings(
    tx: any,
    studentId: bigint,
    metric: string,
    windowType: string,
    courseId?: bigint,
  ) {
    const lowerWindows = this.getLowerWindows(windowType);
    if (lowerWindows.length === 0) {
      return;
    }

    const currentStates = await tx.warning_current_states.findMany({
      where: {
        student_id: studentId,
        metric,
        window: { in: lowerWindows },
        status: { in: ACTIVE_WARNING_STATUSES },
      },
    });

    await this.closeCurrentWarningStates(
      tx,
      currentStates.filter(
        (warning: any) => this.getWarningCourseKey(warning) === this.getCourseKey(courseId || null),
      ),
      `已被更宽时间窗口的${this.getWindowText(windowType)}预警覆盖`,
    );
  }


  private async createWarningRecord(
    tx: any,
    student: StudentContext,
    metric: string,
    windowType: string,
    rule: any,
    violationCount: number,
    periodStart: Date,
    periodEnd: Date,
    triggerDetail: Record<string, any>,
    triggerSummary: string,
    postCommitTasks: WarningPostCommitTask[],
  ) {
    const courseKey = this.getCourseKey(
      triggerDetail?.course_id && /^\d+$/.test(String(triggerDetail.course_id))
        ? BigInt(String(triggerDetail.course_id))
        : null,
    );

    let currentWarning: any;
    try {
      currentWarning = await tx.warning_current_states.create({
        data: {
          student_id: student.id, class_id: student.class_id, org_id: student.org_id || 0n,
          metric, level: rule.level, window: windowType,
          period_start: periodStart, period_end: periodEnd, course_key: courseKey,
          course_id: triggerDetail?.course_id && /^\d+$/.test(String(triggerDetail.course_id))
            ? BigInt(String(triggerDetail.course_id)) : null,
          rule_id: rule.id, rule_snapshot_json: this.serializeRuleSnapshot(rule, windowType),
          trigger_summary: triggerSummary, trigger_detail_json: triggerDetail,
          status: 'open', current_count: violationCount,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const existing = await tx.warning_current_states.findFirst({
          where: { student_id: student.id, metric, window: windowType, period_start: periodStart, period_end: periodEnd, course_key: courseKey },
        });
        if (!existing) throw err;
        currentWarning = await tx.warning_current_states.update({
          where: { id: existing.id },
          data: {
            level: rule.level, rule_id: rule.id,
            rule_snapshot_json: this.serializeRuleSnapshot(rule, windowType),
            trigger_summary: triggerSummary, trigger_detail_json: triggerDetail,
            status: 'open', current_count: violationCount, updated_at: new Date(),
          },
        });
      } else {
        throw err;
      }
    }

    const warning = await this.appendWarningHistory(tx, {
      student_id: currentWarning.student_id,
      class_id: currentWarning.class_id,
      org_id: currentWarning.org_id,
      metric: currentWarning.metric,
      level: currentWarning.level,
      window: currentWarning.window,
      period_start: currentWarning.period_start,
      period_end: currentWarning.period_end,
      rule_id: currentWarning.rule_id,
      rule_snapshot_json: currentWarning.rule_snapshot_json,
      trigger_summary: currentWarning.trigger_summary,
      trigger_detail_json: currentWarning.trigger_detail_json,
      course_id: currentWarning.course_id || null,
      status: currentWarning.status,
    });

    this.queueWarningNotification(postCommitTasks, {
      warningId: warning.id,
      studentId: warning.student_id,
      warningLevel: String(warning.level || rule.level || ''),
      warningWindow: String(warning.window || windowType || ''),
      warningMetric: String(metric || rule.metric || ''),
      notifyStrategy: rule.notify_strategy_json || null,
      student,
      triggerSummary,
      ruleId: rule.id,
      periodStart,
    });
    this.queueAbsentThresholdEmail(postCommitTasks, {
      warningId: warning.id.toString(),
      studentId: student.id.toString(),
      studentName: student.users?.name || '同学',
      studentEmail: String(student.users?.email || student.email || '').trim().toLowerCase(),
      warningLevel: rule.level,
      warningWindow: windowType,
      absentCount: violationCount,
      metric,
      triggerSummary,
    });

    this.logger.log(
      `[预警] 已创建 ${windowType} 窗口预警，学生=${student.id.toString()}，指标=${metric}，级别=${rule.level}，次数=${violationCount}`,
    );

    return warning;
  }

  private shouldReopenAcknowledgedWarning(
    warning: any,
    nextSummary: string,
    nextDetail: Record<string, any>,
  ) {
    if (String(warning?.status || '') !== 'acknowledged') {
      return false;
    }

    const currentDetail = (warning?.trigger_detail_json as Record<string, any>) || {};
    const currentTriggeredAt = this.toSecondPrecisionKey(
      currentDetail.triggered_at || currentDetail.session_start || warning?.updated_at || warning?.created_at,
    );
    const nextTriggeredAt = this.toSecondPrecisionKey(
      nextDetail.triggered_at || nextDetail.session_start || warning?.updated_at || warning?.created_at,
    );

    return (
      String(warning?.trigger_summary || '') !== String(nextSummary || '') ||
      Number(currentDetail.violation_count || 0) !== Number(nextDetail.violation_count || 0) ||
      String(currentDetail.session_id || '') !== String(nextDetail.session_id || '') ||
      String(currentDetail.course_id || '') !== String(nextDetail.course_id || '') ||
      currentTriggeredAt !== nextTriggeredAt
    );
  }

  private queueWarningNotification(
    tasks: WarningPostCommitTask[],
    input: {
      warningId: bigint;
      studentId: bigint;
      warningLevel: string;
      warningWindow: string;
      warningMetric: string;
      notifyStrategy: any;
      student: StudentContext;
      triggerSummary: string;
      /**
       * P1-1：频控键需要「规则 id + 周期起点」才能做到精确。
       * 缺失时键会退化为 {student}:{level}:0:，导致**同等级的不同规则互相压制**，
       * 因此调用方必须传入。
       */
      ruleId?: bigint | number | null;
      periodStart?: Date | string | null;
    },
  ) {
    tasks.push({
      type: 'warning_notification',
      warningId: input.warningId,
      studentId: input.studentId,
      warningLevel: input.warningLevel,
      warningWindow: input.warningWindow,
      warningMetric: input.warningMetric,
      notifyStrategy: input.notifyStrategy,
      student: input.student,
      triggerSummary: input.triggerSummary,
      ruleId: input.ruleId ?? null,
      periodStart: input.periodStart ?? null,
    });
  }

  private async sendWarningNotification(
    task: Extract<WarningPostCommitTask, { type: 'warning_notification' }>,
  ) {
    // ----------------------------------------------------------------
    // P1-11 修复（第四批 · 真正的根因）：把真实的 warning 行补齐。
    //
    // 修复前这里手工拼了一个「桩对象」，只有 id/student_id/level/window/
    // rule_id/period_start —— **既没有 metric，也没有 trigger_detail_json**。
    // 而 createNotificationJob → buildCountParams(warning) 正是从
    // warning.trigger_detail_json 里取 late_count / absent_count /
    // violation_count / course_name 的，桩对象让 buildCountParams
    // 在第 3 行就 `return {}`（detail 为 undefined）。
    //
    // 实测证据（5032 条任务全部命中）：
    //   [DBG] metric=undefined typeofDetail=undefined detail=undefined built={}
    // 结果 params_json 里永远没有计数键，ORANGE_WARNING 模板的
    // `{late_count}` 原样发给学生 —— 这才是 P1-11 的真实故障链，
    // 前几批只补了「模板侧变量名」，没补「数据源根本没传」。
    //
    // 现在按 warningId 回读一次真实行（warningId 一定存在）。
    // 回读失败时降级为桩对象 + task 上已有的元数据，绝不抛异常中断派发。
    // ----------------------------------------------------------------
    let warningRow: any = null;
    try {
      warningRow = await this.prisma.warnings.findUnique({
        where: { id: task.warningId },
        select: {
          id: true,
          student_id: true,
          level: true,
          window: true,
          metric: true,
          rule_id: true,
          period_start: true,
          trigger_detail_json: true,
          trigger_summary: true,
        },
      });
    } catch {
      warningRow = null;
    }

    await this.createNotificationJob(
      this.prisma,
      {
        id: task.warningId,
        student_id: task.studentId,
        level: task.warningLevel,
        window: task.warningWindow,
        // P1-1：把规则 id 与周期起点带进频控键，避免退化为 {student}:{level}:0:
        rule_id: task.ruleId ?? null,
        period_start: task.periodStart ?? null,
        // P1-11：计数类占位符的数据源
        metric: warningRow?.metric ?? task.warningMetric ?? '',
        trigger_detail_json: warningRow?.trigger_detail_json ?? null,
        trigger_summary: warningRow?.trigger_summary ?? task.triggerSummary,
      },
      {
        id: task.ruleId ?? null,
        metric: task.warningMetric,
        notify_strategy_json: task.notifyStrategy,
      },
      task.student,
      task.triggerSummary,
    );
  }

  private queueAbsentThresholdEmail(
    tasks: WarningPostCommitTask[],
    input: {
      warningId: string;
      studentId: string;
      studentName: string;
      studentEmail: string;
      warningLevel: string;
      warningWindow: string;
      absentCount: number;
      metric: string;
      triggerSummary: string;
    },
  ) {
    if (input.metric !== 'absent' || input.absentCount <= 0 || !input.studentEmail) {
      return;
    }

    tasks.push({
      type: 'absent_threshold_email',
      warningId: input.warningId,
      studentId: input.studentId,
      studentName: input.studentName,
      studentEmail: input.studentEmail,
      warningLevel: input.warningLevel,
      warningWindow: input.warningWindow,
      absentCount: input.absentCount,
      triggerSummary: input.triggerSummary,
    });
  }

  private queueWarningCaseSync(tasks: WarningPostCommitTask[], student: StudentContext) {
    if (tasks.some((task) => task.type === 'warning_case_sync' && task.studentId.toString() === student.id.toString())) {
      return;
    }

    tasks.push({
      type: 'warning_case_sync',
      studentId: student.id,
      student,
    });
  }

  private async runAsyncWarningCaseSync(
    task: Extract<WarningPostCommitTask, { type: 'warning_case_sync' }>,
  ) {
    await this.warningProcessingService.markStudentProcessing(
      task.studentId,
      '正在完善预警相关信息',
    );

    try {
      await this.warningCasesService.syncStudentCase(this.prisma, task.student);
      await this.warningProcessingService.clearStudentProcessing(task.studentId);
    } catch (error: any) {
      await this.warningProcessingService.markStudentFailed(
        task.studentId,
        '完善预警相关信息失败',
      );
      throw error;
    }
  }

  private toBoolean(value: unknown, fallback: boolean) {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return fallback;
  }

  private clampNumber(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  private loadAbsentEmailConfig(rawWarningConfig: any): WarningEmailConfig {
    return {
      enabled: this.toBoolean(rawWarningConfig?.absentEmailAlertEnabled, false),
      threshold: this.clampNumber(rawWarningConfig?.absentEmailThreshold, 3, 1, 999),
      templateCode:
        String(rawWarningConfig?.absentEmailTemplateCode || '').trim() ||
        'ABSENT_THRESHOLD_EMAIL',
      maxPerHour: this.clampNumber(rawWarningConfig?.maxWarningEmailsPerHour, 60, 1, 5000),
    };
  }

  private async getWarningEmailThrottleDecision(maxPerHour: number) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<WarningEmailQuotaRow[]>(Prisma.sql`
      SELECT
        COUNT(*) AS sent_count,
        MIN(nl.sent_at) AS oldest_sent_at
      FROM notification_logs nl
      INNER JOIN notification_jobs nj ON nj.id = nl.job_id
      WHERE nl.channel = 'email'
        AND nl.send_status = 'success'
        AND nl.sent_at >= ${since}
        AND (nj.warning_id IS NOT NULL OR nj.trigger_type IN ('rule', 'config'))
    `);

    const row = rows[0] || { sent_count: 0, oldest_sent_at: null };
    const sentCount = Number(row.sent_count || 0);
    const oldestSentAt = row.oldest_sent_at ? new Date(row.oldest_sent_at) : null;

    if (sentCount < maxPerHour) {
      return {
        limited: false,
        nextScheduleAt: null as Date | null,
      };
    }

    const nextScheduleAt = oldestSentAt && !Number.isNaN(oldestSentAt.getTime())
      ? new Date(oldestSentAt.getTime() + 60 * 60 * 1000 + 5_000)
      : new Date(Date.now() + 5 * 60 * 1000);

    return {
      limited: true,
      nextScheduleAt,
    };
  }

  private async queueWarningEmailJobForLater(
    task: Extract<WarningPostCommitTask, { type: 'absent_threshold_email' }>,
    templateCode: string,
    params: Record<string, any>,
    scheduleAt: Date,
  ) {
    await this.prisma.notification_jobs.create({
      data: {
        trigger_type: 'config',
        warning_id: BigInt(task.warningId),
        channel: 'email',
        template_code: templateCode,
        receivers_json: [
          {
            student_id: task.studentId,
            email: task.studentEmail,
            name: task.studentName,
          },
        ] as any,
        params_json: params as any,
        schedule_at: scheduleAt,
        status: 'queued',
        last_error: 'hourly_email_limit_exceeded',
      },
    });
  }

  private async findPendingWarningJobsByIdentity(
    tx: any,
    identity: WarningDeletionIdentity,
  ): Promise<WarningPendingJob[]> {
    const matchedWarningIds = (
      await tx.warnings.findMany({
        where: {
          student_id: identity.student_id,
          metric: identity.metric,
          level: identity.level,
          window: identity.window,
          period_start: identity.period_start,
          period_end: identity.period_end,
          course_id: identity.course_id || null,
        },
        select: { id: true },
      })
    ).map((item: any) => item.id as bigint);

    if (matchedWarningIds.length === 0) {
      return [];
    }

    return tx.notification_jobs.findMany({
      where: {
        status: { in: ['queued', 'running'] },
        warning_id: { in: matchedWarningIds },
      },
      select: {
        id: true,
      },
    });
  }

  private async deletePendingWarningJobsByIdentity(tx: any, identity: WarningDeletionIdentity) {
    const jobs = await this.findPendingWarningJobsByIdentity(tx, identity);
    if (jobs.length === 0) {
      return 0;
    }

    const jobIds = jobs.map((item) => item.id);
    await tx.notification_logs.deleteMany({
      where: { job_id: { in: jobIds } },
    });
    await tx.notification_jobs.deleteMany({
      where: { id: { in: jobIds } },
    });
    return jobIds.length;
  }

  private buildWarningDeletionIdentity(warning: any): WarningDeletionIdentity {
    return {
      student_id: warning.student_id,
      metric: String(warning.metric || ''),
      level: String(warning.level || ''),
      window: String(warning.window || ''),
      period_start: warning.period_start,
      period_end: warning.period_end,
      course_id: warning.course_id || null,
    };
  }

  async cleanupCurrentWarningNotificationJobs(tx: any, warnings: any[]) {
    let deletedCount = 0;
    for (const warning of warnings) {
      deletedCount += await this.deletePendingWarningJobsByIdentity(
        tx,
        this.buildWarningDeletionIdentity(warning),
      );
    }
    return deletedCount;
  }

  private async sendAbsentThresholdEmail(task: Extract<WarningPostCommitTask, { type: 'absent_threshold_email' }>) {
    const warningConfig = this.loadAbsentEmailConfig(
      await this.systemConfigService.getConfig('warning', {}),
    );

    if (!warningConfig.enabled || task.absentCount < warningConfig.threshold) {
      return;
    }

    if (!task.studentEmail) {
      this.logger.warn(
        `[预警] 跳过缺勤提醒邮件发送，学生邮箱为空，预警ID=${task.warningId}`,
      );
      return;
    }

    const notificationConfig = await this.systemConfigService.getSectionConfig('email', {}, ['notification']);
    const emailConfig = normalizeEmailConfig(notificationConfig);
    if (!isEmailConfigReady(emailConfig)) {
      this.logger.warn(
        `[预警] 跳过缺勤提醒邮件发送，邮件服务未配置完成，预警ID=${task.warningId}`,
      );
      return;
    }

    const basicConfig = await this.systemConfigService.getConfig('basic', {});

    let template = await this.prisma.message_templates.findFirst({
      where: {
        channel: 'email',
        template_code: warningConfig.templateCode,
        status: 'active',
      },
    });

    if (!template && warningConfig.templateCode !== 'ABSENT_THRESHOLD_EMAIL') {
      template = await this.prisma.message_templates.findFirst({
        where: {
          channel: 'email',
          template_code: 'ABSENT_THRESHOLD_EMAIL',
          status: 'active',
        },
      });
    }

    const params = {
      system_name: basicConfig?.systemName || '学业预警系统',
      student_name: task.studentName || '同学',
      student_email: task.studentEmail,
      email: task.studentEmail,
      absent_count: task.absentCount,
      absent_threshold: warningConfig.threshold,
      warning_level: task.warningLevel,
      warning_level_text: this.getWarningLevelText(task.warningLevel),
      warning_window: task.warningWindow,
      warning_window_text: this.getWindowText(task.warningWindow),
      trigger_summary: task.triggerSummary,
      warning_id: task.warningId,
    };

    const fallbackTitle = '{system_name} 缺课提醒';
    const fallbackContent =
      '您好，{student_name} 当前{warning_window_text}缺课已达到 {absent_count} 次。\n' +
      '预警级别：{warning_level_text}\n' +
      '触发说明：{trigger_summary}\n' +
      '请尽快登录系统查看详情并及时处理。';

    const subject = renderTemplate(template?.title || fallbackTitle, params);
    const text = renderTemplate(template?.content || fallbackContent, params);
    const resolvedTemplateCode = template?.template_code || warningConfig.templateCode;
    const receiver = [
      {
        student_id: task.studentId,
        email: task.studentEmail,
        name: task.studentName,
      },
    ];

    const throttleDecision = await this.getWarningEmailThrottleDecision(warningConfig.maxPerHour);
    if (throttleDecision.limited && throttleDecision.nextScheduleAt) {
      await this.queueWarningEmailJobForLater(
        task,
        resolvedTemplateCode,
        params,
        throttleDecision.nextScheduleAt,
      );
      this.logger.warn(
        `[预警] 缺勤提醒邮件触发小时限流，预警ID=${task.warningId} 已延后至 ${throttleDecision.nextScheduleAt.toISOString()}`,
      );
      return;
    }

    const job = await this.prisma.notification_jobs.create({
      data: {
        trigger_type: 'config',
        warning_id: BigInt(task.warningId),
        channel: 'email',
        template_code: resolvedTemplateCode,
        receivers_json: receiver as any,
        params_json: params as any,
        status: 'running',
      },
    });

    try {
      const result = await sendEmail(emailConfig, {
        to: task.studentEmail,
        subject,
        text,
        html: text.replace(/\n/g, '<br />'),
      });

      await this.prisma.notification_logs.create({
        data: {
          job_id: job.id,
          channel: 'email',
          receiver: task.studentEmail,
          content_snapshot: text,
          send_status: 'success',
          provider: emailConfig.provider || 'smtp',
          provider_msg_id: result.messageId || null,
          sent_at: new Date(),
          acknowledged: false,
        },
      });

      await this.prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          try_count: { increment: 1 },
          last_error: null,
        },
      });
    } catch (error: any) {
      await this.prisma.notification_logs.create({
        data: {
          job_id: job.id,
          channel: 'email',
          receiver: task.studentEmail,
          content_snapshot: text,
          send_status: 'failed',
          provider: emailConfig.provider || 'smtp',
          error_msg: error?.message || 'send_failed',
          sent_at: new Date(),
          acknowledged: false,
        },
      });

      await this.prisma.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: error?.message || 'send_failed',
        },
      });

      this.logger.error(
        `[预警] 发送缺勤提醒邮件失败，预警ID=${task.warningId}`,
        error?.stack || error?.message || String(error),
      );
    }
  }

  private getWarningLevelText(level: string) {
    const map: Record<string, string> = {
      yellow: '黄色预警',
      orange: '橙色预警',
      red: '红色预警',
      severe: '严重预警',
    };

    return map[level] || level;
  }

  private serializeRuleSnapshot(rule: any, windowType: string) {
    return {
      id: rule.id?.toString?.() || String(rule.id || ''),
      scope: this.normalizeScope(rule.scope),
      scope_id: rule.scope_id?.toString?.() || null,
      rule_version: rule.rule_version ?? 1,
      level: rule.level,
      window: windowType,
      metric: rule.metric,
      threshold: rule.threshold,
      enabled: rule.enabled,
      exclusions_json: rule.exclusions_json || null,
      notify_strategy_json: rule.notify_strategy_json || null,
      updated_at: rule.updated_at ? new Date(rule.updated_at).toISOString() : null,
    };
  }

  private buildTriggerDetail(
    metric: string,
    windowType: string,
    violationCount: number,
    courseId?: bigint,
    courseName?: string,
    triggerContext?: WarningTriggerContext,
    windowContext?: WarningWindowContext,
  ) {
    return {
      violation_type: metric,
      violation_count: violationCount,
      count_mode: this.getCountMode(metric),
      window_type: windowType,
      attendance_status: this.getMetricValue(metric),
      course_id: courseId ? courseId.toString() : null,
      course_name: courseName || (metric === CUMULATIVE_WARNING_METRIC ? '累计预警' : ''),
      session_id: triggerContext?.sessionId || null,
      session_start: this.toSecondPrecisionIsoString(triggerContext?.sessionStart),
      triggered_at: this.toSecondPrecisionIsoString(
        triggerContext?.triggerAt || triggerContext?.sessionStart || null,
      ),
      week_number: windowContext?.weekNumber || null,
      week_label: windowContext?.weekLabel || '',
    };
  }

  private async resolveWarningWindowContext(
    windowType: string,
    anchorDate: Date,
  ): Promise<WarningWindowContext> {
    if (windowType !== 'week') {
      return {};
    }

    const teachingConfig = await this.systemConfigService.getConfig('teaching', {});
    const semesterStartDate = resolveSemesterStartDate(
      teachingConfig?.semesterStartDate,
      anchorDate,
    );
    const weekInfo = getAcademicWeekInfo(anchorDate, semesterStartDate);

    return {
      weekNumber: weekInfo.weekNumber,
      weekLabel: weekInfo.weekLabel,
    };
  }

  private async resolveWarningTriggerContext(
    tx: any,
    studentId: bigint,
    metric: string,
    periodStart: Date,
    periodEnd: Date,
    courseId?: bigint,
  ): Promise<WarningTriggerContext> {
    const attendanceStatus = this.getMetricValue(metric);
    const attendanceStatuses =
      metric === CUMULATIVE_WARNING_METRIC ? ATTENDANCE_METRICS : [attendanceStatus];

    const latestSession = await tx.class_sessions.findFirst({
      where: {
        ...(courseId ? { course_id: courseId } : {}),
        session_start: {
          gte: periodStart,
          lte: periodEnd,
        },
        attendance_records: {
          some: {
            student_id: studentId,
            attendance_status: { in: attendanceStatuses },
          },
        },
      },
      orderBy: [{ session_start: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        session_start: true,
        attendance_records: {
          where: {
            student_id: studentId,
            attendance_status: { in: attendanceStatuses },
          },
          orderBy: [{ checkin_time: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            checkin_time: true,
            created_at: true,
          },
        },
      },
    });

    if (latestSession) {
      const latestRecord = latestSession.attendance_records[0];
      return {
        sessionId: latestSession.id.toString(),
        sessionStart: latestSession.session_start,
        triggerAt:
          latestRecord?.checkin_time || latestRecord?.created_at || latestSession.session_start || null,
      };
    }

    const latestDailyRecord = await tx.daily_records.findFirst({
      where: {
        student_id: studentId,
        attendance_status: { in: attendanceStatuses },
        ...(courseId ? { course_id: courseId } : {}),
        record_date: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      orderBy: [{ record_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      select: {
        created_at: true,
        record_date: true,
      },
    });

    return {
      sessionId: null,
      sessionStart: latestDailyRecord?.record_date || null,
      triggerAt: latestDailyRecord?.created_at || latestDailyRecord?.record_date || null,
    };
  }

  private getWarningDuplicateContext(warning: any) {
    if (!warning) {
      return null;
    }

    const detail = (warning.trigger_detail_json as Record<string, any>) || {};
    const sessionId = String(detail.session_id || '').trim();
    const triggerAt =
      detail.triggered_at || detail.session_start || detail.latest_session_start || warning.created_at;
    const baseParts = [
      warning.student_id?.toString?.() || '',
      warning.metric || '',
      warning.window || '',
      this.toDateOnlyKey(warning.period_start),
      this.toDateOnlyKey(warning.period_end),
      detail.course_id ? String(detail.course_id) : '',
      this.toSecondPrecisionKey(triggerAt),
    ];

    return {
      exactKey: [...baseParts.slice(0, 6), sessionId, baseParts[6]].join('_'),
      fallbackKey: [...baseParts.slice(0, 6), '', baseParts[6]].join('_'),
      hasSessionId: Boolean(sessionId),
    };
  }

  private toDateOnlyKey(value: Date | string | null | undefined) {
    if (!value) {
      return '';
    }

    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '';
  }

  private toSecondPrecisionKey(value: Date | string | null | undefined) {
    if (!value) {
      return '';
    }

    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.utc().millisecond(0).format('YYYY-MM-DDTHH:mm:ss[Z]') : '';
  }

  private toSecondPrecisionIsoString(value: Date | string | null | undefined) {
    const key = this.toSecondPrecisionKey(value);
    return key || null;
  }

  private compareBigIntDesc(left: bigint | string | number, right: bigint | string | number) {
    const leftValue = BigInt(left || 0);
    const rightValue = BigInt(right || 0);

    if (leftValue === rightValue) {
      return 0;
    }

    return leftValue > rightValue ? -1 : 1;
  }

  private buildTriggerSummary(
    student: StudentContext,
    metric: string,
    windowType: string,
    violationCount: number,
    courseName?: string,
    windowContext?: WarningWindowContext,
  ) {
    const studentName = student.users?.name || '未知学生';
    const metricText = this.getMetricText(metric);

    if (metric === CUMULATIVE_WARNING_METRIC) {
      if (windowType === 'week' && windowContext?.weekLabel) {
        return `${studentName}在${windowContext.weekLabel}${this.getCountPhrase(metric, violationCount)}，触发周预警`;
      }

      return `${studentName}${this.getWindowPrefix(windowType)}${this.getCountPhrase(metric, violationCount)}，触发${this.getWindowText(windowType)}预警`;
    }

    if (windowType === 'day') {
      if (courseName) {
        return `${studentName}在《${courseName}》课程中${metricText}，触发日预警`;
      }

      return `${studentName}${this.getWindowPrefix(windowType)}${metricText}，触发日预警`;
    }

    if (windowType === 'week' && windowContext?.weekLabel) {
      return `${studentName}在${windowContext.weekLabel}${this.getCountPhrase(metric, violationCount)}，触发周预警`;
    }

    return `${studentName}${this.getWindowPrefix(windowType)}${this.getCountPhrase(metric, violationCount)}，触发${this.getWindowText(windowType)}预警`;
  }

  private getCountMode(metric: string) {
    if (metric === CUMULATIVE_WARNING_METRIC) {
      return 'warning_times';
    }

    return this.isAttendanceMetric(metric) ? 'session_times' : 'record_times';
  }

  private getMetricText(metric: string) {
    const map: Record<string, string> = {
      late: '迟到',
      absent: '缺勤',
      early_leave: '早退',
      warning_total: '累计预警',
      // P1-6 扩展指标的中文名（预警详情/通知文案会用到）
      homework_not_submit: '作业未交',
      homework_late_submit: '作业迟交',
      class_behavior: '课堂违纪',
      leave: '请假',
      // §6.1.1 学期级与未确认指标
      failed_courses: '挂科门数',
      credits: '已修学分',
      gpa: '平均绩点',
      unacknowledged: '未确认预警',
    };

    return map[metric] || metric;
  }

  private getCountPhrase(metric: string, count: number) {
    // 学期级指标是「区间数值」而非次数，文案需按比例还原真实值，
    // 否则会输出"已修学分达到1200"这种离谱文案（内部是 ×10 定点存值）。
    const scale = TERM_METRIC_SCALE[metric];
    if (scale && scale > 1) {
      const real = (count / scale).toFixed(metric === 'gpa' ? 2 : 1);
      if (metric === 'gpa') return `平均绩点 ${real}`;
      return `已修学分 ${real}`;
    }
    if (metric === 'failed_courses') return `挂科 ${count} 门`;
    if (metric === 'unacknowledged') return `未确认预警 ${count} 条`;

    const map: Record<string, string> = {
      late: `迟到课次达到${count}次`,
      absent: `缺勤课次达到${count}次`,
      early_leave: `早退课次达到${count}次`,
      warning_total: `累计预警达到${count}次`,
      // P1-6 扩展指标的 count 短语（trigger_summary 用）
      homework_not_submit: `作业未交达到${count}次`,
      homework_late_submit: `作业迟交达到${count}次`,
      class_behavior: `课堂违纪达到${count}次`,
      leave: `请假达到${count}次`,
    };

    return map[metric] || `异常次数达到${count}次`;
  }

  private getWindowPrefix(windowType: string) {
    const map: Record<string, string> = {
      day: '今日',
      week: '本周',
      month: '本月',
      term: '本学期',
    };

    return map[windowType] || '';
  }

  private getWindowText(windowType: string) {
    const map: Record<string, string> = {
      day: '日',
      week: '周',
      month: '月',
      term: '学期',
    };

    return map[windowType] || windowType;
  }

  /**
   * 从 warnings.trigger_detail_json 提取计数类占位符（P1-11）
   *
   * 模板里写的是 `{late_count}` / `{absent_count}` 这类变量，
   * 而统计值存放在 trigger_detail_json。这里把它们并入渲染参数，
   * 避免模板渲染出字面量占位符。
   *
   * 同时补一个 `violation_count`（§8.3 登记项），取 detail 里的总数。
   */
  private buildCountParams(warning: any): Record<string, any> {
    let detail = warning?.trigger_detail_json;
    if (typeof detail === 'string') {
      try {
        detail = JSON.parse(detail);
      } catch {
        detail = null;
      }
    }
    if (!detail || typeof detail !== 'object') return {};

    const pick = (key: string) => {
      const v = (detail as Record<string, any>)[key];
      return v === null || v === undefined ? undefined : v;
    };

    const params: Record<string, any> = {};
    // 逐项只在存在时写入，避免用 undefined 覆盖已有值
    for (const key of [
      'late_count',
      'absent_count',
      'early_leave_count',
      'leave_count',
      'homework_not_submit_count',
      'homework_late_submit_count',
      'class_behavior_count',
      'violation_count',
      'total_count',
      'threshold',
      'course_name',
      'course_code',
    ]) {
      const v = pick(key);
      if (v !== undefined) params[key] = v;
    }
    // §8.3 登记的 violation_count：缺失时用 total_count 兜底
    if (params.violation_count === undefined && params.total_count !== undefined) {
      params.violation_count = params.total_count;
    }

    // ----------------------------------------------------------------
    // P1-11 修复（第三批）：分指标计数兜底。
    //
    // 真实的单指标预警走 buildTriggerDetail()（本文件 :3355），它只写
    // `violation_count`，**不写** `late_count` / `absent_count` 这些
    // 分指标键。而随包发布的 ORANGE_WARNING 模板正文是
    //   「同学你好，你本周迟到次数已达{late_count}次，请注意改善。」
    // 结果学生收到的微信/邮件里是字面量 `{late_count}`。
    //
    // 只有"课程聚合"路径（buildCourseAggregateTriggerDetail :1949 与
    // session-warning-generation.service.ts:246）才会写分指标键，
    // 所以这里必须补一次映射：预警的 metric 就是该指标自己的计数。
    // 例如 metric='late' 时 late_count 就等于 violation_count。
    // 仅在该键**确实缺失**时兜底，已有真值不覆盖。
    // ----------------------------------------------------------------
    const metric = String(warning?.metric || detail.violation_type || '').trim();
    const fallbackKey = METRIC_COUNT_PARAM[metric];
    if (fallbackKey && params[fallbackKey] === undefined) {
      const total = params.violation_count ?? params.total_count;
      if (total !== undefined) params[fallbackKey] = total;
    }

    return params;
  }

  /** 周期日期格式化为 YYYY-MM-DD（占位符 {period_start}/{period_end} 用） */
  private formatPeriodDate(value: any): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * 写入站内预警消息（复活僵尸表 `notification`）
   *
   * 幂等策略：先按 (user_id, type, content) 查最近是否已有同内容未读消息。
   * 之所以不新建唯一索引：content 是 TEXT，MySQL 无法对 TEXT 建唯一索引，
   * 且预警内容本身就是"同一句话可能合理地出现多次"（不同周期）。
   * 这里用 (user_id, type, period_start) 拼进 content 前缀做弱去重，
   * 真正的强幂等由 warning_current_states 在上游保证 —— 同一条预警
   * 不会重复进入 createNotificationJob。
   */
  private async writeInAppWarningNotification(
    tx: any,
    warning: any,
    rule: any,
    student: StudentContext,
    triggerSummary: string,
  ): Promise<void> {
    try {
      const userId = student?.user_id;
      if (userId === null || userId === undefined || String(userId).trim() === '') {
        return;
      }

      const levelText = this.getWarningLevelText(String(warning.level || ''));
      const windowText = this.getWindowText(String(warning.window || ''));
      const metricText = this.getMetricText(String(rule?.metric || warning.metric || ''));
      const periodStart = this.formatPeriodDate(warning.period_start);
      const periodEnd = this.formatPeriodDate(warning.period_end);

      const period =
        periodStart && periodEnd && periodStart !== periodEnd
          ? `${periodStart} ~ ${periodEnd}`
          : periodStart || periodEnd || '';

      const content =
        `【${levelText}】${triggerSummary}` +
        (period ? `（${windowText}统计区间：${period}）` : `（${windowText}）`) +
        `。指标：${metricText}。请及时登录系统查看并处理。`;

      await this.notificationCenter.createForUser(
        userId,
        NotificationCenterService.typeForWarningLevel(String(warning.level || '')),
        content,
        tx,
      );
    } catch (error: any) {
      // 站内消息是旁路，绝不影响预警主流程
      this.logger.warn(`[预警] 写入站内消息失败：${error?.message || error}`);
    }
  }

  private async createNotificationJob(
    tx: any,
    warning: any,
    rule: any,
    student: StudentContext,
    triggerSummary: string,
  ) {
    // ----------------------------------------------------------------
    // 站内消息（复活僵尸表 `notification`）
    //
    // 放在外部渠道循环**之前**，且只写一次：站内消息是"权威副本"，
    // 与发不发邮件/短信/微信无关。原工程这张表从未被写入，
    // 一旦外部渠道没配好（本项目的默认状态），学生就完全收不到提醒；
    // 站内消息保证"预警一定能在系统里看到"。
    //
    // 用 warning.id 作为幂等锚点：同一条预警重复派发时，
    // 先查是否已写过，避免刷屏。
    // ----------------------------------------------------------------
    await this.writeInAppWarningNotification(tx, warning, rule, student, triggerSummary);

    const notifyStrategy = (rule.notify_strategy_json as any) || {};
    const channels = this.resolveNotificationChannels(
      notifyStrategy,
      String(warning.level || ''),
      student,
    );

    for (const channel of channels) {
      const receivers = this.buildNotificationReceivers(channel, student);
      if (receivers.length === 0) {
        continue;
      }
      const job = await tx.notification_jobs.create({
        data: {
          trigger_type: 'rule',
          warning_id: warning.id,
          channel,
          template_code: 'WARNING_NOTIFICATION',
          receivers_json: receivers as any,
          params_json: {
            student_name: student.users?.name || '未知学生',
            student_no: (student as any).student_no || '',
            student_email: String(student.users?.email || student.email || '').trim().toLowerCase(),
            email: String(student.users?.email || student.email || '').trim().toLowerCase(),
            violation_type: rule.metric,
            violation_type_text: this.getMetricText(rule.metric),
            // §8.3 同时登记了 metric/metric_cn 与 violation_type/violation_type_cn
            // 两组同义变量，两者都要给，否则模板用哪一组都可能渲染成原样占位符
            metric: rule.metric,
            metric_cn: this.getMetricText(rule.metric),
            level: warning.level,
            // ------------------------------------------------------------
            // P1-11 修复（第二批）：渲染变量一律提供中文文本变体。
            //
            // 随包发布的 email 模板 ABSENT_THRESHOLD_EMAIL 正文同时用到
            // 裸变量与 _text 变量：
            //   「您好，{student_name} 当前{warning_window}缺课已达到 ... 次。
            //     预警级别：{warning_level}」
            // 派发侧（notification-dispatch.service.ts:137）直接拿
            // params_json 渲染该模板，所以 `*_text` / `*_cn` 必须齐备，
            // 否则模板渲染出的是 `week` / `orange` 这类机器码。
            //
            // 注意：**不能**把 warning_level 改成中文。
            // notification-dispatch.service.ts:378
            //   const level = params.level ?? params.warning_level;
            // 该值参与 quiet-hours 的 red/severe 强制突破判定
            // （canBreakThroughQuietHours），一旦变成「红色预警」就再也
            // 匹配不上，红色预警会被静默期挡下 —— 这是安全回归。
            // 因此 warning_level / warning_window 保持机器码，
            // 模板侧改用 warning_level_text / warning_window_text（见
            // DEFAULT_MESSAGE_TEMPLATES 中 ABSENT_THRESHOLD_EMAIL 的
            // legacyContents 升级项），显示与应用逻辑各取所需。
            // ------------------------------------------------------------
            warning_level: warning.level,
            level_cn: this.getWarningLevelText(String(warning.level || '')),
            warning_level_text: this.getWarningLevelText(String(warning.level || '')),
            warning_level_cn: this.getWarningLevelText(String(warning.level || '')),
            window: warning.window,
            warning_window: warning.window,
            window_cn: this.getWindowText(String(warning.window || '')),
            warning_window_text: this.getWindowText(String(warning.window || '')),
            warning_window_cn: this.getWindowText(String(warning.window || '')),
            warning_reason: triggerSummary,
            trigger_summary: triggerSummary,
            // ------------------------------------------------------------
            // P1-11 修复：把 trigger_detail_json 里的统计值并入渲染参数。
            //
            // 修复前这些字段**缺失**，而随包发布的模板确实在用它们：
            //   ORANGE_WARNING        : 「本周迟到次数已达{late_count}次」
            //   ABSENT_THRESHOLD_EMAIL: 「当前{warning_window}缺课已达到 {absent_count} 次」
            // 由于 renderTemplate 对未知占位符「保留原样」，
            // 学生实际收到的通知里会出现字面量 `{late_count}`、`{absent_count}`。
            // ------------------------------------------------------------
            ...this.buildCountParams(warning),
            period_start: this.formatPeriodDate(warning.period_start),
            period_end: this.formatPeriodDate(warning.period_end),
            system_name: '学业预警系统',
          },
          cooldown_key: this.buildNotificationCooldownKey(
            warning,
            rule,
            String(warning.level || ''),
            channel,
          ),
          status: 'queued',
        },
      });
    }
  }

  /**
   * 构造通知频控键（P1-1 修复）
   *
   * 修复前：`cooldown_key` 在全仓库**没有任何写入点**，
   * 导致派发侧的 `if (job.cooldown_key)` 是永不进入的死分支，
   * `notify_strategy_json.cooldown_hours` 也从未被读取 —— 同一预警会被反复发送。
   *
   * 键结构：`{studentId}:{level}:{ruleId}:{periodStart}:{channel}`
   *
   * ⚠️ 为什么必须带 `channel`：
   * 同一条预警通常同时排 email / wechat / sms 三个任务。若键里不含渠道，
   * 三者共享同一冷却键 —— 邮件一旦发送成功，微信与短信会被立刻抑制，
   * 这恰好破坏了「多渠道触达」的原本意图，也丧失了渠道降级能力。
   * 带渠道后每个渠道独立冷却，各自最多发一次。
   *
   * `periodStart` 参与构成键，因此进入下一周期（如新的一周）时键会变化，
   * 冷却不会"跨周期误杀"正常的周期性提醒。
   */
  private buildNotificationCooldownKey(
    warning: any,
    rule: any,
    level: string,
    channel: string,
  ): string {
    const studentId = String(warning?.student_id ?? '');
    const ruleId = String(rule?.id ?? warning?.rule_id ?? '0');
    const periodStart = warning?.period_start
      ? new Date(warning.period_start).toISOString().slice(0, 10)
      : '';
    return `${studentId}:${level}:${ruleId}:${periodStart}:${String(channel || '').toLowerCase()}`;
  }

  /** 冷却时长（小时）：优先规则 notify_strategy_json.cooldown_hours，默认 24 */
  private resolveCooldownHours(notifyStrategy: any): number {
    const raw = Number(notifyStrategy?.cooldown_hours);
    if (!Number.isFinite(raw) || raw < 0) {
      return 24;
    }
    // 上限 30 天，避免误配置导致预警被永久静默
    return Math.min(raw, 24 * 30);
  }

  private async createNotificationJobLegacy(
    tx: any,
    warning: any,
    rule: any,
    student: StudentContext,
    triggerSummary: string,
  ) {
    const notifyStrategy = (rule.notify_strategy_json as any) || {};
    const channels =
      Array.isArray(notifyStrategy.channels) && notifyStrategy.channels.length > 0
        ? notifyStrategy.channels
        : ['wechat'];

    for (const channel of channels) {
      const job = await tx.notification_jobs.create({
        data: {
          trigger_type: 'rule',
          warning_id: warning.id,
          channel,
          template_code: `${String(warning.level).toUpperCase()}_WARNING`,
          receivers_json: { student_id: warning.student_id.toString() },
          params_json: {
            student_name: student.users?.name || '未知学生',
            violation_type: rule.metric,
            level: warning.level,
            window: warning.window,
            trigger_summary: triggerSummary,
          },
          status: 'queued',
        },
      });

      await this.sendNotificationImmediately(tx, job, student, warning);
    }
  }

  private async sendNotificationImmediately(tx: any, job: any, student: StudentContext, warning: any) {
    try {
      if (String(job.channel || '').toLowerCase() === 'email') {
        await this.sendEmailNotificationImmediately(tx, job, student, warning);
        return;
      }

      const levelTextMap: Record<string, string> = {
        yellow: '黄色预警',
        orange: '橙色预警',
        red: '红色预警',
        severe: '严重预警',
      };

      const params = (job.params_json as any) || {};
      const content = `您收到一条${levelTextMap[warning.level] || warning.level}：${params.trigger_summary || ''}`;

      await tx.notification_jobs.update({
        where: { id: job.id },
        data: { status: 'running' },
      });

      await tx.notification_logs.create({
        data: {
          job_id: job.id,
          channel: job.channel,
          receiver: student.users?.name || '未知学生',
          content_snapshot: content,
          send_status: 'success',
          provider: 'system',
          sent_at: new Date(),
          acknowledged: false,
        },
      });

      await tx.notification_jobs.update({
        where: { id: job.id },
        data: { status: 'completed' },
      });
    } catch (error) {
      this.logger.error(
        `[预警] 发送预警通知失败，预警ID=${warning.id.toString()}`,
        error as any,
      );
      await tx.notification_jobs.update({
        where: { id: job.id },
        data: { status: 'failed' },
      });
    }
  }

  private resolveNotificationChannels(
    notifyStrategy: any,
    warningLevel: string,
    student: StudentContext,
  ): string[] {
    const configuredChannels = Array.isArray(notifyStrategy?.channels)
      ? notifyStrategy.channels
          .map((item: any) => String(item || '').trim().toLowerCase())
          // app = 站内信（写 notification 表），已实现且**不需要任何外部配置**，
          // 因此纳入可配置渠道。原先只允许 wechat/sms/email，
          // 结果是"站内信"这个唯一开箱即用的触达方式反而配不出来。
          .filter((item: string) => ['wechat', 'sms', 'email', 'app'].includes(item))
      : [];
    const channels = new Set<string>(configuredChannels);
    const studentEmail = String(student.users?.email || student.email || '').trim().toLowerCase();

    // ----------------------------------------------------------------
    // 站内信是**基线渠道**：只要该学生有 users.id，就一定要写一条站内消息。
    //
    // 理由：本系统默认没有 SMTP、没有短信网关，微信/企业微信也未实现。
    // 如果完全听从 notify_strategy_json.channels，默认配置下
    // （rules.controller 建规则时写的是 ['email','wechat']）
    // 所有通知都会落到 deferred/failed，学生在系统里什么都看不到。
    // 站内信不依赖任何外部服务，是"预警一定可达"的兜底。
    //
    // 站内消息本身在 createNotificationJob 里已经无条件写过一次
    // （writeInAppWarningNotification），这里把 app 渠道也排进队列，
    // 是为了让 notification_logs 留下可审计的投递记录。
    // ----------------------------------------------------------------
    if (student.user_id) {
      channels.add('app');
    }

    if (channels.size === 0) {
      if (studentEmail) {
        channels.add('email');
      } else {
        channels.add('wechat');
      }
    }

    if (
      studentEmail &&
      ['orange', 'red', 'severe'].includes(String(warningLevel || '').trim().toLowerCase())
    ) {
      channels.add('email');
    }

    return Array.from(channels);
  }

  private buildNotificationReceivers(channel: string, student: StudentContext) {
    const normalizedChannel = String(channel || '').trim().toLowerCase();
    const baseReceiver = {
      student_id: student.id.toString(),
      name: student.users?.name || '未知学生',
      // 站内信（app 渠道）需要 users.id 才能写 notification.user_id；
      // 带上它使 receivers_json 自解释，派发侧不必再回查学生表。
      user_id: student.user_id ? student.user_id.toString() : null,
    };
    const studentEmail = String(student.users?.email || student.email || '').trim().toLowerCase();

    if (normalizedChannel === 'email') {
      return studentEmail
        ? [
            {
              ...baseReceiver,
              email: studentEmail,
            },
          ]
        : [];
    }

    return [baseReceiver];
  }

  private async sendEmailNotificationImmediately(
    tx: any,
    job: any,
    student: StudentContext,
    warning: any,
  ) {
    const receivers = Array.isArray(job.receivers_json) ? job.receivers_json : [];
    const emailTargets = receivers
      .map((item: any) => String(item?.email || '').trim().toLowerCase())
      .filter(Boolean);
    const params = (job.params_json as Record<string, any>) || {};

    await tx.notification_jobs.update({
      where: { id: job.id },
      data: { status: 'running' },
    });

    if (emailTargets.length === 0) {
      await tx.notification_logs.create({
        data: {
          job_id: job.id,
          channel: 'email',
          receiver: '',
          content_snapshot: '',
          send_status: 'failed',
          provider: 'smtp',
          error_msg: 'no_email_receivers',
          sent_at: new Date(),
          acknowledged: false,
        },
      });
      await tx.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: 'no_email_receivers',
        },
      });
      return;
    }

    const notificationConfig = await this.systemConfigService.getSectionConfig('email', {}, ['notification']);
    const emailConfig = normalizeEmailConfig(notificationConfig);
    if (!isEmailConfigReady(emailConfig)) {
      for (const email of emailTargets) {
        await tx.notification_logs.create({
          data: {
            job_id: job.id,
            channel: 'email',
            receiver: email,
            content_snapshot: String(params.trigger_summary || '').trim(),
            send_status: 'failed',
            provider: emailConfig.provider || 'smtp',
            error_msg: 'email_config_not_ready',
            sent_at: new Date(),
            acknowledged: false,
          },
        });
      }
      await tx.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: 'email_config_not_ready',
        },
      });
      return;
    }

    const basicConfig = await this.systemConfigService.getConfig('basic', {});
    const template =
      (await this.prisma.message_templates.findFirst({
        where: {
          channel: 'email',
          template_code: String(job.template_code || 'WARNING_NOTIFICATION'),
          status: 'active',
        },
      })) ||
      (await this.prisma.message_templates.findFirst({
        where: {
          channel: 'email',
          template_code: 'WARNING_NOTIFICATION',
          status: 'active',
        },
      }));
    const renderParams = {
      ...params,
      system_name: basicConfig?.systemName || '学业预警系统',
      student_name: params.student_name || student.users?.name || '同学',
      student_email:
        params.student_email || String(student.users?.email || student.email || '').trim().toLowerCase(),
      warning_level: params.warning_level || warning.level,
      warning_level_text:
        params.warning_level_text || this.getWarningLevelText(String(warning.level || '')),
      warning_window: params.warning_window || warning.window,
      warning_window_text:
        params.warning_window_text || this.getWindowText(String(warning.window || '')),
      warning_reason: params.warning_reason || params.trigger_summary || '',
      trigger_summary: params.trigger_summary || params.warning_reason || '',
      violation_type: params.violation_type || '',
      violation_type_text:
        params.violation_type_text || this.getMetricText(String(params.violation_type || '')),
    };
    const fallbackTitle = '{system_name} 预警通知';
    const fallbackContent =
      '系统检测到新的预警信息。\n预警级别：{warning_level_text}\n预警内容：{warning_reason}\n请尽快登录系统查看详情。';
    const subject = renderTemplate(template?.title || fallbackTitle, renderParams);
    const text = renderTemplate(template?.content || fallbackContent, renderParams);

    try {
      const result = await sendEmail(emailConfig, {
        to: emailTargets,
        subject,
        text,
        html: text.replace(/\n/g, '<br />'),
      });

      for (const email of emailTargets) {
        await tx.notification_logs.create({
          data: {
            job_id: job.id,
            channel: 'email',
            receiver: email,
            content_snapshot: text,
            send_status: 'success',
            provider: emailConfig.provider || 'smtp',
            provider_msg_id: result.messageId || null,
            sent_at: new Date(),
            acknowledged: false,
          },
        });
      }

      await tx.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          try_count: { increment: 1 },
          last_error: null,
        },
      });
    } catch (error: any) {
      for (const email of emailTargets) {
        await tx.notification_logs.create({
          data: {
            job_id: job.id,
            channel: 'email',
            receiver: email,
            content_snapshot: text,
            send_status: 'failed',
            provider: emailConfig.provider || 'smtp',
            error_msg: error?.message || 'send_failed',
            sent_at: new Date(),
            acknowledged: false,
          },
        });
      }

      await tx.notification_jobs.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          try_count: { increment: 1 },
          last_error: error?.message || 'send_failed',
        },
      });

      this.logger.error(
        `[预警] 发送邮件预警通知失败，预警ID=${warning.id.toString()}`,
        error?.stack || error?.message || String(error),
      );
    }
  }

  private async sendNotificationImmediatelyLegacy(tx: any, job: any, student: StudentContext, warning: any) {
    try {
      const levelTextMap: Record<string, string> = {
        yellow: '黄色预警',
        orange: '橙色预警',
        red: '红色预警',
        severe: '严重预警',
      };

      const params = (job.params_json as any) || {};
      const content = `您收到一条${levelTextMap[warning.level] || warning.level}：${params.trigger_summary || ''}`;

      await tx.notification_jobs.update({
        where: { id: job.id },
        data: { status: 'running' },
      });

      await tx.notification_logs.create({
        data: {
          job_id: job.id,
          channel: job.channel,
          receiver: student.users?.name || '未知学生',
          content_snapshot: content,
          send_status: 'success',
          provider: 'system',
          sent_at: new Date(),
          acknowledged: false,
        },
      });

      await tx.notification_jobs.update({
        where: { id: job.id },
        data: { status: 'completed' },
      });
    } catch (error) {
      this.logger.error(
        `[预警] 发送预警通知失败，预警ID=${warning.id.toString()}`,
        error as any,
      );
      await tx.notification_jobs.update({
        where: { id: job.id },
        data: { status: 'failed' },
      });
    }
  }

  private async getCourseName(tx: any, courseId: bigint) {
    const course = await tx.courses.findUnique({
      where: { id: courseId },
      select: {
        course_name: true,
      },
    });

    return course?.course_name || '';
  }

  private getCourseKey(courseId?: bigint | null) {
    return courseId ? courseId.toString() : '__none__';
  }

  private getWarningCourseKey(warning: any) {
    if (warning?.course_key !== undefined && warning?.course_key !== null) {
      const currentCourseKey = String(warning.course_key || '').trim();
      if (currentCourseKey) {
        return currentCourseKey;
      }
    }
    const detail = (warning?.trigger_detail_json as Record<string, any>) || {};
    const rawCourseId = String(detail.course_id || '').trim();
    return rawCourseId || '__none__';
  }

  private normalizeNullableBigInt(value: bigint | number | string | null | undefined) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    try {
      return BigInt(value as any);
    } catch {
      return null;
    }
  }

  private toCountNumber(value: bigint | number | string | null | undefined) {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async loadAttendanceRecordAggregates(
    tx: any,
    studentId: bigint,
    attendanceStatus: string,
    start: Date,
    end: Date,
    courseIdHint?: bigint,
  ) {
    const rows = (await tx.$queryRaw(Prisma.sql`
      SELECT
        cs.course_id AS course_id,
        COUNT(*) AS total_count
      FROM attendance_records ar
      INNER JOIN class_sessions cs ON cs.id = ar.session_id
      WHERE ar.student_id = ${studentId}
        AND ar.attendance_status = ${attendanceStatus}
        AND cs.session_start >= ${start}
        AND cs.session_start <= ${end}
        ${courseIdHint ? Prisma.sql`AND cs.course_id = ${courseIdHint}` : Prisma.empty}
      GROUP BY cs.course_id
    `)) as AttendanceAggregateRow[];

    return rows.map((row: AttendanceAggregateRow) => ({
      courseId: this.normalizeNullableBigInt(row.course_id),
      count: this.toCountNumber(row.total_count),
    }));
  }

  private async loadAttendanceCoveredDailyKeys(
    tx: any,
    studentId: bigint,
    attendanceStatus: string,
    start: Date,
    end: Date,
    courseIdHint?: bigint,
  ) {
    const rows = (await tx.$queryRaw(Prisma.sql`
      SELECT DISTINCT
        DATE_FORMAT(cs.session_start, '%Y-%m-%d') AS session_date_key,
        cs.course_id AS course_id
      FROM attendance_records ar
      INNER JOIN class_sessions cs ON cs.id = ar.session_id
      WHERE ar.student_id = ${studentId}
        AND ar.attendance_status = ${attendanceStatus}
        AND cs.session_start >= ${start}
        AND cs.session_start <= ${end}
        ${courseIdHint ? Prisma.sql`AND cs.course_id = ${courseIdHint}` : Prisma.empty}
    `)) as AttendanceCoveredKeyRow[];

    return new Set(
      rows.map(
        (row: AttendanceCoveredKeyRow) =>
          `${String(row.session_date_key || '').trim()}_${this.normalizeNullableBigInt(row.course_id)?.toString() || ''}`,
      ),
    );
  }

  private async loadAttendanceRecordCount(
    tx: any,
    studentId: bigint,
    attendanceStatuses: string[],
    start: Date,
    end: Date,
  ) {
    const rows = (await tx.$queryRaw(Prisma.sql`
      SELECT COUNT(*) AS total_count
      FROM attendance_records ar
      INNER JOIN class_sessions cs ON cs.id = ar.session_id
      WHERE ar.student_id = ${studentId}
        AND ar.attendance_status IN (${Prisma.join(attendanceStatuses)})
        AND cs.session_start >= ${start}
        AND cs.session_start <= ${end}
    `)) as Array<{ total_count: bigint | number | string }>;

    return this.toCountNumber(rows[0]?.total_count || 0);
  }

  private async loadAttendanceRecordDistinctKeys(
    tx: any,
    studentId: bigint,
    attendanceStatuses: string[],
    start: Date,
    end: Date,
  ) {
    const rows = (await tx.$queryRaw(Prisma.sql`
      SELECT DISTINCT
        DATE_FORMAT(cs.session_start, '%Y-%m-%d') AS session_date_key,
        cs.course_id AS course_id,
        ar.attendance_status AS attendance_status
      FROM attendance_records ar
      INNER JOIN class_sessions cs ON cs.id = ar.session_id
      WHERE ar.student_id = ${studentId}
        AND ar.attendance_status IN (${Prisma.join(attendanceStatuses)})
        AND cs.session_start >= ${start}
        AND cs.session_start <= ${end}
    `)) as AttendanceCoveredKeyRow[];

    return new Set(
      rows.map(
        (row: AttendanceCoveredKeyRow) =>
          [
            String(row.session_date_key || '').trim(),
            this.normalizeNullableBigInt(row.course_id)?.toString() || '',
            String(row.attendance_status || '').trim(),
          ].join('_'),
      ),
    );
  }

  /**
   * 读取学期级指标值（§6.1.1 的 failed_courses / credits / gpa）
   *
   * 数据源：term_summaries（由 P1-5 的学期汇总任务按
   * grades.pass_status + courses.credit + grade_point 计算并 UPSERT）。
   *
   * 与"次数累加"类指标的区别：
   *  - 返回的是**区间数值**（挂科门数 / 已修学分 / GPA），不是计数值；
   *  - 阈值方向由 TERM_SUMMARY_METRICS.compare 决定（gte 或 lt），
   *    但本函数只负责"取值"，方向判断由调用方按规则阈值统一定义，
   *    因此这里直接返回该数值作为 count，让 `count >= threshold` 判定生效。
   *
   * 取哪个学期：优先用窗口起点所在日期匹配的最近学期；
   * 若传入了 courseIdHint/week 等无学期语义的窗口，则取最新学期。
   */
  private async getTermSummaryMetricValue(
    tx: any,
    studentId: bigint,
    metric: string,
    spec: { field: string; compare: 'gte' | 'lt' },
    windowType: string,
    start: Date,
  ): Promise<CourseAggregate[]> {
    // 学期窗口：直接取最新一条学期的汇总
    // 其它窗口：仍取最新学期（学分/GPA 本身是学期粒度，日/周窗口无意义，
    //          但允许管理员配置用于"随时检查当前学期状态"）
    const row = await tx.term_summaries.findFirst({
      where: { student_id: studentId },
      orderBy: { term_code: 'desc' },
    });
    if (!row) return [];

    const raw = row[spec.field];
    if (raw === null || raw === undefined) return [];

    // Prisma Decimal → 字符串/Decimal 对象；统一转 number 并保留一位小数精度
    const num = typeof raw === 'object' && typeof raw.toNumber === 'function'
      ? raw.toNumber()
      : Number(raw);
    if (!Number.isFinite(num)) return [];

    // 0 值处理：
    //  - failed_courses=0 属"正常"，不应触发
    //  - credits/gpa = 0 多因成绩库无数据，同样不应误报
    // 避免"没有数据"被当成"风险"。
    if (num <= 0) {
      if (metric !== 'failed_courses') return [];
      // failed_courses=0 时也返回空：阈值为 0 是无意义配置
      return [];
    }

    void windowType;
    void start;

    // 按 TERM_METRIC_SCALE 定点放大为整数，避免浮点比较误差
    // （例如 GPA 1.9999999 与阈值 2 的边界）
    const scale = TERM_METRIC_SCALE[metric] ?? 1;
    const scaled = Math.round(num * scale);
    return [{ courseId: null, count: scaled }];
  }

  private async getAggregateCountsByCourse(
    tx: any,
    studentId: bigint,
    metric: string,
    start: Date,
    end: Date,
    windowType: string,
    courseIdHint?: bigint,
  ) {
    if (metric === CUMULATIVE_WARNING_METRIC) {
      const totalCount = await this.getCumulativeWarningCount(tx, studentId, start, end);
      return totalCount > 0 ? [{ courseId: null, count: totalCount }] : [];
    }

    // §6.1.1 学期级指标：failed_courses / credits / gpa
    // 从 term_summaries 读取区间数值（非次数累加）
    const termMetric = TERM_SUMMARY_METRICS[metric];
    if (termMetric) {
      return this.getTermSummaryMetricValue(tx, studentId, metric, termMetric, windowType, start);
    }

    // §6.1.1 未确认预警数：活动状态且 acknowledged_at 为空
    if (metric === UNACKNOWLEDGED_METRIC) {
      const count = await tx.warnings.count({
        where: {
          student_id: studentId,
          status: { in: ACTIVE_WARNING_STATUSES },
          acknowledged_at: null,
          created_at: { gte: start, lte: end },
        },
      });
      return count > 0 ? [{ courseId: null, count }] : [];
    }

    // P1-6：homework_not_submit / homework_late_submit / class_behavior / leave
    // 全部来自 daily_records 的列值计数（这些字段只在 daily_records 上存在，
    // 不存在 attendance_records 与 daily_records 双写去重的问题）。
    const fieldMetric = DAILY_RECORD_FIELD_METRICS[metric];
    if (fieldMetric) {
      return this.countDailyRecordsByField(
        tx,
        studentId,
        fieldMetric.field,
        fieldMetric.value,
        start,
        end,
        windowType,
        courseIdHint,
      );
    }

    const value = this.getMetricValue(metric);
    const counts = new Map<string, CourseAggregate>();

    const addCount = (courseId: bigint | null, count = 1) => {
      const key = this.getCourseKey(courseId);
      const current = counts.get(key) || { courseId, count: 0 };
      current.count += count;
      counts.set(key, current);
    };

    if (this.isAttendanceMetric(metric)) {
      const aggregateByCourse = windowType === 'day' || Boolean(courseIdHint);
      const [attendanceAggregates, coveredDailyKeys] = await Promise.all([
        this.loadAttendanceRecordAggregates(tx, studentId, value, start, end, courseIdHint),
        this.loadAttendanceCoveredDailyKeys(tx, studentId, value, start, end, courseIdHint),
      ]);

      attendanceAggregates.forEach((item: CourseAggregate) => {
        addCount(item.courseId || null, item.count);
      });

      const legacyDailyRecords = await tx.daily_records.findMany({
        where: {
          student_id: studentId,
          attendance_status: value,
          ...(courseIdHint ? { course_id: courseIdHint } : {}),
          record_date: {
            gte: start,
            lte: end,
          },
        },
        select: {
          record_date: true,
          course_id: true,
        },
      });

      legacyDailyRecords.forEach((record: any) => {
        const recordDate = this.toDateOnlyKey(record.record_date);
        const recordCourseId = record.course_id || null;
        if (!coveredDailyKeys.has(`${recordDate}_${recordCourseId?.toString?.() || ''}`)) {
          addCount(recordCourseId, 1);
        }
      });

      const aggregatedCounts = Array.from(counts.values())
        .filter((item) => item.count > 0)
        .sort((left, right) => right.count - left.count);

      if (!aggregateByCourse) {
        const totalCount = aggregatedCounts.reduce((sum, item) => sum + Number(item.count || 0), 0);
        return totalCount > 0 ? [{ courseId: null, count: totalCount }] : [];
      }

      return aggregatedCounts;
    }

    const result = await tx.daily_records.groupBy({
      by: ['course_id'],
      where: {
        student_id: studentId,
        attendance_status: value,
        ...(courseIdHint ? { course_id: courseIdHint } : {}),
        record_date: {
          gte: start,
          lte: end,
        },
      },
      _count: {
        id: true,
      },
    });

    result.forEach((item: any) => {
      addCount(item.course_id || null, Number(item._count?.id || 0));
    });

    return Array.from(counts.values())
      .filter((item) => item.count > 0)
      .sort((left, right) => right.count - left.count);
  }

  private async getCumulativeWarningCount(
    tx: any,
    studentId: bigint,
    start: Date,
    end: Date,
  ) {
    const [attendanceRecordCount, coveredLegacyKeys] = await Promise.all([
      this.loadAttendanceRecordCount(tx, studentId, ATTENDANCE_METRICS, start, end),
      this.loadAttendanceRecordDistinctKeys(tx, studentId, ATTENDANCE_METRICS, start, end),
    ]);
    let totalCount = attendanceRecordCount;

    const legacyDailyRecords = await tx.daily_records.findMany({
      where: {
        student_id: studentId,
        attendance_status: { in: ATTENDANCE_METRICS },
        record_date: {
          gte: start,
          lte: end,
        },
      },
      select: {
        record_date: true,
        course_id: true,
        attendance_status: true,
      },
    });

    legacyDailyRecords.forEach((record: any) => {
      const recordDate = this.toDateOnlyKey(record.record_date);
      const courseId = record.course_id?.toString?.() || '';
      const status = String(record.attendance_status || '').trim();
      const legacyKey = `${recordDate}_${courseId}_${status}`;
      if (!coveredLegacyKeys.has(legacyKey)) {
        totalCount += 1;
      }
    });

    return totalCount;
  }

  private async getWindowBoundaries(recordDate: Date, windowType: string) {
    const dt = dayjs(recordDate).tz(DEFAULT_TZ);

    switch (windowType) {
      case 'day':
        return {
          start: dt.startOf('day').toDate(),
          end: dt.endOf('day').toDate(),
        };
      case 'week': {
        const weekday = dt.day() === 0 ? 7 : dt.day();
        const start = dt.subtract(weekday - 1, 'day').startOf('day');
        return {
          start: start.toDate(),
          end: start.add(6, 'day').endOf('day').toDate(),
        };
      }
      case 'month':
        return {
          start: dt.startOf('month').toDate(),
          end: dt.endOf('month').toDate(),
        };
      case 'term': {
        const teachingConfig = await this.systemConfigService.getConfig('teaching', {});
        const semesterStartDate = resolveSemesterStartDate(
          teachingConfig?.semesterStartDate,
          recordDate,
        );
        const semesterTotalWeeks = resolveSemesterTotalWeeks(
          teachingConfig?.semesterTotalWeeks,
        );
        const start = dayjs(semesterStartDate).tz(DEFAULT_TZ).startOf('day');
        return {
          start: start.toDate(),
          end: start.add(Math.max(1, semesterTotalWeeks) * 7 - 1, 'day').endOf('day').toDate(),
        };
      }
      default:
        return {
          start: dt.startOf('day').toDate(),
          end: dt.endOf('day').toDate(),
        };
    }
  }

  private isAttendanceMetric(metric: string) {
    return ATTENDANCE_METRICS.includes(metric);
  }

  private getMetricValue(metric: string) {
    const valueMap: Record<string, string> = {
      late: 'late',
      absent: 'absent',
      early_leave: 'early_leave',
      warning_total: 'warning_total',
      ...Object.fromEntries(
        Object.entries(DAILY_RECORD_FIELD_METRICS).map(([key, def]) => [key, def.value]),
      ),
    };

    return valueMap[metric] || metric;
  }

  /**
   * 按 daily_records 的某个列值统计次数（P1-6 扩展指标专用）。
   *
   * 与考勤指标不同，这些字段只在 daily_records 上存在，因此不需要
   * attendance_records / daily_records 双源去重。
   *
   * 聚合粒度与考勤指标保持一致：
   *  - window='day' 或指定了 courseIdHint → 按课程分组（便于定位是哪门课）
   *  - 其他窗口 → 合并为单条总计（{ courseId: null }），避免同一学生在
   *    多门课各触发一条重复预警
   */
  private async countDailyRecordsByField(
    tx: any,
    studentId: bigint,
    field: string,
    value: string,
    start: Date,
    end: Date,
    windowType: string,
    courseIdHint?: bigint,
  ): Promise<CourseAggregate[]> {
    // field 来自本文件内的白名单常量，非用户输入，故可安全用于动态键
    const where: Record<string, any> = {
      student_id: studentId,
      [field]: value,
      ...(courseIdHint ? { course_id: courseIdHint } : {}),
      record_date: { gte: start, lte: end },
    };

    const grouped = await tx.daily_records.groupBy({
      by: ['course_id'],
      where,
      _count: { id: true },
    });

    const aggregateByCourse = windowType === 'day' || Boolean(courseIdHint);

    const counts = grouped
      .map((item: any) => ({
        courseId: (item.course_id as bigint | null) || null,
        count: Number(item._count?.id || 0),
      }))
      .filter((item: CourseAggregate) => item.count > 0)
      .sort((left: CourseAggregate, right: CourseAggregate) => right.count - left.count);

    if (!aggregateByCourse) {
      const totalCount = counts.reduce(
        (sum: number, item: CourseAggregate) => sum + Number(item.count || 0),
        0,
      );
      return totalCount > 0 ? [{ courseId: null, count: totalCount }] : [];
    }

    return counts;
  }

  private getLowerWindows(windowType: string) {
    const currentIndex = WINDOW_ORDER.indexOf(windowType);
    return currentIndex <= 0 ? [] : WINDOW_ORDER.slice(0, currentIndex);
  }

  /**
   * 批量优化版：一次加载全部考勤记录，内存计算，批量写入
   * 适用于批量结束签到等场景，比逐学生处理快10-20倍
   */
  async generateWarningsBatchOptimized(
    targets: Array<{ studentId: bigint; courseId?: bigint; recordDate: Date; sessionId?: bigint }>,
  ): Promise<{ warnings_generated: number }> {
    const startedAt = Date.now();
    if (targets.length === 0) return { warnings_generated: 0 };

    // 1. 获取规则（缓存）
    const rules = await this.getRules();
    const students = await this.prisma.student_profiles.findMany({
      where: { id: { in: targets.map(t => t.studentId) } },
      select: { id: true, class_id: true, org_id: true, users: { select: { name: true, email: true } } },
    });
    const studentMap = new Map(students.map(s => [s.id.toString(), s]));

    // 2. 一次查询所有考勤记录
    const targetMap = new Map<string, { studentId: bigint; courseId?: bigint; recordDate: Date; sessionId?: bigint }>();
    for (const target of targets) {
      const key = [
        target.studentId.toString(),
        target.courseId?.toString() || '',
        this.toDateOnlyKey(target.recordDate),
      ].join('|');
      targetMap.set(key, target);
    }

    const studentIds = Array.from(new Set(targets.map(t => t.studentId.toString()))).map(id => BigInt(id));
    const courseIds = Array.from(
      new Set(targets.filter(t => t.courseId).map(t => t.courseId!.toString())),
    ).map(id => BigInt(id));

    const allRecords = await this.prisma.attendance_records.findMany({
      where: {
        student_id: { in: studentIds },
        attendance_status: { in: ['absent', 'late', 'early_leave'] },
        sessions: {
          ...(courseIds.length > 0 ? { course_id: { in: courseIds } } : {}),
        },
      },
      select: {
        student_id: true,
        attendance_status: true,
        session_id: true,
        checkin_time: true,
        sessions: {
          select: { course_id: true, session_start: true, courses: { select: { course_name: true } } },
        },
      },
    });

    // 3. 按学生+课程+日期过滤在范围内的记录
    const recalcMap = new Map<string, Array<typeof allRecords[0]>>();
    for (const r of allRecords) {
      const recordCourseId = r.sessions?.course_id?.toString() || '';
      const recordDateKey = this.toDateOnlyKey(r.sessions?.session_start);
      const targetKey = `${r.student_id.toString()}|${recordCourseId}|${recordDateKey}`;
      const studentTarget = targetMap.get(targetKey);
      if (!studentTarget) continue;
      const bucket = recalcMap.get(targetKey) || [];
      bucket.push(r);
      recalcMap.set(targetKey, bucket);
    }

    // 4. 内存计算 + 批量写入
    const currentStateRows: any[] = [];
    let genCount = 0;

    for (const [targetKey, records] of recalcMap) {
      const [studentIdStr, courseIdStr] = targetKey.split('|');
      const student = studentMap.get(studentIdStr);
      if (!student) continue;
      const studentTarget = targetMap.get(targetKey);
      if (!studentTarget) continue;

      const metrics = { absent: 0, late: 0, early_leave: 0 } as Record<string, number>;
      for (const r of records) {
        const s = r.attendance_status;
        if (s in metrics) metrics[s]++;
      }

      for (const metric of ['absent', 'late', 'early_leave']) {
        const count = metrics[metric];
        if (count === 0) continue;
        const metricRules = rules.filter(
          r => r.metric === metric && r.window === 'day' && r.enabled,
        ).sort((a, b) => b.threshold - a.threshold);

        const matchedRule = metricRules.find(r => isThresholdHit(metric, count, r.threshold));
        if (!matchedRule) continue;

        const periodDate = new Date(studentTarget.recordDate);
        const periodStart = new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), periodDate.getUTCDate()));
        const periodEnd = new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), periodDate.getUTCDate(), 23, 59, 59, 999));
        const normalizedCourseId = courseIdStr ? BigInt(courseIdStr) : null;

        // 使用统一的指标文案映射，避免扩展指标（作业/课堂表现）落到 "早退" 兜底分支
        const triggerSummary = `${this.getMetricText(metric)} ${count} 次`;

        currentStateRows.push({
          student_id: student.id, class_id: student.class_id, org_id: student.org_id || 0n,
          metric, level: matchedRule.level, window: 'day',
          period_start: periodStart, period_end: periodEnd,
          // 必须与 getCourseKey() 保持一致（裸 id / '__none__'），
          // 否则同一学生同一课程会在 current_states 里出现 'course_9' 与 '9' 两份，
          // 导致「当前预警条数」翻倍（实测 273 vs 304）。
          course_key: this.getCourseKey(normalizedCourseId),
          course_id: normalizedCourseId,
          rule_id: matchedRule.id,
          rule_snapshot_json: this.serializeRuleSnapshot(matchedRule, 'day'),
          trigger_summary: triggerSummary,
          trigger_detail_json: {
            course_id: normalizedCourseId ? Number(normalizedCourseId.toString()) : null,
            course_name: records[0]?.sessions?.courses?.course_name || '',
            violation_count: count,
            count,
            session_id: studentTarget.sessionId?.toString() || null,
          },
          status: 'open', current_count: count,
        });
        genCount++;
      }
    }

    // 5. 批量写入（与当前状态表 & 历史表原子双向同步，避免 skipDuplicates 跳过更新导致管理端与小程序不一致）
    if (currentStateRows.length > 0) {
      const levelWeight: Record<string, number> = {
        yellow: 1,
        orange: 2,
        red: 3,
        severe: 4,
      };

      await this.prisma.$transaction(async (tx) => {
        for (const row of currentStateRows) {
          const existing = await tx.warning_current_states.findFirst({
            where: {
              student_id: row.student_id,
              metric: row.metric,
              window: row.window,
              period_start: row.period_start,
              period_end: row.period_end,
              course_key: row.course_key,
            },
          });

          const existingHistoryList = await tx.warnings.findMany({
            where: {
              student_id: row.student_id,
              metric: row.metric,
              window: row.window,
              period_start: row.period_start,
              period_end: row.period_end,
              status: { in: ['open', 'acknowledged'] },
            },
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          });

          const matchedHistory = existingHistoryList.find((item: any) => {
            const itemDetail = (item.trigger_detail_json as Record<string, any>) || {};
            const itemCourseId = item.course_id
              ? item.course_id.toString()
              : String(itemDetail.course_id || '').trim();
            const itemCourseKey = itemCourseId || '__none__';
            return itemCourseKey === row.course_key;
          });

          if (!existing) {
            try {
              await tx.warning_current_states.create({ data: row });
            } catch (e2: any) {
              if (e2?.code === 'P2002') {
                await tx.warning_current_states.updateMany({
                  where: {
                    student_id: row.student_id,
                    metric: row.metric,
                    window: row.window,
                    period_start: row.period_start,
                    period_end: row.period_end,
                    course_key: row.course_key,
                  },
                  data: {
                    level: row.level,
                    rule_id: row.rule_id,
                    rule_snapshot_json: row.rule_snapshot_json,
                    trigger_summary: row.trigger_summary,
                    trigger_detail_json: row.trigger_detail_json,
                    current_count: row.current_count,
                    status: 'open',
                    acknowledged_at: null,
                    acknowledged_by: null,
                    updated_at: new Date(),
                  },
                });
              } else {
                throw e2;
              }
            }

            if (matchedHistory) {
              await tx.warnings.update({
                where: { id: matchedHistory.id },
                data: {
                  level: row.level,
                  rule_id: row.rule_id,
                  rule_snapshot_json: row.rule_snapshot_json,
                  trigger_summary: row.trigger_summary,
                  trigger_detail_json: row.trigger_detail_json,
                  status: 'open',
                  acknowledged_at: null,
                  acknowledged_by: null,
                  updated_at: new Date(),
                },
              });
            } else {
              await tx.warnings.create({
                data: {
                  student_id: row.student_id,
                  class_id: row.class_id,
                  org_id: row.org_id,
                  metric: row.metric,
                  level: row.level,
                  window: row.window,
                  period_start: row.period_start,
                  period_end: row.period_end,
                  rule_id: row.rule_id,
                  rule_snapshot_json: row.rule_snapshot_json,
                  trigger_summary: row.trigger_summary,
                  trigger_detail_json: row.trigger_detail_json,
                  course_id: row.course_id,
                  status: 'open',
                },
              });
            }
            continue;
          }

          const upgradedOrMoreViolations =
            Number(row.current_count || 0) > Number(existing.current_count || 0) ||
            (levelWeight[row.level] || 0) > (levelWeight[existing.level] || 0);
          const shouldReopen = existing.status === 'closed' || upgradedOrMoreViolations;
          const changed =
            shouldReopen ||
            row.trigger_summary !== existing.trigger_summary ||
            row.level !== existing.level ||
            Number(row.current_count || 0) !== Number(existing.current_count || 0);

          if (changed) {
            await tx.warning_current_states.update({
              where: { id: existing.id },
              data: {
                class_id: row.class_id,
                org_id: row.org_id,
                level: row.level,
                rule_id: row.rule_id,
                rule_snapshot_json: row.rule_snapshot_json,
                trigger_summary: row.trigger_summary,
                trigger_detail_json: row.trigger_detail_json,
                current_count: row.current_count,
                ...(shouldReopen
                  ? { status: 'open', acknowledged_at: null, acknowledged_by: null }
                  : {}),
                updated_at: new Date(),
              },
            });

            if (matchedHistory) {
              await tx.warnings.update({
                where: { id: matchedHistory.id },
                data: {
                  level: row.level,
                  rule_id: row.rule_id,
                  rule_snapshot_json: row.rule_snapshot_json,
                  trigger_summary: row.trigger_summary,
                  trigger_detail_json: row.trigger_detail_json,
                  ...(shouldReopen
                    ? { status: 'open', acknowledged_at: null, acknowledged_by: null }
                    : {}),
                  updated_at: new Date(),
                },
              });
            } else {
              await tx.warnings.create({
                data: {
                  student_id: row.student_id,
                  class_id: row.class_id,
                  org_id: row.org_id,
                  metric: row.metric,
                  level: row.level,
                  window: row.window,
                  period_start: row.period_start,
                  period_end: row.period_end,
                  rule_id: row.rule_id,
                  rule_snapshot_json: row.rule_snapshot_json,
                  trigger_summary: row.trigger_summary,
                  trigger_detail_json: row.trigger_detail_json,
                  course_id: row.course_id,
                  status: shouldReopen ? 'open' : existing.status,
                },
              });
            }
          }
        }
      });
    }

    this.logger.log(`[预警][批量优化] 完成 耗时=${Date.now() - startedAt}ms 学生=${studentIds.length} 记录=${allRecords.length} 生成=${genCount}`);
    return { warnings_generated: genCount };
  }

}

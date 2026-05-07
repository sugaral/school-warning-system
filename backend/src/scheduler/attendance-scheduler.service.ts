import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../config/config.service';
import { serializeForAudit } from '../shared/json.util';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { WarningQueueService } from '../warning/warning-queue.service';
import { SessionWarningGenerationService } from '../warning/session-warning-generation.service';
import { WarningService } from '../warning/warning.service';
import { WarningRecalcTarget } from '../warning/warning.types';
import { AttendanceSnapshotService } from '../attendance/attendance-snapshot.service';
import {
  buildSessionSettledKey,
  isTrustedSessionSettledValue,
  markSessionSettled,
  computeRecordDate,
  findExistingRecordStudentIds,
  getApprovedLeaveStudentIds,
} from '../attendance/attendance.utils';

const SCHEDULER_LOCK_KEY = 'lock:attendance:scheduler';
const SCHEDULER_LOCK_TTL_MS = 4 * 60 * 1000;
const ABNORMAL_ATTENDANCE_STATUSES = ['late', 'absent', 'early_leave'];
const RECENT_ENDED_RECALC_KEY_PREFIX = 'warning:scan:recent-ended';
const NIGHTLY_RECONCILE_LOCK_KEY = 'lock:warning:nightly-reconcile';

type SessionWarningProcessResult = {
  warnings_generated: number;
  warnings_enqueued: number;
  warnings_deduped: number;
  warning_queue_mode: string;
  targets_locked: number;
  can_settle: boolean;
};

@Injectable()
export class AttendanceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttendanceSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly defaultIntervalMinutes = 5;
  private currentIntervalMinutes = this.defaultIntervalMinutes;
  private nextScanAt: Date | null = null;
  private readonly sessionSettledTtlSeconds = 24 * 60 * 60;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly warningService: WarningService,
    private readonly warningQueueService: WarningQueueService,
    private readonly sessionWarningGenerationService: SessionWarningGenerationService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly attendanceSnapshotService: AttendanceSnapshotService,
  ) {}

  onModuleInit() {
    void this.startScheduler();
  }

  onModuleDestroy() {
    this.stopScheduler();
  }

  private async startScheduler() {
    this.logger.log('开始启动签到结束自动扫描调度器');
    await this.runScheduledScan();
  }

  private stopScheduler() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.nextScanAt = null;
  }

  private async scheduleNextRun(intervalMinutes?: number) {
    try {
      const resolvedIntervalMinutes = intervalMinutes || this.defaultIntervalMinutes;
      const intervalMs = resolvedIntervalMinutes * 60 * 1000;
      this.currentIntervalMinutes = resolvedIntervalMinutes;
      this.nextScanAt = new Date(Date.now() + intervalMs);

      this.logger.log(`下次签到扫描将在 ${resolvedIntervalMinutes} 分钟后执行`);

      this.timer = setTimeout(async () => {
        await this.runScheduledScan();
      }, intervalMs);
    } catch (error: any) {
      this.logger.error(
        '调度下一次签到扫描失败',
        error?.stack || error?.message || String(error),
      );
      this.currentIntervalMinutes = this.defaultIntervalMinutes;
      this.nextScanAt = new Date(Date.now() + this.defaultIntervalMinutes * 60 * 1000);

      this.timer = setTimeout(async () => {
        await this.runScheduledScan();
      }, this.defaultIntervalMinutes * 60 * 1000);
    }
  }

  private async runScheduledScan() {
    try {
      const dbHealthy = await this.prisma.checkHealth();
      if (!dbHealthy) {
        this.logger.warn('数据库不可用，跳过本轮签到扫描');
        return;
      }

      await this.handleEndedSessions();
    } finally {
      this.scheduleNextRun(this.currentIntervalMinutes).catch((error: any) => {
        this.logger.error(
          '调度下一次签到扫描失败',
          error?.stack || error?.message || String(error),
        );
      });
    }
  }

  @Cron('0 30 3 * * *', { timeZone: 'Asia/Shanghai' })
  async runNightlyRecentWarningReconcile() {
    const enabled = await this.configService.getConfig('warning.nightlyReconcileEnabled', true);
    if (String(enabled).trim().toLowerCase() === 'false') {
      return;
    }

    try {
      const days = await this.configService.getNumberConfig('warning.nightlyReconcileDays', 7);
      const lockTtlMs = await this.getNightlyReconcileLockTtlMs();
      const lockResult = await this.redis.withLock(
        NIGHTLY_RECONCILE_LOCK_KEY,
        lockTtlMs,
        async () => {
          const result = await this.warningService.reconcileRecentWarnings(days);
          const remainingTargets = Array.isArray((result as any)?.remaining_locked_targets)
            ? ((result as any).remaining_locked_targets as WarningRecalcTarget[])
            : [];
          let warningQueueMode = 'skipped';
          let warningsEnqueued = 0;
          let warningsDeduped = 0;

          if (remainingTargets.length > 0) {
            const queueResult = await this.warningQueueService.scheduleAffectedRecords(
              remainingTargets,
              'scheduler.nightly_reconcile.locked_retry',
            );
            warningQueueMode = String(queueResult?.mode || 'queued');
            warningsEnqueued = Number(queueResult?.warnings_enqueued || 0);
            warningsDeduped = Number(queueResult?.warnings_deduped || 0);
          }

          this.logger.log(
            `夜间预警对账完成：天数=${result.days} 轮次=${Number((result as any)?.reconcile_rounds || 0)} 收集=${Number((result as any)?.targets_collected || 0)} 生成=${Number((result as any)?.warnings_generated || 0)} 初始锁定=${Number((result as any)?.targets_locked_initial || 0)} 剩余锁定=${Number((result as any)?.targets_locked_remaining || 0)} 补偿模式=${warningQueueMode} 补偿入队=${warningsEnqueued} 去重=${warningsDeduped} 耗时=${Number((result as any)?.duration_ms || 0)}ms`,
          );

          return {
            ...result,
            warning_queue_mode: warningQueueMode,
            warnings_enqueued: warningsEnqueued,
            warnings_deduped: warningsDeduped,
          };
        },
      );

      if (!lockResult.locked) {
        this.logger.warn('夜间预警对账已在其他实例执行，跳过本轮');
        return;
      }
    } catch (error: any) {
      this.logger.error(
        '夜间预警对账失败',
        error?.stack || error?.message || String(error),
      );
    }
  }

  private async getNightlyReconcileLockTtlMs() {
    const configured = await this.configService.getNumberConfig(
      'warning.nightlyReconcileLockTtlMs',
      2 * 60 * 60 * 1000,
    );
    if (!Number.isFinite(configured)) {
      return 2 * 60 * 60 * 1000;
    }
    return Math.min(6 * 60 * 60 * 1000, Math.max(10 * 60 * 1000, Math.round(configured)));
  }

  @Cron('27,57 * * * *', { timeZone: 'Asia/Shanghai' })
  async runRecentEndedSessionRecovery() {
    try {
      const now = new Date();
      const recoveryResult = await this.collectRecentEndedSessionTargets(now);
      const sessionsToSettle: bigint[] = [];
      if (recoveryResult.targets.length > 0) {
        const targetGroups = this.groupTargetsBySession(recoveryResult.targets);
        for (const sessionId of recoveryResult.claimed_session_ids) {
          const targets = targetGroups.get(sessionId.toString()) || [];
          if (targets.length === 0) {
            continue;
          }
          const result = await this.processSessionWarningTargets(
            sessionId,
            targets,
            'scheduler.recover_ended_session',
          );
          this.logger.log(
            `恢复扫描课次 ${sessionId.toString()} 完成: 模式=${result.warning_queue_mode} 新建=${result.warnings_generated} 入队=${result.warnings_enqueued} 去重=${result.warnings_deduped} 锁定=${result.targets_locked} 可结算=${result.can_settle}`,
          );
          if (result.can_settle) {
            sessionsToSettle.push(sessionId);
          }
        }
        this.logger.log(
          `恢复扫描完成: 已派发 ${recoveryResult.targets.length} 个预警目标，涉及 ${recoveryResult.claimed_session_ids.length} 个课次，可结算 ${sessionsToSettle.length} 个课次`,
        );
      }

      const allRecoverySessionIds = recoveryResult.claimed_session_ids.map((id) => id);
      if (allRecoverySessionIds.length > 0) {
        this.attendanceSnapshotService
          .refreshSessions(allRecoverySessionIds)
          .catch((err: any) => this.logger.warn(`恢复扫描快照刷新失败: ${err?.message || err}`));
      }

      for (const sessionId of sessionsToSettle) {
        markSessionSettled(this.redis, sessionId, this.sessionSettledTtlSeconds, this.logger).catch(() => {});
      }
    } catch (error: any) {
      this.logger.error(
        '恢复扫描失败',
        error?.stack || error?.message || String(error),
      );
    }
  }

  async handleEndedSessions() {
    this.logger.log('开始自动处理已结束的签到课次');

    try {
      const result = await this.processEndedSessionsNow();
      if (!result) {
        this.logger.debug('未获取到调度锁，跳过本次执行');
        return;
      }

      this.logger.log(
        `自动处理完成：处理课次 ${result.sessions_processed} 个，补缺勤记录 ${result.absent_records_generated} 条，预警已按可恢复语义编排`,
      );
    } catch (error: any) {
      this.logger.error(
        '自动处理已结束签到课次失败',
        error?.stack || error?.message || String(error),
      );
    }
  }

  async processEndedSessionsNow() {
    if (this.processing) {
      return null;
    }

    this.processing = true;
    try {
      const result = await this.processEndedSessionsInternal();
      if (
        result &&
        Array.isArray((result as any).pending_warning_targets) &&
        (result as any).pending_warning_targets.length > 0
      ) {
        const queueStartedAt = Date.now();
        const queueResult = await this.warningQueueService.scheduleAffectedRecords(
          (result as any).pending_warning_targets,
          'scheduler.process_ended_sessions_async',
        );
        this.logger.log(
          `[scheduler][async-warning] ended-sessions queued mode=${queueResult?.mode || 'unknown'} enqueued=${Number(queueResult?.warnings_enqueued || 0)} deduped=${Number(queueResult?.warnings_deduped || 0)} cost=${Date.now() - queueStartedAt}ms`,
        );
        delete (result as any).pending_warning_targets;
        return {
          ...result,
          warnings_generated: Number(queueResult?.warnings_generated || 0),
          warnings_enqueued: Number(queueResult?.warnings_enqueued || 0),
          warnings_deduped: Number(queueResult?.warnings_deduped || 0),
          warning_queue_mode: String(queueResult?.mode || 'queued'),
        };
      }

      return result;
    } finally {
      this.processing = false;
    }
  }

  getScanStatus() {
    return {
      intervalMinutes: this.currentIntervalMinutes,
      nextScanAt: this.nextScanAt,
      queue: this.warningQueueService.getQueueStatus(),
    };
  }

  private toDateOnlyKey(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private buildRecalcTargetKey(target: WarningRecalcTarget) {
    return [
      target.studentId.toString(),
      this.toDateOnlyKey(target.recordDate),
      target.courseId?.toString?.() || '',
      target.sessionId?.toString?.() || '',
    ].join('_');
  }

  private addRecalcTarget(
    targetMap: Map<string, WarningRecalcTarget>,
    target: WarningRecalcTarget,
  ) {
    targetMap.set(this.buildRecalcTargetKey(target), target);
  }

  private buildRecentEndedRecalcKey(sessionId: bigint) {
    return `${RECENT_ENDED_RECALC_KEY_PREFIX}:${sessionId.toString()}`;
  }

  private groupTargetsBySession(targets: WarningRecalcTarget[]) {
    const groups = new Map<string, WarningRecalcTarget[]>();
    for (const target of targets) {
      const sessionKey = target.sessionId?.toString?.() || '';
      if (!sessionKey) {
        continue;
      }
      const list = groups.get(sessionKey) || [];
      list.push(target);
      groups.set(sessionKey, list);
    }
    return groups;
  }

  private async processSessionWarningTargets(
    sessionId: bigint,
    targets: WarningRecalcTarget[],
    source: string,
  ): Promise<SessionWarningProcessResult> {
    if (targets.length === 0) {
      this.logger.log(`[scheduler][warning] 课次=${sessionId.toString()} 无目标需重算`);
      return {
        warnings_generated: 0,
        warnings_enqueued: 0,
        warnings_deduped: 0,
        warning_queue_mode: 'noop',
        targets_locked: 0,
        can_settle: true,
      };
    }

    const startedAt = Date.now();
    this.logger.log(
      `[scheduler][warning] 课次=${sessionId.toString()} 开始同步重算 目标数=${targets.length} 来源=${source}`,
    );

    try {
      const syncResult = await this.warningService.generateWarningsForAffectedRecordsSync(targets);
      const lockedTargets = Number(syncResult?.targets_locked || 0);
      this.logger.log(
        `[scheduler][warning] 课次=${sessionId.toString()} 同步重算 耗时=${Date.now() - startedAt}ms 新建=${Number(syncResult?.warnings_generated || 0)} 锁定=${lockedTargets}`,
      );

      if (lockedTargets > 0) {
        try {
          const queueStartedAt = Date.now();
          const queueResult = await this.warningQueueService.scheduleAffectedRecords(
            targets,
            `${source}.locked_retry`,
          );
          this.logger.warn(
            `[scheduler][warning] 课次=${sessionId.toString()} 锁占用补偿入队 耗时=${Date.now() - queueStartedAt}ms 模式=${queueResult?.mode || 'unknown'} 入队=${Number(queueResult?.warnings_enqueued || 0)} 去重=${Number(queueResult?.warnings_deduped || 0)} 锁定=${lockedTargets}`,
          );
          return {
            warnings_generated: Number(syncResult?.warnings_generated || 0),
            warnings_enqueued: Number(queueResult?.warnings_enqueued || 0),
            warnings_deduped: Number(queueResult?.warnings_deduped || 0),
            warning_queue_mode: `sync_partial_locked_${queueResult?.mode || 'queued'}`,
            targets_locked: lockedTargets,
            can_settle: false,
          };
        } catch (queueError: any) {
          this.logger.error(
            `恢复扫描课次 ${sessionId.toString()} 锁占用补偿入队失败`,
            queueError?.stack || queueError?.message || String(queueError),
          );
          return {
            warnings_generated: Number(syncResult?.warnings_generated || 0),
            warnings_enqueued: 0,
            warnings_deduped: 0,
            warning_queue_mode: 'sync_partial_locked_failed',
            targets_locked: lockedTargets,
            can_settle: false,
          };
        }
      }

      return {
        warnings_generated: Number(syncResult?.warnings_generated || 0),
        warnings_enqueued: 0,
        warnings_deduped: 0,
        warning_queue_mode: 'sync',
        targets_locked: 0,
        can_settle: true,
      };
    } catch (error: any) {
      this.logger.warn(
        `恢复扫描课次 ${sessionId.toString()} 同步生成预警失败，降级为入队重试: ${error?.message || error}`,
      );
      try {
        const queueStartedAt = Date.now();
        const queueResult = await this.warningQueueService.scheduleAffectedRecords(targets, source);
        const lockedTargets = Number(queueResult?.targets_locked || 0);
        const canSettle = queueResult?.mode === 'sync_fallback' && lockedTargets === 0;
        this.logger.log(
          `[scheduler][warning] 课次=${sessionId.toString()} 降级入队 耗时=${Date.now() - queueStartedAt}ms 模式=${queueResult?.mode || 'unknown'} 新建=${Number(queueResult?.warnings_generated || 0)} 入队=${Number(queueResult?.warnings_enqueued || 0)} 锁定=${lockedTargets}`,
        );
        return {
          warnings_generated: Number(queueResult?.warnings_generated || 0),
          warnings_enqueued: Number(queueResult?.warnings_enqueued || 0),
          warnings_deduped: Number(queueResult?.warnings_deduped || 0),
          warning_queue_mode:
            queueResult?.mode === 'sync_fallback'
              ? 'sync_fallback'
              : `${queueResult?.mode || 'queued'}_fallback`,
          targets_locked: lockedTargets,
          can_settle: canSettle,
        };
      } catch (queueError: any) {
        this.logger.error(
          `恢复扫描课次 ${sessionId.toString()} 预警恢复链路也失败`,
          queueError?.stack || queueError?.message || String(queueError),
        );
        return {
          warnings_generated: 0,
          warnings_enqueued: 0,
          warnings_deduped: 0,
          warning_queue_mode: 'failed',
          targets_locked: 0,
          can_settle: false,
        };
      }
    }
  }

  private isRetryableTransactionError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2034' || error.code === 'P2028';
    }

    return /write conflict|deadlock|transaction already closed|expired transaction/i.test(
      String((error as any)?.message || error || ''),
    );
  }

  private async executeTransactionWithRetry(
    label: string,
    operationsFactory: () => Prisma.PrismaPromise<any>[],
  ): Promise<any> {
    const limit = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= limit; attempt += 1) {
      try {
        return await this.prisma.$transaction(operationsFactory());
      } catch (error) {
        lastError = error;
        if (!this.isRetryableTransactionError(error) || attempt >= limit) {
          throw error;
        }

        const delayMs = attempt * 120;
        this.logger.warn(
          `[scheduler] ${label} 写冲突，第 ${attempt} 次重试，${delayMs}ms 后重试`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  private async getEndedSessionRecoveryLookbackMinutes() {
    const fallback = Math.max(
      180,
      this.currentIntervalMinutes * 12 || this.defaultIntervalMinutes * 12,
    );
    const configured = await this.configService.getNumberConfig(
      'warning.endedSessionRecoveryMinutes',
      fallback,
    );

    if (!Number.isFinite(configured)) {
      return fallback;
    }

    return Math.min(24 * 60, Math.max(5, Math.round(configured)));
  }

  private getEndedSessionRecoveryLockTtlMs(lookbackMinutes: number) {
    const fallbackMinutes = Math.max(this.currentIntervalMinutes * 2, 5);
    return Math.min(
      lookbackMinutes * 60 * 1000,
      Math.max(fallbackMinutes, 5) * 60 * 1000,
    );
  }

  private async collectRecentEndedSessionTargets(now: Date): Promise<{
    targets: WarningRecalcTarget[];
    sessions_considered: number;
    sessions_locked: number;
    claimed_session_ids: bigint[];
  }> {
    const lookbackMinutes = await this.getEndedSessionRecoveryLookbackMinutes();
    const lookbackStart = new Date(now.getTime() - lookbackMinutes * 60 * 1000);
    const recentEndedSessions = await this.prisma.class_sessions.findMany({
      where: {
        status: 'ended',
        OR: [
          {
            session_end: {
              not: null,
              gte: lookbackStart,
              lt: now,
            },
          },
          {
            session_end: null,
            qr_expire_at: {
              gte: lookbackStart,
              lt: now,
            },
          },
        ],
      },
      select: {
        id: true,
        course_id: true,
        session_start: true,
      },
    });

    if (recentEndedSessions.length === 0) {
      return {
        targets: [],
        sessions_considered: 0,
        sessions_locked: 0,
        claimed_session_ids: [],
      };
    }

    const lockTtlMs = this.getEndedSessionRecoveryLockTtlMs(lookbackMinutes);
    const claimedSessions: typeof recentEndedSessions = [];

    for (const session of recentEndedSessions) {
      try {
        const settled = await this.redis.get(buildSessionSettledKey(session.id));
        if (isTrustedSessionSettledValue(settled)) {
          continue;
        }
      } catch {
        // ignore Redis read errors and continue with recovery
      }

      let result: string | null = null;
      let skipLock = false;
      try {
        result = await this.redis.set(
          this.buildRecentEndedRecalcKey(session.id),
          now.toISOString(),
          'PX',
          lockTtlMs,
          'NX',
        );
      } catch (error) {
        skipLock = true;
        this.logger.warn(
          `最近结束课次恢复锁失败 课次=${session.id.toString()}，继续无锁执行：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (result === 'OK' || skipLock) {
        claimedSessions.push(session);
      }
    }

    if (claimedSessions.length === 0) {
      return {
        targets: [],
        sessions_considered: recentEndedSessions.length,
        sessions_locked: 0,
        claimed_session_ids: [],
      };
    }

    const abnormalRecords = await this.prisma.attendance_records.findMany({
      where: {
        session_id: { in: claimedSessions.map((item) => item.id) },
        attendance_status: { in: ABNORMAL_ATTENDANCE_STATUSES },
      },
      select: {
        session_id: true,
        student_id: true,
      },
    });

    const sessionMap = new Map(
      claimedSessions.map((session) => [session.id.toString(), session]),
    );
    const targetMap = new Map<string, WarningRecalcTarget>();

    for (const record of abnormalRecords) {
      const session = sessionMap.get(record.session_id.toString());
      if (!session) {
        continue;
      }

      const recordDate = new Date(
        Date.UTC(
          session.session_start.getFullYear(),
          session.session_start.getMonth(),
          session.session_start.getDate(),
        ),
      );

      this.addRecalcTarget(targetMap, {
        studentId: record.student_id,
        recordDate,
        courseId: session.course_id,
        sessionId: session.id,
      });
    }

    return {
      targets: Array.from(targetMap.values()),
      sessions_considered: recentEndedSessions.length,
      sessions_locked: claimedSessions.length,
      claimed_session_ids: claimedSessions.map((session) => session.id),
    };
  }

  private async processEndedSessionsInternal() {
    const startTime = Date.now();
    const now = new Date();
    let processedCount = 0;
    let absentCount = 0;
    const affectedRecords = new Map<string, WarningRecalcTarget>();
    const sessionsToRefresh = new Set<string>();
    const sessionsToSettle = new Set<string>();

    const endedSessions = await this.prisma.class_sessions.findMany({
      where: {
        status: 'active',
        OR: [
          { session_end: { lt: now } },
          {
            session_end: null,
            qr_expire_at: { lt: now },
          },
        ],
      },
      include: {
        classes: {
          include: {
            student_profiles: true,
          },
        },
      },
    });

    this.logger.log(`找到 ${endedSessions.length} 个待处理的已结束课次`);

    for (const session of endedSessions) {
      const students = session.classes?.student_profiles || [];
      const studentIds = students.map((s: any) => s.id as bigint);
      const sessionDeadline = session.session_end || session.qr_expire_at;

      this.logger.log(
        `正在处理已结束课次 ${session.id.toString()}，涉及学生 ${students.length} 人`,
      );

      const existingRecords = await this.prisma.attendance_records.findMany({
        where: {
          session_id: session.id,
          student_id: { in: studentIds },
        },
        select: {
          student_id: true,
          attendance_status: true,
        },
      });
      const existingStudentIds = new Set(
        existingRecords.map((record: any) => record.student_id.toString()),
      );
      const recordDate = computeRecordDate(session.session_start);
      existingRecords.forEach((record: any) => {
        const status = String(record.attendance_status || '').trim();
        if (!ABNORMAL_ATTENDANCE_STATUSES.includes(status)) {
          return;
        }
        this.addRecalcTarget(affectedRecords, {
          studentId: record.student_id,
          recordDate,
          courseId: session.course_id,
          sessionId: session.id,
        });
      });

      const pendingStudents = students.filter(
        (s: any) => !existingStudentIds.has(s.id.toString()),
      );

      if (pendingStudents.length === 0) {
        await this.prisma.class_sessions.update({
          where: { id: session.id },
          data: { status: 'ended' },
        });
        sessionsToRefresh.add(session.id.toString());
        processedCount += 1;
        continue;
      }

      const approvedLeaveIds = await getApprovedLeaveStudentIds(
        this.prisma,
        pendingStudents.map((s: any) => s.id as bigint),
        session.session_start,
        sessionDeadline,
      );

      const attendanceRows: any[] = [];
      const dailyRows: any[] = [];
      const absentStudentIds: bigint[] = [];
      const leaveStudentIds: bigint[] = [];

      for (const student of pendingStudents) {
        const onApprovedLeave = approvedLeaveIds.has(student.id.toString());
        const attendanceStatus = onApprovedLeave ? 'leave' : 'absent';

        attendanceRows.push({
          session_id: session.id,
          student_id: student.id,
          checkin_time: sessionDeadline,
          attendance_status: attendanceStatus,
          source: 'system',
        });

        dailyRows.push({
          student_id: student.id,
          record_date: recordDate,
          class_id: session.class_id,
          org_id: (student as any).org_id || BigInt(0),
          course_id: session.course_id,
          attendance_status: attendanceStatus,
          homework_status: 'unknown',
          source: 'system',
          approved_status: 'approved',
        });

        if (onApprovedLeave) {
          leaveStudentIds.push(student.id);
        } else {
          absentStudentIds.push(student.id);
          this.addRecalcTarget(affectedRecords, {
            studentId: student.id,
            recordDate,
            courseId: session.course_id,
            sessionId: session.id,
          });
          absentCount += 1;
        }
      }

      try {
        await this.executeTransactionWithRetry(
          `处理已结束课次 ${session.id.toString()}`,
          () => {
            const operations: Prisma.PrismaPromise<any>[] = [];

            if (attendanceRows.length > 0) {
              operations.push(
                this.prisma.attendance_records.createMany({
                  data: attendanceRows,
                  skipDuplicates: true,
                }),
              );
              operations.push(
                this.prisma.daily_records.createMany({
                  data: dailyRows,
                  skipDuplicates: true,
                }),
              );
              if (absentStudentIds.length > 0) {
                operations.push(
                  this.prisma.daily_records.updateMany({
                    where: {
                      student_id: { in: absentStudentIds },
                      record_date: recordDate,
                      course_id: session.course_id,
                    },
                    data: {
                      attendance_status: 'absent',
                      source: 'system',
                    },
                  }),
                );
              }
              if (leaveStudentIds.length > 0) {
                operations.push(
                  this.prisma.daily_records.updateMany({
                    where: {
                      student_id: { in: leaveStudentIds },
                      record_date: recordDate,
                      course_id: session.course_id,
                    },
                    data: {
                      attendance_status: 'leave',
                      source: 'system',
                    },
                  }),
                );
              }
            }

            operations.push(
              this.prisma.class_sessions.update({
                where: { id: session.id },
                data: { status: 'ended' },
              }),
            );

            return operations;
          },
        );

        sessionsToRefresh.add(session.id.toString());
        processedCount += 1;
        this.logger.log(
          `课次 ${session.id.toString()} 处理完成，补缺勤 ${absentStudentIds.length} 条，请假 ${leaveStudentIds.length} 条`,
        );
      } catch (error: any) {
        this.logger.error(
          `处理已结束课次 ${session.id.toString()} 事务失败`,
          error?.stack || error?.message || String(error),
        );
      }
    }

    if (affectedRecords.size > 0) {
      this.logger.log(
        `预警重算改为异步入队: 目标=${affectedRecords.size} 课次=${this.groupTargetsBySession(Array.from(affectedRecords.values())).size}`,
      );
    }

    if (sessionsToRefresh.size > 0) {
      this.attendanceSnapshotService
        .refreshSessions(Array.from(sessionsToRefresh).map((sessionId) => BigInt(sessionId)))
        .catch((err: any) => this.logger.warn(`快照刷新失败: ${err?.message || err}`));
    }

    for (const sessionId of sessionsToSettle) {
      markSessionSettled(this.redis, BigInt(sessionId), this.sessionSettledTtlSeconds, this.logger).catch(
        () => {},
      );
    }

    const result = {
      sessions_processed: processedCount,
      absent_records_generated: absentCount,
      pending_warning_targets: Array.from(affectedRecords.values()),
    };

    const elapsedMs = Date.now() - startTime;
    const auditPayload = serializeForAudit(result);
    this.logger.log(
      `调度器处理完成: 耗时 ${elapsedMs}ms，处理课次 ${processedCount} 个，补缺勤 ${absentCount} 条，受影响 ${affectedRecords.size} 个目标，可结算 ${sessionsToSettle.size} 个课次`,
    );

    this.prisma.audit_logs.create({
      data: {
        actor_user_id: 0n,
        action: 'scheduler.process_ended_sessions',
        entity_type: 'class_session',
        entity_id: 0n,
        after_json: auditPayload as any,
        ip: '',
        user_agent: 'system',
      },
    }).catch(() => {
      /* 审计日志写入不阻塞主流程 */
    });

    return result;
  }
}

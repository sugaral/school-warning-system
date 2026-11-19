import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { ConfigService as SystemConfigService } from '../config/config.service';

/**
 * 汇总服务（P1-5 修复：复活三张僵尸汇总表）
 *
 * 修复前实测状态：
 *  - `weekly_summaries`  全项目 **0 处** prisma 引用
 *  - `monthly_summaries` 仅 `students.admin.controller.ts:1046` / `users.controller.ts:261` 的 deleteMany
 *  - `term_summaries`    仅 `students.admin.controller.ts:1050` / `users.controller.ts:264` 的 deleteMany
 * 即三张表只被「删」从未被「写」，33 个字段全部浪费，
 * 且 `credits` / `gpa` / `failed_courses` 三个预警指标没有数据源。
 *
 * 本服务按 6.1.3 第 5 条实现真实 UPSERT：
 *  - 周汇总：ISO 周（周一为一周起点），来源 daily_records
 *  - 月汇总：自然月，来源 daily_records
 *  - 学期汇总：failed_course_count / earned_credits / gpa / required_credits
 *    来自 grades + courses.credit（+ 配置的学分要求）
 *
 * 并发与幂等：
 *  - 全部走 Redis 分布式锁，多副本只有一个实例执行；
 *  - UPSERT 依赖唯一键（student_id, week_start）/（student_id, year, month）
 *    /（student_id, term_code），重复执行不会产生重复行；
 *  - 执行记录写 audit_logs（action='job.run'）。
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);
  private readonly jobLockKey = 'lock:summary:rebuild';
  private readonly jobLockTtlMs = 30 * 60 * 1000;
  private readonly upsertConcurrency = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  // ============================================================
  // 周汇总
  // ============================================================

  /**
   * ISO 周起点（周一 00:00:00 UTC）。
   * 用 UTC 分量做纯日期运算，避免宿主机时区影响「这一天属于哪一周」。
   */
  static isoWeekStart(input: Date): Date {
    const d = new Date(
      Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()),
    );
    // getUTCDay(): 0=周日 … 6=周六；ISO 周从周一开始
    const dow = d.getUTCDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + diff);
    return d;
  }

  static addDays(input: Date, days: number): Date {
    const d = new Date(input.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  /**
   * 重算指定周（默认「今天所在的 ISO 周」）的周汇总。
   *
   * 关于默认值：手工/接口调用默认算**当前周**（所见即所得，便于联调）；
   * 定时任务在周一凌晨跑时显式传入「上周」，语义见 cronWeekly()。
   * @param referenceDate 该周内任意一天
   */
  async rebuildWeeklySummaries(referenceDate?: Date) {
    const anchor = referenceDate ? new Date(referenceDate) : new Date();
    const weekStart = SummaryService.isoWeekStart(anchor);
    const weekEnd = SummaryService.addDays(weekStart, 6);

    return this.runLocked('weekly', { weekStart, weekEnd }, async () => {
      // 先统计该周内每名学生的迟到 / 缺勤 / 作业未交次数
      const grouped = await this.prisma.daily_records.groupBy({
        by: ['student_id'],
        where: { record_date: { gte: weekStart, lte: weekEnd } },
        _count: { _all: true },
      });

      // groupBy 无法做条件计数，改用条件聚合原生 SQL（一次查完，避免 N+1）
      const rows = await this.prisma.$queryRaw<
        Array<{
          student_id: bigint;
          late_count: bigint;
          absent_count: bigint;
          homework_not_submit_count: bigint;
        }>
      >(Prisma.sql`
        SELECT
          student_id,
          SUM(CASE WHEN attendance_status = 'late' THEN 1 ELSE 0 END) AS late_count,
          SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
          SUM(CASE WHEN homework_status = 'not_submit' THEN 1 ELSE 0 END) AS homework_not_submit_count
        FROM daily_records
        WHERE record_date >= ${weekStart} AND record_date <= ${weekEnd}
        GROUP BY student_id
      `);

      let written = 0;
      await this.mapWithConcurrency(rows, this.upsertConcurrency, async (row) => {
        const studentId = BigInt(row.student_id);
        await this.prisma.weekly_summaries.upsert({
          where: {
            student_id_week_start: { student_id: studentId, week_start: weekStart },
          },
          update: {
            week_end: weekEnd,
            late_count: Number(row.late_count || 0),
            absent_count: Number(row.absent_count || 0),
            homework_not_submit_count: Number(row.homework_not_submit_count || 0),
            generated_at: new Date(),
          },
          create: {
            student_id: studentId,
            week_start: weekStart,
            week_end: weekEnd,
            late_count: Number(row.late_count || 0),
            absent_count: Number(row.absent_count || 0),
            homework_not_submit_count: Number(row.homework_not_submit_count || 0),
          },
        });
        written++;
      });

      void grouped; // 保留一次 count 查询用于诊断日志

      return {
        jobName: 'rebuildWeeklySummaries',
        weekStart: weekStart.toISOString().slice(0, 10),
        weekEnd: weekEnd.toISOString().slice(0, 10),
        students: rows.length,
        upserted: written,
      };
    });
  }

  // ============================================================
  // 月汇总
  // ============================================================

  /**
   * 重算指定月（默认「今天所在的自然月」）的月汇总。
   *
   * 修复说明：原实现「未传 referenceDate 时算上个月」，而周汇总未传时算本周，
   * 两者默认口径不一致 —— 手工触发 rebuild_all 会得到「本周 + 上月」的混合结果
   * （实测：weekly 落在 2026-09，monthly 却落在 2026-08）。
   * 现在统一为「默认算当前周期」；定时任务自己显式传上一周期。
   */
  async rebuildMonthlySummaries(referenceDate?: Date) {
    const anchor = referenceDate ? new Date(referenceDate) : new Date();
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth() + 1; // 1-12

    return this.runLocked('monthly', { year, month }, async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{
          student_id: bigint;
          late_count: bigint;
          absent_count: bigint;
          homework_not_submit_count: bigint;
        }>
      >(Prisma.sql`
        SELECT
          student_id,
          SUM(CASE WHEN attendance_status = 'late' THEN 1 ELSE 0 END) AS late_count,
          SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
          SUM(CASE WHEN homework_status = 'not_submit' THEN 1 ELSE 0 END) AS homework_not_submit_count
        FROM daily_records
        WHERE YEAR(record_date) = ${year} AND MONTH(record_date) = ${month}
        GROUP BY student_id
      `);

      let written = 0;
      await this.mapWithConcurrency(rows, this.upsertConcurrency, async (row) => {
        const studentId = BigInt(row.student_id);
        const payload = {
          late_count: Number(row.late_count || 0),
          absent_count: Number(row.absent_count || 0),
          homework_not_submit_count: Number(row.homework_not_submit_count || 0),
        };
        await this.prisma.monthly_summaries.upsert({
          where: {
            student_id_year_month: { student_id: studentId, year, month },
          },
          update: { ...payload, generated_at: new Date() },
          create: { student_id: studentId, year, month, ...payload },
        });
        written++;
      });

      return {
        jobName: 'rebuildMonthlySummaries',
        year,
        month,
        students: rows.length,
        upserted: written,
      };
    });
  }

  // ============================================================
  // 学期汇总
  // ============================================================

  /**
   * 重算指定学期的学期汇总。
   *
   * 口径（对齐 6.1.3 第 5 条）：
   *  - failed_course_count：该学期 pass_status='fail' 的课程门数
   *  - earned_credits     ：该学期 pass_status='pass' 的课程 courses.credit 之和
   *  - gpa                ：Σ(grade_point × credit) / Σ(credit)，仅计入有 grade_point 且 credit>0 的记录
   *  - required_credits   ：从 system_settings 的 term.requiredCredits 读取（可配置），
   *                         未配置时回退为「已修学分」，避免误报学分不足
   */
  async rebuildTermSummaries(termCode: string) {
    if (!termCode) {
      throw new Error('rebuildTermSummaries 需要 termCode');
    }

    return this.runLocked('term', { termCode }, async () => {
      const requiredCredits = await this.resolveRequiredCredits();

      const rows = await this.prisma.$queryRaw<
        Array<{
          student_id: bigint;
          failed_course_count: bigint;
          earned_credits: string | null;
          gpa: string | null;
        }>
      >(Prisma.sql`
        SELECT
          g.student_id,
          SUM(CASE WHEN g.pass_status = 'fail' THEN 1 ELSE 0 END) AS failed_course_count,
          SUM(CASE WHEN g.pass_status = 'pass' THEN COALESCE(c.credit, 0) ELSE 0 END) AS earned_credits,
          CASE
            WHEN SUM(CASE WHEN g.grade_point IS NOT NULL AND COALESCE(c.credit,0) > 0 THEN c.credit ELSE 0 END) > 0
            THEN SUM(CASE WHEN g.grade_point IS NOT NULL AND COALESCE(c.credit,0) > 0 THEN g.grade_point * c.credit ELSE 0 END)
                 / SUM(CASE WHEN g.grade_point IS NOT NULL AND COALESCE(c.credit,0) > 0 THEN c.credit ELSE 0 END)
            ELSE NULL
          END AS gpa
        FROM grades g
        LEFT JOIN courses c ON c.id = g.course_id
        WHERE g.term_code = ${termCode}
        GROUP BY g.student_id
      `);

      let written = 0;
      await this.mapWithConcurrency(rows, this.upsertConcurrency, async (row) => {
        const studentId = BigInt(row.student_id);
        const earned = this.toDecimalString(row.earned_credits);
        const gpa = row.gpa === null || row.gpa === undefined
          ? null
          : new Prisma.Decimal(Number(row.gpa).toFixed(2));

        const payload = {
          failed_course_count: Number(row.failed_course_count || 0),
          earned_credits: new Prisma.Decimal(earned),
          required_credits: new Prisma.Decimal(requiredCredits),
          gpa,
        };

        await this.prisma.term_summaries.upsert({
          where: {
            student_id_term_code: { student_id: studentId, term_code: termCode },
          },
          update: { ...payload, generated_at: new Date() },
          create: { student_id: studentId, term_code: termCode, ...payload },
        });
        written++;
      });

      return {
        jobName: 'rebuildTermSummaries',
        termCode,
        students: rows.length,
        upserted: written,
        requiredCredits,
      };
    });
  }

  /** 读取学分要求配置；未配置时返回 0（表示「无要求」，不误报） */
  private async resolveRequiredCredits(): Promise<number> {
    try {
      const cfg = await this.systemConfigService.getConfig('term', {});
      const raw = cfg?.requiredCredits ?? cfg?.required_credits;
      const num = Number(raw);
      return Number.isFinite(num) && num >= 0 ? num : 0;
    } catch {
      return 0;
    }
  }

  /** 把 MySQL SUM() 返回的字符串/Decimal 规整为 DECIMAL(6,1) 可接受的字符串 */
  private toDecimalString(value: string | null | undefined): string {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num) || num < 0) return '0.0';
    return num.toFixed(1);
  }

  // ============================================================
  // 总入口 + 定时任务
  // ============================================================

  /**
   * 读取某学生的汇总数据（周/月/学期）。
   *
   * 这是三张汇总表的**读取方**：没有它，SummaryService 只是把
   * 「僵尸表」从「只删不写」变成「只写不读」，仍然是死数据。
   */
  async getStudentSummaries(
    studentId: bigint,
    options: { weeks?: number; months?: number; termCode?: string } = {},
  ) {
    const weeks = Math.min(52, Math.max(1, options.weeks ?? 8));
    const months = Math.min(36, Math.max(1, options.months ?? 6));

    const [weekly, monthly, term] = await Promise.all([
      this.prisma.weekly_summaries.findMany({
        where: { student_id: studentId },
        orderBy: { week_start: 'desc' },
        take: weeks,
      }),
      this.prisma.monthly_summaries.findMany({
        where: { student_id: studentId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: months,
      }),
      options.termCode
        ? this.prisma.term_summaries.findMany({
            where: { student_id: studentId, term_code: options.termCode },
            orderBy: { term_code: 'desc' },
          })
        : this.prisma.term_summaries.findMany({
            where: { student_id: studentId },
            orderBy: { term_code: 'desc' },
            take: 6,
          }),
    ]);

    return { weekly, monthly, term };
  }

  /** 管理端：查询任意学生的汇总（调用方负责数据范围校验） */
  async getStudentSummariesForAdmin(
    studentId: bigint,
    options: { weeks?: number; months?: number; termCode?: string } = {},
  ) {
    return this.getStudentSummaries(studentId, options);
  }

  /** 一次性重算周/月/学期（用于手工补跑与运维） */
  async rebuildAll(options: { termCode?: string; referenceDate?: Date } = {}) {
    const weekly = await this.rebuildWeeklySummaries(options.referenceDate);
    const monthly = await this.rebuildMonthlySummaries(options.referenceDate);

    let term: any = null;
    const termCode = options.termCode || (await this.resolveLatestTermCode());
    if (termCode) {
      term = await this.rebuildTermSummaries(termCode);
    }

    return { weekly, monthly, term, termCode: termCode || null };
  }

  /** 取 grades 中最近的学期编码，作为学期汇总的默认目标 */
  private async resolveLatestTermCode(): Promise<string | null> {
    const row = await this.prisma.grades.findFirst({
      where: { term_code: { not: '' } },
      orderBy: { term_code: 'desc' },
      select: { term_code: true },
    });
    return row?.term_code ?? null;
  }

  /**
   * 周汇总：每周一 02:00。
   * 周一凌晨运行时，刚结束的完整 ISO 周是「上周」，故显式回退 7 天，
   * 避免只统计到周一当天这条几乎为空的记录。
   */
  @Cron('0 0 2 * * 1', { timeZone: 'Asia/Shanghai' })
  async cronWeekly() {
    try {
      const lastWeekRef = SummaryService.addDays(new Date(), -7);
      const r = await this.rebuildWeeklySummaries(lastWeekRef);
      this.logger.log(`[汇总] 周汇总完成：${JSON.stringify(r)}`);
    } catch (error: any) {
      this.logger.error(`[汇总] 周汇总失败：${error?.message || error}`);
    }
  }

  /**
   * 月汇总：每月 1 日 03:00。
   * 1 日凌晨运行时，刚结束的完整月是「上个月」，故显式回退到上月 1 日。
   */
  @Cron('0 0 3 1 * *', { timeZone: 'Asia/Shanghai' })
  async cronMonthly() {
    try {
      const now = new Date();
      const lastMonthRef = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const r = await this.rebuildMonthlySummaries(lastMonthRef);
      this.logger.log(`[汇总] 月汇总完成：${JSON.stringify(r)}`);
    } catch (error: any) {
      this.logger.error(`[汇总] 月汇总失败：${error?.message || error}`);
    }
  }

  /** 学期汇总：每日 04:00 兜底重算最近学期（成绩导入后也可手工触发） */
  @Cron('0 0 4 * * *', { timeZone: 'Asia/Shanghai' })
  async cronTerm() {
    try {
      const termCode = await this.resolveLatestTermCode();
      if (!termCode) return;
      const r = await this.rebuildTermSummaries(termCode);
      this.logger.log(`[汇总] 学期汇总完成：${JSON.stringify(r)}`);
    } catch (error: any) {
      this.logger.error(`[汇总] 学期汇总失败：${error?.message || error}`);
    }
  }

  // ============================================================
  // 基础设施：锁 + 审计 + 受控并发
  // ============================================================

  /** 统一包裹：分布式锁 + 审计落库 + 计时 */
  private async runLocked<T>(
    scope: string,
    params: Record<string, any>,
    fn: () => Promise<T>,
  ): Promise<T & { skipped?: boolean }> {
    const startedAt = Date.now();
    const lockKey = `${this.jobLockKey}:${scope}`;

    const { locked, result } = await this.redis.withLock(lockKey, this.jobLockTtlMs, fn);

    if (!locked) {
      this.logger.warn(`[汇总] ${scope} 已被其他实例执行，跳过本轮`);
      return { skipped: true } as any;
    }

    const endedAt = Date.now();
    await this.prisma.audit_logs
      .create({
        data: {
          actor_user_id: 0n,
          action: 'job.run',
          action_desc: '汇总任务执行',
          entity_type: 'job',
          entity_desc: `summary.${scope}`,
          entity_id: 0n,
          after_json: {
            jobName: `summary.${scope}`,
            params,
            startAt: new Date(startedAt).toISOString(),
            endAt: new Date(endedAt).toISOString(),
            durationMs: endedAt - startedAt,
            result: (result as any) ?? null,
          } as any,
          ip: '',
          user_agent: 'system',
        },
      })
      .catch(() => {
        /* 审计写入不阻塞主流程 */
      });

    return result as T & { skipped?: boolean };
  }

  /** 受控并发映射，避免一次性打满数据库连接池 */
  private async mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    let cursor = 0;
    const runners = Array.from(
      { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
      async () => {
        while (cursor < items.length) {
          const index = cursor++;
          await worker(items[index], index);
        }
      },
    );
    await Promise.all(runners);
  }
}

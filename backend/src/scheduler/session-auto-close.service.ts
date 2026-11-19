import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { WarningQueueService } from '../warning/warning-queue.service';
import { WarningRecalcTarget } from '../warning/warning.types';
import { AttendanceSnapshotService } from '../attendance/attendance-snapshot.service';
import {
  computeRecordDate,
  markSessionSettled,
} from '../attendance/attendance.utils';

const ABNORMAL_ATTENDANCE_STATUSES = ['late', 'absent', 'early_leave'];
const AUTO_CLOSE_LOCK_KEY = 'lock:attendance:auto-close';
const LIVE_CACHE_PREFIX = 'attendance:live:session';
const LIVE_CACHE_TTL_SECONDS = 600;
const INSERT_CHUNK = 500;

/**
 * 课次到点自动结算（实时缺勤落库）
 *
 * 旧实现的时延：课次到期 → 最多等 5 分钟（轮询）→ 逐课次事务 → 预警同步重算。
 *
 * 本服务的做法（整批结算，把「写库」压到最低事务数）：
 *   1. 每 ATTENDANCE_AUTO_CLOSE_INTERVAL_MS（默认 1000ms）扫一次到期课次；
 *   2. 多实例靠 Redis 锁 lock:attendance:auto-close 保证只有一个实例真正结算；
 *   3. 一批到期课次一次性 CAS（active→ended），再「一次性」拉齐
 *      已有考勤 / 请假，内存里算差集；
 *   4. 批量 createMany（500 行/批）+ 按 (课程,日期) 分组 updateMany，
 *      100 个班 ≈ 10 条 INSERT 语句，而不是 100 个事务；
 *   5. 结算完成后才把预警目标统一入队（避免重算与结算抢 DB 连接）；
 *   6. 写 Redis 读镜像 attendance:live:session:{id}（只给前端秒开，不参与判定）。
 *
 * 正确性：
 *   - attendance_records @@unique([session_id, student_id]) 兜底，重复结算不会多写；
 *   - CAS 保证同一课次只有一次「active→ended」；
 *   - Redis 全丢也能靠数据库状态在下一轮补齐（最坏退化为旧语义）。
 */
@Injectable()
export class SessionAutoCloseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionAutoCloseService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly warningQueueService: WarningQueueService,
    private readonly attendanceSnapshotService: AttendanceSnapshotService,
  ) {}

  onModuleInit() {
    if (!this.isEnabled()) {
      this.logger.warn('课次到点自动结算已禁用（ATTENDANCE_AUTO_CLOSE_ENABLED=false）');
      return;
    }

    this.logger.log(
      `课次到点自动结算已启动：间隔 ${this.getIntervalMs()}ms，单轮上限 ${this.getBatchSize()}`,
    );
    this.scheduleNextTick(0);
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(delayMs: number) {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.scheduleNextTick(this.getIntervalMs()));
    }, delayMs);
    this.timer.unref?.();
  }

  /** 单轮：多实例下只有拿到锁的实例会真正结算 */
  async tick(): Promise<{ sessions: number; absent: number; costMs: number }> {
    if (this.running) {
      return { sessions: 0, absent: 0, costMs: 0 };
    }

    this.running = true;
    const startedAt = Date.now();
    const lockValue = `${process.pid}:${startedAt}`;
    let locked = false;

    try {
      locked = await this.redis.acquireLock(AUTO_CLOSE_LOCK_KEY, 10_000, lockValue);
      if (!locked) {
        return { sessions: 0, absent: 0, costMs: Date.now() - startedAt };
      }

      const now = new Date();
      const sessions = await this.prisma.class_sessions.findMany({
        where: {
          status: 'active',
          OR: [
            { session_end: { not: null, lt: now } },
            { session_end: null, qr_expire_at: { lt: now } },
          ],
        },
        orderBy: [{ session_end: 'asc' }, { qr_expire_at: 'asc' }, { id: 'asc' }],
        take: this.getBatchSize(),
        include: {
          classes: {
            select: {
              student_profiles: {
                where: { status: 'active' },
                select: { id: true, org_id: true },
              },
            },
          },
        },
      });

      if (sessions.length === 0) {
        return { sessions: 0, absent: 0, costMs: Date.now() - startedAt };
      }

      const result = await this.settleBatch(sessions);
      const costMs = Date.now() - startedAt;

      this.logger.log(
        `[auto-close] 结算完成 课次=${result.closed} 缺勤=${result.absent} 请假=${result.leave} 扫描=${sessions.length} 耗时=${costMs}ms`,
      );

      return { sessions: result.closed, absent: result.absent, costMs };
    } catch (error: any) {
      this.logger.error(
        `[auto-close] 扫描失败：${error?.message || String(error)}`,
        error?.stack,
      );
      return { sessions: 0, absent: 0, costMs: Date.now() - startedAt };
    } finally {
      if (locked) {
        await this.redis.releaseLock(AUTO_CLOSE_LOCK_KEY, lockValue).catch(() => undefined);
      }
      this.running = false;
    }
  }

  private async settleBatch(sessions: any[]): Promise<{
    closed: number;
    absent: number;
    leave: number;
  }> {
    const sessionIds: bigint[] = sessions.map((session) => session.id as bigint);

    // ① 一次性 CAS：只有这里赢下的课次才需要写考勤；输掉的也已有人写过，
    //    后续 createMany(skipDuplicates) 保证不会重复。
    const casResult = await this.prisma.class_sessions.updateMany({
      where: { id: { in: sessionIds }, status: 'active' },
      data: { status: 'ended' },
    });
    const closed = Number(casResult?.count || 0);

    // ② 一次性拉齐这批课次已有的考勤
    const existing = await this.prisma.attendance_records.findMany({
      where: { session_id: { in: sessionIds } },
      select: { session_id: true, student_id: true, attendance_status: true },
    });
    const existingKeys = new Set<string>();
    const abnormalBySession = new Map<string, bigint[]>();
    for (const record of existing) {
      const sessionKey = record.session_id.toString();
      existingKeys.add(`${sessionKey}:${record.student_id.toString()}`);
      if (ABNORMAL_ATTENDANCE_STATUSES.includes(String(record.attendance_status || '').trim())) {
        const list = abnormalBySession.get(sessionKey) || [];
        list.push(record.student_id);
        abnormalBySession.set(sessionKey, list);
      }
    }

    // ③ 计算每个课次的待补名单
    const pendingBySession = new Map<string, Array<{ id: bigint; org_id: bigint | null }>>();
    const allPendingStudentIds = new Set<string>();
    for (const session of sessions) {
      const key = (session.id as bigint).toString();
      const students: Array<{ id: bigint; org_id: bigint | null }> =
        session.classes?.student_profiles || [];
      const pending = students.filter(
        (student) => !existingKeys.has(`${key}:${student.id.toString()}`),
      );
      if (pending.length > 0) {
        pendingBySession.set(key, pending);
        for (const student of pending) {
          allPendingStudentIds.add(student.id.toString());
        }
      }
    }

    // ④ 一次性拉齐请假（时间窗取这批课次的并集，内存里按课次再过滤）
    const leaveRanges = sessions
      .map((session) => ({
        sessionId: (session.id as bigint).toString(),
        start: session.session_start as Date,
        end: (session.session_end || session.qr_expire_at) as Date,
      }))
      .filter((item) => pendingBySession.has(item.sessionId));
    const leaveStudentIds = await this.loadApprovedLeaveStudentIds(
      Array.from(allPendingStudentIds).map((id) => BigInt(id)),
      leaveRanges,
    );

    // ⑤ 组装批量写入行
    const attendanceRows: any[] = [];
    const dailyRows: any[] = [];
    const absentBySession = new Map<string, number>();
    const leaveBySession = new Map<string, number>();
    const targets: WarningRecalcTarget[] = [];

    for (const session of sessions) {
      const sessionKey = (session.id as bigint).toString();
      const pending = pendingBySession.get(sessionKey) || [];
      const recordDate = computeRecordDate(session.session_start);
      const courseId = session.course_id as bigint;
      const deadline = (session.session_end || session.qr_expire_at) as Date;

      for (const student of pending) {
        const leaveKey = `${sessionKey}:${student.id.toString()}`;
        const onApprovedLeave = leaveStudentIds.has(leaveKey);
        const attendanceStatus = onApprovedLeave ? 'leave' : 'absent';

        attendanceRows.push({
          session_id: session.id,
          student_id: student.id,
          checkin_time: deadline,
          attendance_status: attendanceStatus,
          source: 'auto_close',
        });

        dailyRows.push({
          student_id: student.id,
          record_date: recordDate,
          class_id: session.class_id,
          org_id: student.org_id || BigInt(0),
          course_id: courseId,
          attendance_status: attendanceStatus,
          homework_status: 'unknown',
          source: 'auto_close',
          approved_status: 'approved',
        });

        if (onApprovedLeave) {
          leaveBySession.set(sessionKey, (leaveBySession.get(sessionKey) || 0) + 1);
        } else {
          absentBySession.set(sessionKey, (absentBySession.get(sessionKey) || 0) + 1);
          targets.push({ studentId: student.id, recordDate, courseId, sessionId: session.id });
        }
      }

      // 已存在的迟到/早退也要重算
      for (const studentId of abnormalBySession.get(sessionKey) || []) {
        targets.push({ studentId, recordDate, courseId, sessionId: session.id });
      }
    }

    // ⑥ 批量写考勤（500 行/批）
    if (attendanceRows.length > 0) {
      for (const chunk of this.chunk(attendanceRows, INSERT_CHUNK)) {
        await this.prisma.attendance_records.createMany({ data: chunk, skipDuplicates: true });
      }
      for (const chunk of this.chunk(dailyRows, INSERT_CHUNK)) {
        await this.prisma.daily_records.createMany({ data: chunk, skipDuplicates: true });
      }
    }

    // ⑦ 日报状态按 (课程,日期) 分组纠正，避免被 skipDuplicates 折叠成旧状态
    const byCourseDate = new Map<string, { courseId: bigint; recordDate: Date; absent: bigint[]; leave: bigint[] }>();
    for (const row of dailyRows) {
      const key = `${row.course_id}:${row.record_date.toISOString().slice(0, 10)}`;
      const bucket: {
        courseId: bigint;
        recordDate: Date;
        absent: bigint[];
        leave: bigint[];
      } = byCourseDate.get(key) || {
        courseId: row.course_id as bigint,
        recordDate: row.record_date as Date,
        absent: [] as bigint[],
        leave: [] as bigint[],
      };
      if (row.attendance_status === 'absent') {
        bucket.absent.push(row.student_id);
      } else {
        bucket.leave.push(row.student_id);
      }
      byCourseDate.set(key, bucket);
    }
    for (const bucket of byCourseDate.values()) {
      if (bucket.absent.length > 0) {
        await this.prisma.daily_records.updateMany({
          where: {
            student_id: { in: bucket.absent },
            record_date: bucket.recordDate,
            course_id: bucket.courseId,
          },
          data: { attendance_status: 'absent', source: 'auto_close' },
        });
      }
      if (bucket.leave.length > 0) {
        await this.prisma.daily_records.updateMany({
          where: {
            student_id: { in: bucket.leave },
            record_date: bucket.recordDate,
            course_id: bucket.courseId,
          },
          data: { attendance_status: 'leave', source: 'auto_close' },
        });
      }
    }

    // ⑧ 读镜像 + 结算标记（pipeline，一次往返）
    const pipeline = this.redis.pipeline();
    for (const session of sessions) {
      const sessionKey = (session.id as bigint).toString();
      const total = (session.classes?.student_profiles || []).length;
      const absent = absentBySession.get(sessionKey) || 0;
      const leave = leaveBySession.get(sessionKey) || 0;
      pipeline.set(
        `${LIVE_CACHE_PREFIX}:${sessionKey}`,
        JSON.stringify({
          total,
          checked: total - (pendingBySession.get(sessionKey) || []).length,
          absent,
          leave,
          settled_at: new Date().toISOString(),
        }),
        'EX',
        LIVE_CACHE_TTL_SECONDS,
      );
    }
    try {
      await pipeline.exec();
    } catch (error: any) {
      this.logger.warn(`[auto-close] 读镜像写入失败：${error?.message || error}`);
    }
    await Promise.all(
      sessions.map((session) =>
        markSessionSettled(this.redis, session.id as bigint, 86_400, this.logger),
      ),
    );

    // ⑨ 快照异步刷新
    this.attendanceSnapshotService.refreshSessions(sessionIds).catch((error: any) =>
      this.logger.warn(`[auto-close] 快照刷新失败：${error?.message || error}`),
    );

    // ⑩ 结算完成后再统一入队预警，避免与结算抢连接
    if (targets.length > 0) {
      this.warningQueueService
        .scheduleAffectedRecords(targets, 'auto_close.session_ended')
        .then((queueResult) =>
          this.logger.log(
            `[auto-close] 预警入队 mode=${queueResult?.mode} enqueued=${queueResult?.warnings_enqueued} deduped=${queueResult?.warnings_deduped} 目标=${targets.length}`,
          ),
        )
        .catch((error: any) =>
          this.logger.error(`[auto-close] 预警入队失败：${error?.message || error}`),
        );
    }

    return {
      closed,
      absent: targets.length,
      leave: dailyRows.filter((row) => row.attendance_status === 'leave').length,
    };
  }

  /** 一次性查请假，返回 `${sessionId}:${studentId}` 集合 */
  private async loadApprovedLeaveStudentIds(
    studentIds: bigint[],
    ranges: Array<{ sessionId: string; start: Date; end: Date }>,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (studentIds.length === 0 || ranges.length === 0) {
      return result;
    }

    const minStart = new Date(Math.min(...ranges.map((item) => item.start.getTime())));
    const maxEnd = new Date(Math.max(...ranges.map((item) => item.end.getTime())));

    const leaves = await this.prisma.leave_requests.findMany({
      where: {
        student_id: { in: studentIds },
        status: 'approved',
        from_date: { lte: maxEnd },
        to_date: { gte: minStart },
      },
      select: { student_id: true, from_date: true, to_date: true },
    });

    const byStudent = new Map<string, Array<{ from: Date; to: Date }>>();
    for (const leave of leaves) {
      const key = leave.student_id.toString();
      const list = byStudent.get(key) || [];
      list.push({ from: leave.from_date as Date, to: leave.to_date as Date });
      byStudent.set(key, list);
    }

    for (const range of ranges) {
      for (const [studentId, windows] of byStudent) {
        if (windows.some((window) => window.from <= range.end && window.to >= range.start)) {
          result.add(`${range.sessionId}:${studentId}`);
        }
      }
    }

    return result;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private isEnabled() {
    return !['false', '0', 'no', 'off'].includes(
      String(process.env.ATTENDANCE_AUTO_CLOSE_ENABLED || 'true').trim().toLowerCase(),
    );
  }

  private getIntervalMs() {
    const raw = Number(process.env.ATTENDANCE_AUTO_CLOSE_INTERVAL_MS || 1000);
    if (!Number.isFinite(raw)) {
      return 1000;
    }
    return Math.min(30_000, Math.max(200, Math.round(raw)));
  }

  private getBatchSize() {
    const raw = Number(process.env.ATTENDANCE_AUTO_CLOSE_BATCH || 200);
    if (!Number.isFinite(raw)) {
      return 200;
    }
    return Math.min(1000, Math.max(1, Math.round(raw)));
  }
}

import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Post,
  Delete,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { AuthGuard } from '../shared/auth.guard';
import { Idempotent } from '../shared/idempotency.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { PermissionService } from '../rbac/permission.service';
import { Permissions, DataScope } from '../rbac/permission.decorator';
import { parseDateTimeInput, isValidSessionStart } from '../shared/date-time.util';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { WarningService } from '../warning/warning.service';
import { WarningQueueService } from '../warning/warning-queue.service';
import { WarningSnapshotService } from '../warning/warning-snapshot.service';
import { SessionWarningGenerationService } from '../warning/session-warning-generation.service';
import { ConfigService } from '../config/config.service';
import { AttendanceSnapshotService } from './attendance-snapshot.service';
import {
  getRollingQrState,
  isRollingScanTokenValid,
} from '../shared/qr-session.util';
import {
  markSessionSettled,
  computeRecordDate,
} from './attendance.utils';

const RECENT_ENDED_RECALC_KEY_PREFIX = 'warning:scan:recent-ended';
const ABNORMAL_ATTENDANCE_STATUSES = ['late', 'absent', 'early_leave'] as const;

class CreateSessionDto {
  org_id?: string;
  course_id!: string;
  class_id!: string;
  start_time!: string;
  expire_minutes?: number;
  expire_seconds?: number;
}

class BatchCreateSessionsDto {
  count!: number;
  expire_minutes?: number;
}

class BatchEndSessionsDto {
  session_ids!: string[];
}

class BatchDeleteSessionsDto {
  session_ids!: string[];
}

class BatchSessionJobDto {
  session_ids!: string[];
}

type BatchSessionJobState = {
  job_id: string;
  type: 'batch_end' | 'batch_delete';
  status: 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  success_count: number;
  skipped_count: number;
  failed_count: number;
  session_ids: string[];
  message: string;
  started_at: string;
  finished_at?: string | null;
};

type InMemoryBatchSessionJobState = {
  state: BatchSessionJobState;
  expiresAt: number;
};

class CheckinDto {
  session_id!: bigint | number;
  scan_token!: string;
  wx_openid?: string;
}

class UpdateStudentStatusDto {
  status!: string;
  late_minutes?: number;
}

/**
 * 日记录录入 DTO（P1-6）
 *
 * 背景：`daily_records.homework_status` 原先在 10 处写入点被**硬编码为 'unknown'**，
 * `class_behavior` 更是**全仓库零引用**。两者都没有任何录入入口，
 * 导致 `homework_not_submit` / `homework_late_submit` / `class_behavior`
 * 三个预警指标永远不可能被触发，两个字段彻底浪费。
 */
class DailyRecordDto {
  /** 学生档案 id（student_profiles.id） */
  student_id!: string | number;
  /** 记录日期 YYYY-MM-DD */
  record_date!: string;
  /** 课程 id —— 必填，禁止 NULL（唯一键 (student,date,course) 含 NULL 会失效） */
  course_id!: string | number;
  /** 作业状态：submitted / not_submit / late_submit / unknown */
  homework_status?: string;
  /** 课堂表现：normal / disruptive */
  class_behavior?: string;
  /** 备注，可读写 */
  remarks?: string;
}

/** 批量录入（同一班级多个学生） */
class BatchDailyRecordDto {
  records!: DailyRecordDto[];
}

@Controller('attendance')
@UseGuards(AuthGuard, PermissionGuard)
export class AttendanceController {
  private readonly logger = new Logger(AttendanceController.name);
  private readonly defaultAttendanceWindowMinutes = 15;
  private readonly sessionOptionsCacheTtlSeconds = 300;
  private readonly sessionOptionCoursesCacheTtlSeconds = 300;
  private readonly transactionRetryLimit = 3;
  private readonly sessionSettledTtlSeconds = 24 * 60 * 60;
  private readonly batchJobTtlSeconds = 24 * 60 * 60;
  private readonly inMemoryBatchJobs = new Map<string, InMemoryBatchSessionJobState>();
  private readonly inFlightDeleteSessions = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly warningService: WarningService,
    private readonly warningQueueService: WarningQueueService,
    private readonly sessionWarningGenerationService: SessionWarningGenerationService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
    private readonly attendanceSnapshotService: AttendanceSnapshotService,
    private readonly warningSnapshotService: WarningSnapshotService,
    // 用于就地解析数据范围（见 resolveDataScopeByUserId）
    private readonly permissionService: PermissionService,
  ) { }

  private isRetryableTransactionError(error: unknown) {
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
  ) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.transactionRetryLimit; attempt += 1) {
      try {
        return await this.prisma.$transaction(operationsFactory());
      } catch (error) {
        lastError = error;
        if (!this.isRetryableTransactionError(error) || attempt >= this.transactionRetryLimit) {
          throw error;
        }

        const delayMs = attempt * 120;
        this.logger.warn(
          `[attendance] ${label} 发生写冲突，第 ${attempt} 次重试，${delayMs}ms 后再次执行`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  private buildSessionStudentsSelect() {
    return {
      id: true,
      class_id: true,
      org_id: true,
      status: true,
    };
  }

  private cleanupExpiredInMemoryBatchJobs(now = Date.now()) {
    for (const [jobId, entry] of this.inMemoryBatchJobs.entries()) {
      if (entry.expiresAt <= now) {
        this.inMemoryBatchJobs.delete(jobId);
      }
    }
  }

  private setInMemoryBatchJob(job: BatchSessionJobState) {
    const expiresAt = Date.now() + this.batchJobTtlSeconds * 1000;
    this.inMemoryBatchJobs.set(job.job_id, {
      state: JSON.parse(JSON.stringify(job)) as BatchSessionJobState,
      expiresAt,
    });
  }

  private buildBatchJobKey(jobId: string) {
    return `attendance:batch-job:${jobId}`;
  }

  private getInMemoryBatchJob(jobId: string) {
    this.cleanupExpiredInMemoryBatchJobs();
    return this.inMemoryBatchJobs.get(jobId)?.state || null;
  }


  private normalizeSessionIds(sessionIds: string[]) {
    return Array.from(
      new Set(
        (Array.isArray(sessionIds) ? sessionIds : [])
          .map((item) => String(item || '').trim())
          .filter((item) => /^\d+$/.test(item)),
      ),
    );
  }

  private async mirrorBatchJobToRedis(job: BatchSessionJobState) {
    try {
      await this.redis.setCache(this.buildBatchJobKey(job.job_id), job, this.batchJobTtlSeconds);
    } catch (error: any) {
      this.logger.warn(
        `[batchJob][mirror] job=${job.job_id} type=${job.type} status=${job.status} failed=${error?.message || String(error)}`,
      );
    }
  }

  private async saveBatchJob(job: BatchSessionJobState) {
    const startedAt = Date.now();
    this.setInMemoryBatchJob(job);
    void this.mirrorBatchJobToRedis(job);
    this.logger.log(
      `[batchJob][save] job=${job.job_id} type=${job.type} status=${job.status} processed=${job.processed}/${job.total} cost=${Date.now() - startedAt}ms`,
    );
  }

  private async loadBatchJob(jobId: string) {
    const startedAt = Date.now();
    const inMemoryJob = this.getInMemoryBatchJob(jobId);
    if (inMemoryJob) {
      this.logger.log(
        `[batchJob][load] job=${jobId} source=memory hit=true status=${inMemoryJob.status || 'missing'} processed=${inMemoryJob.processed || 0}/${inMemoryJob.total || 0} cost=${Date.now() - startedAt}ms`,
      );
      return inMemoryJob;
    }

    const job = await this.redis.getCache<BatchSessionJobState>(this.buildBatchJobKey(jobId));
    if (job) {
      this.setInMemoryBatchJob(job);
    }
    this.logger.log(
      `[batchJob][load] job=${jobId} source=redis hit=${Boolean(job)} status=${job?.status || 'missing'} processed=${job?.processed || 0}/${job?.total || 0} cost=${Date.now() - startedAt}ms`,
    );
    return job;
  }

  private async getQrRefreshSeconds() {
    const configuredSeconds = await this.configService.getNumberConfig('warning.qrRefreshSeconds', 0);
    if (Number.isFinite(configuredSeconds) && configuredSeconds > 0) {
      return Math.min(7200, Math.max(5, Math.round(configuredSeconds)));
    }

    const configuredMinutes = await this.configService.getNumberConfig('warning.qrRefreshMinutes', 15);
    if (!Number.isFinite(configuredMinutes)) {
      return 900;
    }
    return Math.min(7200, Math.max(5, Math.round(configuredMinutes * 60)));
  }

  private getSessionDeadline(session: {
    session_start: Date;
    session_end?: Date | null;
    qr_expire_at: Date;
  }) {
    return session.session_end || session.qr_expire_at;
  }

  private getLateThreshold(session: {
    session_start: Date;
    session_end?: Date | null;
  }) {
    const defaultThreshold = new Date(session.session_start.getTime() + 15 * 60 * 1000);
    const sessionDeadline = session.session_end || defaultThreshold;

    return sessionDeadline.getTime() < defaultThreshold.getTime()
      ? sessionDeadline
      : defaultThreshold;
  }

  private async findClosestSchedule(
    courseId: bigint,
    classId: bigint,
    start: Date,
  ) {
    const dayStart = new Date(start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const schedules = await this.prisma.schedules.findMany({
      where: {
        course_id: courseId,
        class_id: classId,
        status: 'active',
        session_start: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      select: {
        teacher_user_id: true,
        session_start: true,
        expire_minutes: true,
      },
      orderBy: { session_start: 'asc' },
      take: 20,
    });

    if (schedules.length === 0) {
      return null;
    }

    return schedules.reduce((closest: any, current: any) => {
      const currentDiff = Math.abs(new Date(current.session_start).getTime() - start.getTime());
      const closestDiff = Math.abs(new Date(closest.session_start).getTime() - start.getTime());
      return currentDiff < closestDiff ? current : closest;
    });
  }

  private async resolveSessionDefaults(
    courseId: bigint,
    classId: bigint,
    start: Date,
    fallbackTeacherUserId: bigint,
  ) {
    const matchedSchedule = await this.findClosestSchedule(courseId, classId, start);
    const attendanceWindowMinutes = Math.max(
      1,
      Math.min(
        180,
        Number(matchedSchedule?.expire_minutes || this.defaultAttendanceWindowMinutes),
      ),
    );

    return {
      teacherUserId: matchedSchedule?.teacher_user_id || fallbackTeacherUserId,
      sessionEnd: new Date(start.getTime() + attendanceWindowMinutes * 60 * 1000),
    };
  }

  private resolveAttendanceWindowSeconds(
    dto: CreateSessionDto,
    fallbackSessionEnd: Date,
    sessionStart: Date,
  ) {
    const rawSeconds = Number(dto.expire_seconds);
    if (Number.isFinite(rawSeconds) && rawSeconds > 0) {
      return Math.min(4 * 60 * 60, Math.max(60, Math.round(rawSeconds)));
    }

    const rawMinutes = Number(dto.expire_minutes);
    if (Number.isFinite(rawMinutes) && rawMinutes > 0) {
      return Math.min(4 * 60 * 60, Math.max(60, Math.round(rawMinutes * 60)));
    }

    return Math.min(
      4 * 60 * 60,
      Math.max(60, Math.round((fallbackSessionEnd.getTime() - sessionStart.getTime()) / 1000)),
    );
  }

  private clampBatchSessionCount(value: unknown) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.min(500, Math.max(0, parsed));
  }

  private resolveBatchExpireMinutes(value: unknown) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) {
      return this.defaultAttendanceWindowMinutes;
    }

    return Math.min(240, Math.max(1, parsed));
  }

  private shuffleArray<T>(items: T[]) {
    const cloned = [...items];
    for (let index = cloned.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
    }
    return cloned;
  }

  private async buildBatchSessionCandidates(dataScope: any) {
    const classWhere: any = { status: 'active' };

    if (dataScope?.type === 'college') {
      const collegeIds = Array.isArray(dataScope.collegeIds) ? dataScope.collegeIds : [];
      if (collegeIds.length === 0) {
        return [];
      }
      classWhere.org_id = { in: collegeIds };
    } else if (dataScope?.type === 'class' || dataScope?.type === 'self') {
      const classIds = await this.resolveScopedClassIds(dataScope);
      if (!classIds || classIds.length === 0) {
        return [];
      }
      classWhere.id = { in: classIds };
    }

    const classes = await this.prisma.classes.findMany({
      where: classWhere,
      select: {
        id: true,
        org_id: true,
      },
    });

    if (classes.length === 0) {
      return [];
    }

    const classMap = new Map(
      classes.map((item: any) => [item.id.toString(), item]),
    );
    const bindings = await this.prisma.course_classes.findMany({
      where: {
        class_id: { in: classes.map((item: any) => item.id as bigint) },
      },
      select: {
        class_id: true,
        course_id: true,
        teacher_user_id: true,
      },
    });

    if (bindings.length === 0) {
      return [];
    }

    const courses = await this.prisma.courses.findMany({
      where: {
        id: {
          in: Array.from(
            new Map(bindings.map((item: any) => [item.course_id.toString(), item.course_id])).values(),
          ),
        },
        status: 'active',
      },
      select: {
        id: true,
        org_id: true,
      },
    });
    const courseMap = new Map(
      courses.map((item: any) => [item.id.toString(), item]),
    );

    return bindings
      .map((binding: any) => {
        const classInfo = classMap.get(binding.class_id.toString());
        const courseInfo = courseMap.get(binding.course_id.toString());
        if (!classInfo || !courseInfo) {
          return null;
        }
        if (classInfo.org_id.toString() !== courseInfo.org_id.toString()) {
          return null;
        }

        return {
          class_id: binding.class_id as bigint,
          course_id: binding.course_id as bigint,
          teacher_user_id: binding.teacher_user_id as bigint,
        };
      })
      .filter(Boolean) as Array<{
        class_id: bigint;
        course_id: bigint;
        teacher_user_id: bigint;
      }>;
  }

  private isSessionWithinDataScope(
    session: { class_id: bigint; classes?: { org_id: bigint } | null },
    dataScope: any,
  ) {
    if (!dataScope || dataScope.type === 'all') {
      return true;
    }

    if (dataScope.type === 'class') {
      const classIds = Array.isArray(dataScope.classIds) ? dataScope.classIds : [];
      return classIds.some((item: bigint) => item.toString() === session.class_id.toString());
    }

    if (dataScope.type === 'college') {
      const collegeIds = Array.isArray(dataScope.collegeIds) ? dataScope.collegeIds : [];
      return collegeIds.some(
        (item: bigint) => item.toString() === session.classes?.org_id?.toString?.(),
      );
    }

    if (dataScope.type === 'self') {
      const classIds = Array.isArray(dataScope.classIds) ? dataScope.classIds : [];
      if (classIds.length > 0) {
        return classIds.some((item: bigint) => item.toString() === session.class_id.toString());
      }

      return false;
    }

    return false;
  }

  private async createBatchSessions(
    count: number,
    expireMinutes: number,
    req: any,
  ) {
    const dataScope = req?.dataScope || { type: 'all' };
    const requestedCount = this.clampBatchSessionCount(count);
    if (requestedCount <= 0) {
      return {
        created_count: 0,
        session_ids: [] as string[],
      };
    }

    const candidates = await this.buildBatchSessionCandidates(dataScope);
    if (candidates.length === 0) {
      return null;
    }

    const userId = this.getRequestUserId(req) || 0n;
    const qrRefreshSeconds = await this.getQrRefreshSeconds();
    const now = Date.now();
    const rows: any[] = [];
    const qrHashes: string[] = [];
    const candidatesByClass = new Map<string, Array<{
      class_id: bigint;
      course_id: bigint;
      teacher_user_id: bigint;
    }>>();

    for (const candidate of candidates) {
      const classKey = candidate.class_id.toString();
      const current = candidatesByClass.get(classKey) || [];
      current.push(candidate);
      candidatesByClass.set(classKey, current);
    }

    const selectedTemplates = this.shuffleArray(Array.from(candidatesByClass.values()))
      .slice(0, Math.min(5, candidatesByClass.size))
      .map((classCandidates) => classCandidates[Math.floor(Math.random() * classCandidates.length)]);
    const templates = selectedTemplates.length > 0 ? selectedTemplates : candidates;

    for (let index = 0; index < requestedCount; index += 1) {
      const candidate = templates[index % templates.length];
      const startedSecondsAgo = 30 + Math.floor(Math.random() * 240);
      const start = new Date(now - startedSecondsAgo * 1000 - index * 1000);
      const sessionEnd = new Date(start.getTime() + expireMinutes * 60 * 1000);
      const qrExpireAt = new Date(start.getTime() + qrRefreshSeconds * 1000);
      const salt = randomBytes(8).toString('hex');
      const qrTokenHash = createHash('sha256')
        .update(
          `${candidate.class_id.toString()}:${candidate.course_id.toString()}:${start.toISOString()}:${salt}`,
        )
        .digest('hex');

      rows.push({
        course_id: candidate.course_id,
        class_id: candidate.class_id,
        teacher_user_id: candidate.teacher_user_id || userId,
        session_start: start,
        session_end: sessionEnd,
        qr_token_hash: qrTokenHash,
        qr_expire_at: qrExpireAt,
        status: 'active',
      });
      qrHashes.push(qrTokenHash);
    }

    await this.prisma.class_sessions.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const createdSessions = await this.prisma.class_sessions.findMany({
      where: {
        qr_token_hash: { in: qrHashes },
      },
      select: {
        id: true,
      },
      orderBy: [{ id: 'desc' }],
    });

    await this.attendanceSnapshotService.refreshSessions(
      createdSessions.map((item: any) => item.id),
    );

    return {
      created_count: createdSessions.length,
      session_ids: createdSessions.map((item: any) => item.id.toString()),
    };
  }

  private async processSingleEndSession(
    sessionId: string,
    dataScope: any,
    options?: { deferWarnings?: boolean },
  ) {
    const startedAt = Date.now();
    const lockKey = `lock:session:end:${sessionId}`;
    this.logger.log(`[batchEnd][single] session=${sessionId} started`);
    const lockResult = await this.redis.withLock(lockKey, 60_000, async () => {
      const session = await this.prisma.class_sessions.findUnique({
        where: { id: BigInt(sessionId) },
        include: {
          classes: {
            select: {
              org_id: true,
              student_profiles: {
                where: { status: 'active' },
                select: this.buildSessionStudentsSelect(),
              },
            },
          },
        },
      });

      if (!session) {
        this.logger.log(`[batchEnd][single] session=${sessionId} skipped reason=missing`);
        return { ended: false, warningTargets: [] as any[] };
      }
      if (!this.isSessionWithinDataScope(session, dataScope)) {
        this.logger.log(`[batchEnd][single] session=${sessionId} skipped reason=scope`);
        return { ended: false, warningTargets: [] as any[] };
      }

      const now = new Date();
      if (session.status !== 'active') {
        this.logger.log(`[batchEnd][single] session=${sessionId} skipped reason=not-active`);
        return { ended: false, warningTargets: [] as any[] };
      }

      const changed = await this.markSessionEndedFast(session.id, now);
      if (!changed) {
        return { ended: false, warningTargets: [] as any[] };
      }
      const finalized = await this.finalizeSessionEarly(session, now, {
        skipWarningGeneration: Boolean(options?.deferWarnings),
      });
      return { ended: true, warningTargets: finalized.warningTargets || [] };
    });

    const ended = Boolean(lockResult.locked && lockResult.result?.ended);
    const warningTargets = lockResult.locked ? (lockResult.result?.warningTargets || []) : [];
    this.logger.log(
      `[batchEnd][single] session=${sessionId} locked=${lockResult.locked} ended=${ended} cost=${Date.now() - startedAt}ms`,
    );
    return { ended, warningTargets };
  }

  private async processSingleDeleteSession(sessionIdText: string, dataScope: any) {
    if (this.inFlightDeleteSessions.has(sessionIdText)) {
      return {
        deleted: false,
        affectedStudentIds: [],
        recalcTargets: [],
        deletedWarningsCount: 0,
        affectedStudentsCount: 0,
      };
    }

    this.inFlightDeleteSessions.add(sessionIdText);
    try {
      const session = await this.prisma.class_sessions.findUnique({
        where: { id: BigInt(sessionIdText) },
        include: {
          classes: {
            select: {
              org_id: true,
            },
          },
        },
      });

      if (!session || !this.isSessionWithinDataScope(session, dataScope)) {
        return {
          deleted: false,
          affectedStudentIds: [] as bigint[],
          recalcTargets: [] as Array<{
            studentId: bigint;
            recordDate: Date;
            courseId?: bigint;
          }>,
          deletedWarningsCount: 0,
          affectedStudentsCount: 0,
        };
      }

      const result = await this.deleteSessionInternal(session.id);
      if (!result.deleted) {
        return {
          deleted: false,
          affectedStudentIds: [] as bigint[],
          recalcTargets: [] as Array<{
            studentId: bigint;
            recordDate: Date;
            courseId?: bigint;
          }>,
          deletedWarningsCount: 0,
          affectedStudentsCount: 0,
        };
      }

      void markSessionSettled(this.redis, sessionIdText, this.sessionSettledTtlSeconds, this.logger);

      return {
        deleted: true,
        affectedStudentIds: result.affectedStudentIds || [],
        recalcTargets: result.recalcTargets || [],
        deletedWarningsCount: Number(result.deletedWarningsCount || 0),
        affectedStudentsCount: Number(result.affectedStudentsCount || 0),
      };
    } finally {
      this.inFlightDeleteSessions.delete(sessionIdText);
    }
  }

  private getBatchSessionWorkerCount(type: 'batch_end' | 'batch_delete', total: number) {
    const maxWorkers = type === 'batch_end' ? 6 : 6;
    return Math.min(maxWorkers, Math.max(1, total));
  }

  private async runBatchSessionJob(
    jobId: string,
    type: 'batch_end' | 'batch_delete',
    sessionIds: string[],
    dataScope: any,
  ) {
    const jobStartedAt = Date.now();
    const state: BatchSessionJobState = {
      job_id: jobId,
      type,
      status: 'running',
      total: sessionIds.length,
      processed: 0,
      success_count: 0,
      skipped_count: 0,
      failed_count: 0,
      session_ids: [],
      message: '正在处理中…',
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    await this.saveBatchJob(state);

    try {
      const workerCount = this.getBatchSessionWorkerCount(type, sessionIds.length);
      this.logger.log(
        `[batchJob][run] job=${jobId} type=${type} sessions=${sessionIds.length} workers=${workerCount}`,
      );
      let nextIndex = 0;
      const affectedStudentIds = new Set<string>();
      const recalcTargets = new Map<
        string,
        {
          studentId: bigint;
          recordDate: Date;
          courseId?: bigint;
          sessionId?: bigint;
        }
      >();

      await Promise.all(
        Array.from({ length: workerCount }, async (_, workerIndex) => {
          while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= sessionIds.length) {
              return;
            }

            const sessionId = sessionIds[currentIndex];
            const sessionStartedAt = Date.now();
            this.logger.log(
              `[batchJob][session] job=${jobId} type=${type} worker=${workerIndex + 1} session=${sessionId} started`,
            );
            try {
              if (type === 'batch_end') {
                const endResult = await this.processSingleEndSession(sessionId, dataScope, {
                  deferWarnings: true,
                });
                if (endResult.ended) {
                  state.success_count += 1;
                  state.session_ids.push(sessionId);
                  (endResult.warningTargets || []).forEach((target: any) => {
                    if (!target?.studentId || !(target.recordDate instanceof Date)) {
                      return;
                    }
                    const recalcKey = [
                      target.studentId.toString(),
                      target.recordDate.toISOString().slice(0, 10),
                      target.courseId?.toString?.() || '',
                    ].join('_');
                    recalcTargets.set(recalcKey, target);
                  });
                } else {
                  state.skipped_count += 1;
                }
                this.logger.log(
                  `[batchJob][session] job=${jobId} type=${type} worker=${workerIndex + 1} session=${sessionId} ended=${endResult.ended} cost=${Date.now() - sessionStartedAt}ms`,
                );
              } else {
                const result = await this.processSingleDeleteSession(sessionId, dataScope);
                if (result.deleted) {
                  state.success_count += 1;
                  state.session_ids.push(sessionId);
                  (result.affectedStudentIds || []).forEach((studentId: bigint) => {
                    affectedStudentIds.add(studentId.toString());
                  });
                  (result.recalcTargets || []).forEach((target: any) => {
                    if (!target?.studentId || !(target.recordDate instanceof Date)) {
                      return;
                    }
                    const recalcKey = [
                      target.studentId.toString(),
                      target.recordDate.toISOString().slice(0, 10),
                      target.courseId?.toString?.() || '',
                    ].join('_');
                    recalcTargets.set(recalcKey, target);
                  });
                } else {
                  state.skipped_count += 1;
                }
                this.logger.log(
                  `[batchJob][session] job=${jobId} type=${type} worker=${workerIndex + 1} session=${sessionId} deleted=${result.deleted} cost=${Date.now() - sessionStartedAt}ms`,
                );
              }
            } catch (error: any) {
              state.failed_count += 1;
              this.logger.error(
                `${type === 'batch_end' ? '批量结束签到' : '批量删除签到'}失败，session_id=${sessionId}`,
                error?.stack || error?.message || String(error),
              );
            }

            state.processed += 1;
            state.message =
              state.processed >= state.total ? '处理中…' : `已处理 ${state.processed}/${state.total}`;
            await this.saveBatchJob(state);
          }
        }),
      );

      if (type === 'batch_end' && recalcTargets.size > 0) {
        state.message = '课次已结束，正在实时生成预警…';
        await this.saveBatchJob(state);
        await this.warningService.generateWarningsBatchOptimized(
          Array.from(recalcTargets.values()),
        );
      }

      if (type === 'batch_delete' && affectedStudentIds.size > 0) {
        state.message = '删除已完成，正在刷新预警快照…';
        await this.saveBatchJob(state);
        await this.warningSnapshotService.refreshStudents(Array.from(affectedStudentIds.values()));
      }

      if (type === 'batch_delete' && recalcTargets.size > 0) {
        state.message = '删除已完成，预警正在后台重算…';
        await this.saveBatchJob(state);
        this.dispatchWarningRecalcAsync(
          Array.from(recalcTargets.values()),
          'attendance.batch_delete',
        );
      }

      state.status = state.failed_count > 0 ? 'failed' : 'completed';
      state.message =
        state.failed_count > 0
          ? `处理完成，失败 ${state.failed_count} 条`
          : '处理完成';
      state.finished_at = new Date().toISOString();
      await this.saveBatchJob(state);
      this.logger.log(
        `[batchJob][done] job=${jobId} type=${type} status=${state.status} success=${state.success_count} skipped=${state.skipped_count} failed=${state.failed_count} cost=${Date.now() - jobStartedAt}ms`,
      );
    } catch (error: any) {
      state.status = 'failed';
      state.message = error?.message || '处理失败';
      state.finished_at = new Date().toISOString();
      await this.saveBatchJob(state);
      this.logger.error(
        `${type === 'batch_end' ? '批量结束签到任务' : '批量删除签到任务'}失败`,
        error?.stack || error?.message || String(error),
      );
    }
  }

  private async endSessionsBatch(sessionIds: string[], req: any) {
    const dataScope = req?.dataScope || { type: 'all' };
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(sessionIds) ? sessionIds : [])
          .map((item) => String(item || '').trim())
          .filter((item) => /^\d+$/.test(item)),
      ),
    );

    if (normalizedIds.length === 0) {
      return {
        requested_count: 0,
        ended_count: 0,
        skipped_count: 0,
        session_ids: [] as string[],
      };
    }

    const workerCount = Math.min(12, normalizedIds.length);
    let nextIndex = 0;
    const recalcTargets = new Map<
      string,
      {
        studentId: bigint;
        recordDate: Date;
        courseId?: bigint;
        sessionId?: bigint;
      }
    >();

    // 全部异步处理，API立即返回；所有课次补录缺勤完成后合并统一结算预警
    void (async () => {
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= normalizedIds.length) return;
            try {
              const res = await this.processSingleEndSession(
                normalizedIds[currentIndex],
                dataScope,
                { deferWarnings: true },
              );
              (res.warningTargets || []).forEach((target: any) => {
                if (!target?.studentId || !(target.recordDate instanceof Date)) {
                  return;
                }
                const recalcKey = [
                  target.studentId.toString(),
                  target.recordDate.toISOString().slice(0, 10),
                  target.courseId?.toString?.() || '',
                ].join('_');
                recalcTargets.set(recalcKey, target);
              });
            } catch { /* logged inside */ }
          }
        }),
      );
      if (recalcTargets.size > 0) {
        await this.warningService.generateWarningsBatchOptimized(
          Array.from(recalcTargets.values()),
        );
      }
    })();

    return {
      requested_count: normalizedIds.length,
      ended_count: normalizedIds.length,
      skipped_count: 0,
      session_ids: normalizedIds,
    };
  }

  private async deleteSessionInternal(sessionId: bigint) {
    const startedAt = Date.now();
    const sessionQueryStartedAt = Date.now();
    const session = await this.prisma.class_sessions.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        course_id: true,
        class_id: true,
        session_start: true,
      },
    });
    const sessionQueryCost = Date.now() - sessionQueryStartedAt;
    if (!session) {
      return {
        deleted: false,
        deletedWarningsCount: 0,
        affectedStudentsCount: 0,
      };
    }

    const attendanceQueryStartedAt = Date.now();
    const attendanceRecords = await this.prisma.attendance_records.findMany({
      where: { session_id: sessionId },
      select: {
        student_id: true,
      },
    });
    const attendanceQueryCost = Date.now() - attendanceQueryStartedAt;
    // 优先从签到记录获取学生，如果签到记录已删除则从班级获取
    let affectedStudentIds = Array.from(new Set(attendanceRecords.map((record) => record.student_id)));
    if (affectedStudentIds.length === 0) {
      const classStudents = await this.prisma.student_profiles.findMany({
        where: { class_id: session.class_id, status: 'active' },
        select: { id: true },
      });
      affectedStudentIds = classStudents.map(s => s.id);
    }

    const recordDate = new Date(
      Date.UTC(
        session.session_start.getFullYear(),
        session.session_start.getMonth(),
        session.session_start.getDate(),
      ),
    );
    const dayStart = new Date(session.session_start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const refsQueryStartedAt = Date.now();
    // 兜底：同时按 session_id 和 student_id+日期+课程 匹配预警
    const warningWhereBySession = affectedStudentIds.length > 0
      ? { student_id: { in: affectedStudentIds }, trigger_detail_json: { path: '$.session_id', equals: sessionId.toString() } }
      : null;
    const warningWhereByDate = affectedStudentIds.length > 0
      ? { student_id: { in: affectedStudentIds }, period_start: recordDate, course_id: session.course_id }
      : null;

    const [warningRefsBySession, warningRefsByDate, currentWarningRefsBySession, currentWarningRefsByDate, remainingRecords] = await Promise.all([
      warningWhereBySession
        ? this.prisma.warnings.findMany({ where: warningWhereBySession, select: { id: true } })
        : Promise.resolve([] as Array<{ id: bigint }>),
      warningWhereByDate
        ? this.prisma.warnings.findMany({ where: warningWhereByDate, select: { id: true } })
        : Promise.resolve([] as Array<{ id: bigint }>),
      warningWhereBySession
        ? (this.prisma as any).warning_current_states.findMany({ where: warningWhereBySession, select: { id: true } })
        : Promise.resolve([] as Array<{ id: bigint }>),
      warningWhereByDate
        ? (this.prisma as any).warning_current_states.findMany({ where: warningWhereByDate, select: { id: true } })
        : Promise.resolve([] as Array<{ id: bigint }>),
      affectedStudentIds.length > 0
        ? this.prisma.attendance_records.findMany({
            where: {
              student_id: { in: affectedStudentIds },
              NOT: { session_id: sessionId },
              sessions: {
                course_id: session.course_id,
                session_start: {
                  gte: dayStart,
                  lt: dayEnd,
                },
              },
            },
            select: {
              student_id: true,
            },
            distinct: ['student_id'],
          })
        : Promise.resolve([] as Array<{ student_id: bigint }>),
    ]);
    const refsQueryCost = Date.now() - refsQueryStartedAt;

    // 合并去重：按 session_id 匹配 + 按日期课程兜底
    const warningIdSet = new Set<string>();
    const currentWarningIdSet = new Set<string>();
    for (const ref of warningRefsBySession) warningIdSet.add(ref.id.toString());
    for (const ref of warningRefsByDate) warningIdSet.add(ref.id.toString());
    for (const ref of currentWarningRefsBySession) currentWarningIdSet.add(ref.id.toString());
    for (const ref of currentWarningRefsByDate) currentWarningIdSet.add(ref.id.toString());
    const warningsToDelete = Array.from(warningIdSet).map(id => BigInt(id));
    const currentWarningsToDelete = Array.from(currentWarningIdSet).map(id => BigInt(id));

    this.logger.log(
      `[batchDelete][refs] session=${sessionId.toString()} bySession=${warningRefsBySession.length} byDate=${warningRefsByDate.length} merged=${warningsToDelete.length} students=${affectedStudentIds.length} recordDate=${recordDate.toISOString()} courseId=${session.course_id?.toString()}`,
    );
    const studentsWithRemainingRecords = new Set(
      remainingRecords.map((item) => item.student_id.toString()),
    );
    const dailyRecordStudentIdsToDelete = affectedStudentIds.filter(
      (studentId) => !studentsWithRemainingRecords.has(studentId.toString()),
    );

    const notificationQueryStartedAt = Date.now();
    const notificationJobIds =
      warningsToDelete.length > 0
        ? (
            await this.prisma.notification_jobs.findMany({
              where: {
                warning_id: { in: warningsToDelete },
              },
              select: {
                id: true,
              },
            })
          ).map((job: any) => job.id as bigint)
        : [];
    const notificationQueryCost = Date.now() - notificationQueryStartedAt;

    const transactionStartedAt = Date.now();
    try {
      await this.executeTransactionWithRetry(
        `删除签到课次 ${sessionId.toString()} 关联数据`,
        () => {
          const operations: Prisma.PrismaPromise<any>[] = [];

          if (notificationJobIds.length > 0) {
            operations.push(
              this.prisma.notification_logs.deleteMany({
                where: { job_id: { in: notificationJobIds } },
              }),
            );
          }

          if (warningsToDelete.length > 0) {
            operations.push(
              this.prisma.notification_jobs.deleteMany({
                where: { warning_id: { in: warningsToDelete } },
              }),
            );
            operations.push(
              this.prisma.warnings.deleteMany({
                where: { id: { in: warningsToDelete } },
              }),
            );
          }

          if (currentWarningsToDelete.length > 0) {
            operations.push(
              (this.prisma as any).warning_current_states.deleteMany({
                where: { id: { in: currentWarningsToDelete } },
              }),
            );
          }

          if (dailyRecordStudentIdsToDelete.length > 0) {
            operations.push(
              this.prisma.daily_records.deleteMany({
                where: {
                  student_id: { in: dailyRecordStudentIdsToDelete },
                  record_date: recordDate,
                  course_id: session.course_id,
                },
              }),
            );
          }

          operations.push(
            this.prisma.class_sessions.delete({
              where: { id: sessionId },
            }),
          );

          return operations;
        },
      );
    } catch (error: any) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return {
          deleted: false,
          deletedWarningsCount: 0,
          affectedStudentsCount: 0,
        };
      }
      throw error;
    }
    const transactionCost = Date.now() - transactionStartedAt;

    const snapshotStartedAt = Date.now();
    await this.attendanceSnapshotService.deleteSessions([sessionId]);
    const snapshotCost = Date.now() - snapshotStartedAt;

    this.logger.log(
      `[batchDelete][single] session=${sessionId.toString()} students=${affectedStudentIds.length} warnings=${warningsToDelete.length} currentWarnings=${currentWarningsToDelete.length} notificationJobs=${notificationJobIds.length} sessionMs=${sessionQueryCost} attendanceMs=${attendanceQueryCost} refsMs=${refsQueryCost} notificationMs=${notificationQueryCost} txMs=${transactionCost} snapshotMs=${snapshotCost} cost=${Date.now() - startedAt}ms`,
    );

    return {
      deleted: true,
      deletedWarningsCount: warningsToDelete.length,
      affectedStudentsCount: affectedStudentIds.length,
      affectedStudentIds,
      recalcTargets: affectedStudentIds.map((studentId) => ({
        studentId,
        recordDate,
        courseId: session.course_id,
      })),
    };
  }

  private async deleteSessionsBatch(sessionIds: string[], req: any) {
    const dataScope = req?.dataScope || { type: 'all' };
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(sessionIds) ? sessionIds : [])
          .map((item) => String(item || '').trim())
          .filter((item) => /^\d+$/.test(item)),
      ),
    );

    if (normalizedIds.length === 0) {
      return {
        requested_count: 0,
        deleted_count: 0,
        skipped_count: 0,
        failed_count: 0,
        session_ids: [] as string[],
      };
    }

    let deletedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const deletedIds: string[] = [];
    const affectedStudentIds = new Set<string>();
    const recalcTargets = new Map<
      string,
      {
        studentId: bigint;
        recordDate: Date;
        courseId?: bigint;
        sessionId?: bigint;
      }
    >();
    const workerCount = this.getBatchSessionWorkerCount('batch_delete', normalizedIds.length);
    let nextIndex = 0;

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= normalizedIds.length) {
            return;
          }

          const sessionIdText = normalizedIds[currentIndex];
          try {
            const result = await this.processSingleDeleteSession(sessionIdText, dataScope);
            if (!result.deleted) {
              skippedCount += 1;
              continue;
            }

            deletedCount += 1;
            deletedIds.push(sessionIdText);
            (result.affectedStudentIds || []).forEach((studentId: bigint) => {
              affectedStudentIds.add(studentId.toString());
            });
            (result.recalcTargets || []).forEach((target: any) => {
              if (!target?.studentId || !(target.recordDate instanceof Date)) {
                return;
              }
              const recalcKey = [
                target.studentId.toString(),
                target.recordDate.toISOString().slice(0, 10),
                target.courseId?.toString?.() || '',
              ].join('_');
              recalcTargets.set(recalcKey, target);
            });
          } catch (error: any) {
            failedCount += 1;
            this.logger.error(
              `批量删除签到失败，session_id=${sessionIdText}`,
              error?.stack || error?.message || String(error),
            );
          }
        }
      }),
    );

    if (affectedStudentIds.size > 0) {
      await this.warningSnapshotService.refreshStudents(Array.from(affectedStudentIds.values()));
    }

    if (recalcTargets.size > 0) {
      await this.warningService.generateWarningsBatchOptimized(
        Array.from(recalcTargets.values()),
      );
    }

    return {
      requested_count: normalizedIds.length,
      deleted_count: deletedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      session_ids: deletedIds,
    };
  }

  private parseSessionDateRange(value?: string) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    const matched = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!matched) {
      throw new Error('日期格式无效');
    }

    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);

    return {
      start: new Date(year, month - 1, day, 0, 0, 0, 0),
      end: new Date(year, month - 1, day + 1, 0, 0, 0, 0),
    };
  }

  private async listLeaveStudentsForSession(session: {
    class_id: bigint;
    session_start: Date;
    session_end?: Date | null;
    qr_expire_at: Date;
  }) {
    const sessionDeadline = this.getSessionDeadline(session);
    const leaveRequests = await this.prisma.leave_requests.findMany({
      where: {
        class_id: session.class_id,
        status: 'approved',
        from_date: { lte: sessionDeadline },
        to_date: { gte: session.session_start },
      },
      orderBy: [{ from_date: 'asc' }, { id: 'asc' }],
    });

    if (leaveRequests.length === 0) {
      return [];
    }

    const studentIds = Array.from(
      new Map(
        leaveRequests.map((item: any) => [item.student_id.toString(), item.student_id]),
      ).values(),
    );
    const students = await this.prisma.student_profiles.findMany({
      where: { id: { in: studentIds } },
      include: { users: true },
    });
    const studentMap = new Map(
      students.map((item: any) => [item.id.toString(), item]),
    );

    return leaveRequests.map((item: any) => {
      const student = studentMap.get(item.student_id.toString()) as any;
      return {
        id: item.id.toString(),
        student_id: item.student_id.toString(),
        student_no: student?.student_no || '',
        name: student?.users?.name || '',
        from_date: item.from_date,
        to_date: item.to_date,
        reason: item.reason || '',
      };
    });
  }

  private async getApprovedLeaveStudentIdsForSession(session: {
    class_id: bigint;
    session_start: Date;
    session_end?: Date | null;
    qr_expire_at: Date;
  }) {
    const sessionDeadline = this.getSessionDeadline(session);
    const leaveRequests = await this.prisma.leave_requests.findMany({
      where: {
        class_id: session.class_id,
        status: 'approved',
        from_date: { lte: sessionDeadline },
        to_date: { gte: session.session_start },
      },
      select: { student_id: true },
    });
    return new Set(
      leaveRequests
        .map((item: any) => String(item.student_id || '').trim())
        .filter(Boolean),
    );
  }

  private async isStudentOnApprovedLeave(
    studentId: bigint,
    sessionStart: Date,
    sessionEnd: Date,
  ) {
    const leaveRequest = await this.prisma.leave_requests.findFirst({
      where: {
        student_id: studentId,
        status: 'approved',
        from_date: { lte: sessionEnd },
        to_date: { gte: sessionStart },
      },
      select: { id: true },
    });

    return Boolean(leaveRequest);
  }

  private async getApprovedLeaveStudentIds(
    studentIds: bigint[],
    sessionStart: Date,
    sessionEnd: Date,
  ) {
    if (studentIds.length === 0) {
      return new Set<string>();
    }

    const leaveRequests = await this.prisma.leave_requests.findMany({
      where: {
        student_id: { in: studentIds },
        status: 'approved',
        from_date: { lte: sessionEnd },
        to_date: { gte: sessionStart },
      },
      select: { student_id: true },
    });

    return new Set(
      leaveRequests
        .map((item: any) => item.student_id?.toString?.() || '')
        .filter(Boolean),
    );
  }

  private async buildSessionSupportMaps(
    sessions: Array<{
      id: bigint;
      class_id: bigint;
      session_start: Date;
      session_end?: Date | null;
      qr_expire_at: Date;
    }>,
  ) {
    if (sessions.length === 0) {
      return {
        studentCountMap: new Map<string, number>(),
        leaveIdMap: new Map<string, Set<string>>(),
      };
    }

    const classIds = Array.from(
      new Map(sessions.map((item) => [item.class_id.toString(), item.class_id])).values(),
    );
    const minStart = sessions.reduce(
      (current, session) =>
        session.session_start.getTime() < current.getTime() ? session.session_start : current,
      sessions[0].session_start,
    );
    const maxEnd = sessions.reduce((current, session) => {
      const sessionDeadline = this.getSessionDeadline(session);
      return sessionDeadline.getTime() > current.getTime() ? sessionDeadline : current;
    }, this.getSessionDeadline(sessions[0]));

    const [studentCounts, leaveRequests] = await Promise.all([
      this.prisma.student_profiles.groupBy({
        by: ['class_id'],
        where: {
          class_id: { in: classIds },
          status: 'active',
        },
        _count: { id: true },
      }),
      this.prisma.leave_requests.findMany({
        where: {
          class_id: { in: classIds },
          status: 'approved',
          from_date: { lte: maxEnd },
          to_date: { gte: minStart },
        },
        select: {
          class_id: true,
          student_id: true,
          from_date: true,
          to_date: true,
        },
      }),
    ]);

    const studentCountMap = new Map<string, number>();
    studentCounts.forEach((item: any) => {
      studentCountMap.set(item.class_id.toString(), Number(item._count?.id || 0));
    });

    const leaveIdMap = new Map<string, Set<string>>();
    sessions.forEach((session) => {
      const sessionKey = session.id.toString();
      const sessionDeadline = this.getSessionDeadline(session);
      const leaveIds = new Set<string>();

      leaveRequests.forEach((leave: any) => {
        if (leave.class_id.toString() !== session.class_id.toString()) {
          return;
        }
        if (leave.from_date > sessionDeadline || leave.to_date < session.session_start) {
          return;
        }
        leaveIds.add(leave.student_id.toString());
      });

      leaveIdMap.set(sessionKey, leaveIds);
    });

    return {
      studentCountMap,
      leaveIdMap,
    };
  }

  private async processSessionWarningTargets(
    sessionId: bigint,
    targets: Array<{
      studentId: bigint;
      recordDate: Date;
      courseId?: bigint;
      sessionId?: bigint;
    }>,
    source: string,
  ) {
    if (targets.length === 0) {
      this.logger.log(`[endSession][warning] session=${sessionId.toString()} 无目标需重算`);
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
      `[endSession][warning] session=${sessionId.toString()} 开始同步重算 目标数=${targets.length} 来源=${source}`,
    );
    try {
      const syncResult = await this.warningService.generateWarningsForAffectedRecordsSync(targets);
      const lockedTargets = Number(syncResult?.targets_locked || 0);
      this.logger.log(
        `[endSession][warning] session=${sessionId.toString()} 同步重算 耗时=${Date.now() - startedAt}ms 新建=${Number(syncResult?.warnings_generated || 0)} 锁定=${lockedTargets}`,
      );

      if (lockedTargets > 0) {
        try {
          const queueStartedAt = Date.now();
          const queueResult = await this.warningQueueService.scheduleAffectedRecords(
            targets,
            `${source}.locked_retry`,
          );
          this.logger.warn(
            `[endSession][warning] session=${sessionId.toString()} 锁占用补偿入队 耗时=${Date.now() - queueStartedAt}ms 模式=${queueResult?.mode || 'unknown'} 入队=${Number(queueResult?.warnings_enqueued || 0)} 去重=${Number(queueResult?.warnings_deduped || 0)} 锁定=${lockedTargets}`,
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
            `课次 ${sessionId.toString()} 锁占用补偿入队失败`,
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
        `课次 ${sessionId.toString()} 同步生成预警失败，cost=${Date.now() - startedAt}ms，降级为入队重试: ${error?.message || error}`,
      );

      try {
        const queueStartedAt = Date.now();
        const queueResult = await this.warningQueueService.scheduleAffectedRecords(targets, source);
        const lockedTargets = Number(queueResult?.targets_locked || 0);
        const canSettle = queueResult?.mode === 'sync_fallback' && lockedTargets === 0;
        this.logger.log(
          `[endSession][warning] session=${sessionId.toString()} 降级入队 耗时=${Date.now() - queueStartedAt}ms 模式=${queueResult?.mode || 'unknown'} 新建=${Number(queueResult?.warnings_generated || 0)} 入队=${Number(queueResult?.warnings_enqueued || 0)} 锁定=${lockedTargets}`,
        );

        if (!canSettle) {
          this.logger.warn(
            `课次 ${sessionId.toString()} 预警已转入异步恢复链路，本次暂不标记 settled`,
          );
        }

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
          `课次 ${sessionId.toString()} 预警恢复链路也失败`,
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

  private dispatchWarningRecalcAsync(
    targets: Array<{
      studentId: bigint;
      recordDate: Date;
      courseId?: bigint;
      sessionId?: bigint;
    }>,
    source: string,
  ) {
    if (!Array.isArray(targets) || targets.length === 0) {
      return;
    }

    void this.warningQueueService.scheduleAffectedRecords(targets, source).catch((error: any) => {
      this.logger.warn(`预警入队失败，降级为同步生成: ${error?.message || error}`);
      void this.warningService.generateWarningsForAffectedRecordsSync(targets).catch((syncError: any) => {
        this.logger.error(
          '同步预警也失败',
          syncError?.stack || syncError?.message || String(syncError),
        );
      });
    });
  }

  private async blockRecentEndedRecovery(sessionId: bigint | string, ttlSeconds = 900) {
    try {
      await this.redis.set(
        `${RECENT_ENDED_RECALC_KEY_PREFIX}:${sessionId.toString()}`,
        new Date().toISOString(),
        'EX',
        ttlSeconds,
      );
    } catch (error: any) {
      this.logger.warn(
        `最近结束恢复锁失败 课次=${sessionId.toString()}: ${error?.message || error}`,
      );
    }
  }

  /**
   * 秒结束：仅更新 session 状态为 ended，单条 update 极快
   */
  private async markSessionEndedFast(sessionId: bigint, cutoffTime: Date) {
    const t = Date.now();
    // CAS：只允许 active → ended 这一次成功。
    // 旧实现是无条件 update，手动结束 / 定时结算 / 恢复扫描三方并发时都会继续往下走，
    // 造成同一课次重复结算（靠唯一键兜底才没写出重复考勤）。
    const result = await this.prisma.class_sessions.updateMany({
      where: { id: sessionId, status: 'active' },
      data: {
        status: 'ended',
        session_end: cutoffTime,
        qr_expire_at: cutoffTime,
      },
    });
    const changed = Number(result?.count || 0) === 1;
    this.logger.log(
      `[endSession][fast] session=${sessionId.toString()} 状态已更新为ended 耗时=${Date.now() - t}ms changed=${changed}`,
    );
    return changed;
  }

  private async finalizeSessionEarly(
    session: any,
    cutoffTime: Date,
    options?: { skipWarningGeneration?: boolean },
  ) {
    const finalizeStartedAt = Date.now();
    this.logger.log(
      `[endSession][finalize] session=${session.id.toString()} 开始 学生数=${session.classes?.student_profiles?.length || 0} 截止时间=${cutoffTime.toISOString()}`,
    );
    let absentCount = 0;
    const affectedRecords = new Map<
      string,
      {
        studentId: bigint;
        recordDate: Date;
        courseId?: bigint;
        sessionId?: bigint;
      }
    >();

    const students = session.classes?.student_profiles || [];
    const studentIds = students.map((student: any) => student.id as bigint);
    const recordDate = new Date(
      Date.UTC(
        session.session_start.getFullYear(),
        session.session_start.getMonth(),
        session.session_start.getDate(),
      ),
    );

    let t = Date.now();
    const existingRecords = studentIds.length > 0
      ? await this.prisma.attendance_records.findMany({
          where: {
            session_id: session.id,
            student_id: { in: studentIds },
          },
          select: {
            student_id: true,
            attendance_status: true,
          },
        })
      : [];
    const existingStudentIds = new Set(
      existingRecords.map((record: any) => record.student_id.toString()),
    );
    existingRecords.forEach((record: any) => {
      const status = String(record.attendance_status || '').trim();
      if (!ABNORMAL_ATTENDANCE_STATUSES.includes(status as any)) {
        return;
      }
      affectedRecords.set(
        [
          record.student_id.toString(),
          session.course_id.toString(),
          recordDate.toISOString().slice(0, 10),
          session.id.toString(),
        ].join('_'),
        {
          studentId: record.student_id,
          recordDate,
          courseId: session.course_id,
          sessionId: session.id,
        },
      );
    });
    this.logger.log(
      `[endSession][finalize] session=${session.id.toString()} 查询已有记录 耗时=${Date.now() - t}ms 已有=${existingStudentIds.size} 待处理=${students.length - existingStudentIds.size} 已有异常=${affectedRecords.size}`,
    );

    const pendingStudents = students.filter(
      (student: any) => !existingStudentIds.has(student.id.toString()),
    );
    t = Date.now();
    const approvedLeaveIds = await this.getApprovedLeaveStudentIds(
      pendingStudents.map((student: any) => student.id as bigint),
      session.session_start,
      cutoffTime,
    );
    this.logger.log(
      `[endSession][finalize] session=${session.id.toString()} 查询已批准请假 耗时=${Date.now() - t}ms 请假=${approvedLeaveIds.size}`,
    );

    const attendanceRows: any[] = [];
    const dailyRows: any[] = [];
    const absentStudentIds: bigint[] = [];
    const leaveStudentIds: bigint[] = [];

    t = Date.now();
    for (const student of pendingStudents) {
      const onApprovedLeave = approvedLeaveIds.has(student.id.toString());
      const attendanceStatus = onApprovedLeave ? 'leave' : 'absent';

      attendanceRows.push({
        session_id: session.id,
        student_id: student.id,
        checkin_time: cutoffTime,
        attendance_status: attendanceStatus,
        source: 'system',
      });

      dailyRows.push({
        student_id: student.id,
        record_date: recordDate,
        class_id: session.class_id,
        org_id: student.org_id || BigInt(0),
        course_id: session.course_id,
        attendance_status: attendanceStatus,
        homework_status: 'unknown',
        source: 'system',
        approved_status: 'approved',
      });

      if (onApprovedLeave) {
        leaveStudentIds.push(student.id);
        continue;
      }

      absentStudentIds.push(student.id);
      affectedRecords.set(
        [
          student.id.toString(),
          session.course_id.toString(),
          recordDate.toISOString().slice(0, 10),
          session.id.toString(),
        ].join('_'),
        {
          studentId: student.id,
          recordDate,
          courseId: session.course_id,
          sessionId: session.id,
        },
      );
    }

    absentCount = absentStudentIds.length;
    this.logger.log(
      `[endSession][finalize] session=${session.id.toString()} 构建数据行 耗时=${Date.now() - t}ms 签到记录=${attendanceRows.length} 日报记录=${dailyRows.length} 缺勤=${absentStudentIds.length} 请假=${leaveStudentIds.length} 预警目标=${affectedRecords.size}`,
    );

    t = Date.now();
    await this.executeTransactionWithRetry(
      `结束签到课次 ${session.id.toString()}`,
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
        // session 状态已在 markSessionEndedFast 中更新，此处不再重复

        return operations;
      },
    );
    this.logger.log(
      `[endSession][finalize] session=${session.id.toString()} 提交事务 耗时=${Date.now() - t}ms`,
    );

    try {
      await this.attendanceSnapshotService.refreshSessions([session.id]);
    } catch (snapErr: any) {
      this.logger.warn(
        `[endSession][finalize] session=${session.id.toString()} 刷新签到快照失败: ${snapErr?.message || snapErr}`,
      );
    }

    void this.blockRecentEndedRecovery(session.id);

    // 批量优化：一次查询+内存计算+批量写入
    const targets = Array.from(affectedRecords.values());
    if (!options?.skipWarningGeneration && targets.length > 0) {
      const startWarn = Date.now();
      try {
        const result = await this.warningService.generateWarningsBatchOptimized(targets);
        this.logger.log(
          `[endSession][finalize] session=${session.id.toString()} 优化预警完成 耗时=${Date.now() - startWarn}ms 生成=${result.warnings_generated}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[endSession][finalize] session=${session.id.toString()} 优化预警失败: ${err?.message || err}`,
        );
      }
    }

    this.logger.log(
      `[endSession][finalize] session=${session.id.toString()} 完成 总耗时=${Date.now() - finalizeStartedAt}ms`,
    );

    return {
      affectedStudents: students.length,
      absent_records_generated: absentCount,
      warningTargets: targets,
    };
  }

  private async buildQrStateForSession(
    session: {
      id: bigint;
      class_id: bigint;
      session_start: Date;
      session_end?: Date | null;
      qr_expire_at: Date;
      qr_token_hash: string | null;
    },
    now = new Date(),
  ) {
    const refreshSeconds = await this.getQrRefreshSeconds();
    const qrState = getRollingQrState({
      sessionStart: session.session_start,
      sessionEnd: this.getSessionDeadline(session),
      qrTokenHash: session.qr_token_hash || '',
      refreshSeconds,
      now,
    });
    const leaveStudents = await this.listLeaveStudentsForSession(session);

    return {
      scan_token: qrState.currentToken,
      qr_refresh_seconds: refreshSeconds,
      qr_next_refresh_at: qrState.nextRefreshAt,
      qr_countdown_seconds: qrState.remainingSeconds,
      leave_students: leaveStudents,
    };
  }

  private getRequestUserId(req: any) {
    const raw = String(req?.user?.userId ?? req?.user?.sub ?? '').trim();
    return /^\d+$/.test(raw) ? BigInt(raw) : null;
  }

  private serializeScopeValues(values?: bigint[]) {
    if (!Array.isArray(values) || values.length === 0) {
      return 'none';
    }

    return Array.from(new Set(values.map((item) => item.toString())))
      .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
      .join(',');
  }

  private buildSessionOptionsCacheKey(userId: bigint, dataScope: any) {
    const scopeType = String(dataScope?.type || 'all').trim() || 'all';
    return [
      'attendance:session-options',
      userId.toString(),
      scopeType,
      this.serializeScopeValues(dataScope?.collegeIds),
      this.serializeScopeValues(dataScope?.classIds),
      this.serializeScopeValues(dataScope?.studentIds),
    ].join(':');
  }

  private buildSessionOptionCoursesCacheKey(userId: bigint, classId: bigint) {
    return ['attendance:session-options-courses', userId.toString(), classId.toString()].join(':');
  }

  private buildSessionOptionsVersionKey(userId: bigint) {
    return `attendance:session-options:version:${userId.toString()}`;
  }

  private buildSessionOptionCoursesVersionKey(userId: bigint) {
    return `attendance:session-options-courses:version:${userId.toString()}`;
  }

  private async getSessionOptionsCacheKeyWithVersion(userId: bigint, dataScope: any) {
    const version = String((await this.redis.get(this.buildSessionOptionsVersionKey(userId))) || '0');
    return `${this.buildSessionOptionsCacheKey(userId, dataScope)}:v${version}`;
  }

  private async getSessionOptionCoursesCacheKeyWithVersion(userId: bigint, classId: bigint) {
    const version = String((await this.redis.get(this.buildSessionOptionCoursesVersionKey(userId))) || '0');
    return `${this.buildSessionOptionCoursesCacheKey(userId, classId)}:v${version}`;
  }

  /**
   * 校验当前用户是否有权操作指定班级的考勤（显式范围校验）。
   *
   * 为什么不复用 DataScopeInterceptor 的 checkResourceByEntity：
   * 它对 `case 'course'` 只处理 college / self，class 范围会直接落空，
   * 导致班主任连自己班的课次都建不了（实测 403）。
   * 而创建签到课次必须同时给出 course_id 与 class_id，
   * **真正该被限制的是 class_id**（它才是"这是不是我的班"的判据），
   * course_id 只需保证课程与班级同学院（上方已校验）。
   *
   * 返回 null 表示放行；返回对象表示应直接回给客户端的错误响应。
   *
   * 范围语义：
   *   all      → 放行
   *   college  → 班级所属学院必须在范围内
   *   class    → 班级 id 必须在范围内；教师另外允许"授课绑定"的班级
   *   self     → 学生只能操作自己所在班级
   */
  private async assertCanManageClass(
    classId: bigint,
    classOrgId: bigint,
    userId: bigint,
    req: any,
  ): Promise<{ code: number; message: string; data: null; trace_id: any } | null> {
    const deny = (message: string) => ({
      code: 403,
      message,
      data: null,
      trace_id: req.trace_id,
    });

    // ----------------------------------------------------------------
    // 优先用 request.dataScope；缺失时**就地解析**。
    //
    // 实测：本端点上 request.dataScope 恒为 undefined（管理员与教师都是），
    // 说明全局 DataScopeInterceptor 并没有在这些请求上写入它。
    // 早期版本因此"保守放行"，等于没有范围限制 —— 任何拥有
    // attendance:manage 的角色都能给任意班级开课次。
    //
    // 现在的做法：自己做一次权威判定，不依赖拦截器是否生效。
    // ----------------------------------------------------------------
    const dataScope = req.dataScope || (await this.resolveDataScopeByUserId(userId));

    // 系统级/全校范围：放行
    if (!dataScope || dataScope.type === 'all') {
      return null;
    }

    if (dataScope.type === 'college') {
      const collegeIds = Array.isArray(dataScope.collegeIds) ? dataScope.collegeIds : [];
      const allowed = collegeIds.some((item: bigint) => item.toString() === classOrgId.toString());
      return allowed ? null : deny('无权为该班级创建签到课次（不在你的学院范围内）');
    }

    if (dataScope.type === 'class' || dataScope.type === 'self') {
      const scopedClassIds = ((await this.resolveScopedClassIds(dataScope)) || []) as bigint[];
      let allowed = scopedClassIds.some(
        (item: bigint) => item.toString() === classId.toString(),
      );

      // 教师补充判据：授课绑定。有些教师并非班主任，但确实给该班上课，
      // 应允许其开课次（course_classes / schedules 任一命中）。
      if (!allowed) {
        allowed = await this.isTeacherOfClass(userId, classId);
      }

      return allowed ? null : deny('无权为该班级创建签到课次（超出你的数据范围）');
    }

    return deny('无权为该班级创建签到课次');
  }

  /**
   * 按 userId 解析数据范围（不依赖 DataScopeInterceptor）。
   *
   * 与 DataScopeInterceptor 的范围语义保持一致：
   *   system / school 角色 → all
   *   有 college scope     → college（并展开该学院下的班级）
   *   有 class scope       → class
   *   其余（无角色/学生）  → self
   */
  private async resolveDataScopeByUserId(userId: bigint): Promise<any> {
    try {
      const roles = await this.permissionService.getUserRolesAndScopes(userId);
      if (!Array.isArray(roles) || roles.length === 0) {
        // 无角色（如学生自助）：退化为 self
        const studentProfile = await this.prisma.student_profiles.findUnique({
          where: { user_id: userId },
          select: { id: true, class_id: true },
        });
        return studentProfile
          ? {
              type: 'self',
              studentIds: [studentProfile.id],
              classIds: studentProfile.class_id ? [studentProfile.class_id] : undefined,
            }
          : { type: 'self' };
      }

      const hasSystemScope = roles.some(
        (r: any) => r.scope_type === 'system' || r.scope_type === 'school',
      );
      if (hasSystemScope) {
        return { type: 'all' };
      }

      const collegeIds = roles
        .filter((r: any) => r.scope_type === 'college' && r.scope_id)
        .map((r: any) => BigInt(r.scope_id));
      const classIds = roles
        .filter((r: any) => r.scope_type === 'class' && r.scope_id)
        .map((r: any) => BigInt(r.scope_id));

      if (classIds.length > 0) {
        return {
          type: 'class',
          classIds: Array.from(new Map(classIds.map((i: bigint) => [i.toString(), i])).values()),
          collegeIds: collegeIds.length ? collegeIds : undefined,
        };
      }
      if (collegeIds.length > 0) {
        return {
          type: 'college',
          collegeIds: Array.from(
            new Map(collegeIds.map((i: bigint) => [i.toString(), i])).values(),
          ),
        };
      }

      return { type: 'self' };
    } catch {
      // 解析失败时按最保守处理：拒绝（而不是放行）
      return { type: 'none' };
    }
  }

  /** 该教师是否给这个班授过课（course_classes / schedules 任一命中即可） */
  private async isTeacherOfClass(userId: bigint, classId: bigint): Promise<boolean> {
    try {
      const [binding, schedule] = await Promise.all([
        this.prisma.course_classes.findFirst({
          where: { class_id: classId, teacher_user_id: userId },
          select: { id: true },
        }),
        this.prisma.schedules.findFirst({
          where: { class_id: classId, teacher_user_id: userId, status: 'active' },
          select: { id: true },
        }),
      ]);
      return Boolean(binding || schedule);
    } catch {
      // 绑定表结构差异不应把请求打成 500，退化为"无绑定"
      return false;
    }
  }

  private async resolveScopedClassIds(dataScope: any) {
    if (!dataScope || dataScope.type === 'all') {
      return null;
    }

    if (dataScope.type === 'class') {
      const classIds = Array.isArray(dataScope.classIds) ? dataScope.classIds : [];
      return Array.from(
        new Map(classIds.map((item: bigint) => [item.toString(), item])).values(),
      );
    }

    if (dataScope.type === 'self') {
      const studentIds = Array.isArray(dataScope.studentIds) ? dataScope.studentIds : [];
      if (studentIds.length === 0) {
        return [];
      }

      const students = await this.prisma.student_profiles.findMany({
        where: { id: { in: studentIds } },
        select: { class_id: true },
      });

      return Array.from(
        new Map(
          students.map((item: { class_id: bigint }) => [item.class_id.toString(), item.class_id]),
        ).values(),
      );
    }

    return null;
  }

  private async buildSessionOptionsPayload(dataScope: any) {
    const classWhere: any = { status: 'active' };

    if (dataScope?.type === 'college') {
      const collegeIds = Array.isArray(dataScope.collegeIds) ? dataScope.collegeIds : [];
      if (collegeIds.length === 0) {
        return { orgs: [], classes: [] };
      }
      classWhere.org_id = { in: collegeIds };
    } else if (dataScope?.type === 'class' || dataScope?.type === 'self') {
      const classIds = await this.resolveScopedClassIds(dataScope);
      if (!classIds || classIds.length === 0) {
        return { orgs: [], classes: [] };
      }
      classWhere.id = { in: classIds };
    }

    const classes = await this.prisma.classes.findMany({
      where: classWhere,
      select: {
        id: true,
        class_name: true,
        org_id: true,
        major: true,
        enroll_year: true,
      },
      orderBy: [{ class_name: 'asc' }, { id: 'asc' }],
    });

    if (classes.length === 0) {
      return { orgs: [], classes: [] };
    }

    const orgIds = Array.from(
      new Map(classes.map((item: any) => [item.org_id.toString(), item.org_id as bigint])).values(),
    );

    const orgs = await this.prisma.orgs.findMany({
      where: {
        id: { in: orgIds },
        status: 'active',
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return {
      orgs: orgs.map((item: any) => ({
        id: item.id.toString(),
        org_name: item.name || '',
      })),
      classes: classes.map((item: any) => ({
        id: item.id.toString(),
        class_name: item.class_name || '',
        org_id: item.org_id.toString(),
        major: item.major || '',
        enroll_year: item.enroll_year || '',
      })),
    };
  }

  private async buildSessionOptionCoursesPayload(classId: bigint) {
    const courseBindings = await this.prisma.course_classes.findMany({
      where: {
        class_id: classId,
      },
      select: {
        class_id: true,
        course_id: true,
      },
      orderBy: [{ course_id: 'asc' }],
    });

    if (courseBindings.length === 0) {
      return { courses: [] };
    }

    const courseIds = Array.from(
      new Map(courseBindings.map((item: any) => [item.course_id.toString(), item.course_id as bigint])).values(),
    );
    const courses = await this.prisma.courses.findMany({
      where: {
        id: { in: courseIds },
        status: 'active',
      },
      select: {
        id: true,
        org_id: true,
        course_name: true,
        course_code: true,
      },
    });

    const courseMap = new Map(courses.map((item: any) => [item.id.toString(), item]));
    const uniqueCourses = new Map<string, any>();

    courseBindings.forEach((binding: any) => {
      const course = courseMap.get(binding.course_id.toString());
      if (!course) {
        return;
      }

      const key = `${binding.class_id.toString()}:${binding.course_id.toString()}`;
      if (!uniqueCourses.has(key)) {
        uniqueCourses.set(key, {
          course_id: binding.course_id.toString(),
          class_id: binding.class_id.toString(),
          org_id: course.org_id.toString(),
          course_name: course.course_name || '',
          course_code: course.course_code || '',
        });
      }
    });

    return {
      courses: Array.from(uniqueCourses.values()).sort((left: any, right: any) =>
        String(left.course_name || '').localeCompare(String(right.course_name || ''), 'zh-CN', {
          numeric: true,
        }),
      ),
    };
  }

  @Get('session-options')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'class', field: 'class_id' })
  async getSessionOptions(@Req() req: any) {
    await this.prisma.ensureConnected();

    const dataScope = req?.dataScope || { type: 'all' };
    const payload = await this.buildSessionOptionsPayload(dataScope);

    return {
      code: 0,
      message: 'ok',
      data: payload,
      trace_id: req.trace_id,
    };
  }

  @Get('session-options/courses')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'class', field: 'class_id' })
  async getSessionOptionCourses(@Query('class_id') classId: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    const normalizedClassId = String(classId || '').trim();
    if (!/^\d+$/.test(normalizedClassId)) {
      return {
        code: 400,
        message: '班级 ID 无效',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const classIdBigInt = BigInt(normalizedClassId);
    const payload = await this.buildSessionOptionCoursesPayload(classIdBigInt);

    return {
      code: 0,
      message: 'ok',
      data: payload,
      trace_id: req.trace_id,
    };
  }

  @Get('sessions')
  @Permissions('attendance:read')
  async listSessions(@Query('date') date: string | undefined, @Req() req: any) {
    let where: any = undefined;
    try {
      const dateRange = this.parseSessionDateRange(date);
      if (dateRange) {
        where = {
          session_start: {
            gte: dateRange.start,
            lt: dateRange.end,
          },
        };
      }
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '日期格式无效',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentUserId = this.getRequestUserId(req);
    const dataScope =
      req.dataScope ||
      (currentUserId ? await this.resolveDataScopeByUserId(currentUserId) : { type: 'none' });

    if (!dataScope || dataScope.type === 'none') {
      return {
        code: 0,
        message: 'ok',
        data: [],
        trace_id: req.trace_id,
      };
    }

    let allowedClassIdSet = new Set<string>();
    if (dataScope.type === 'college') {
      const collegeIds = Array.isArray(dataScope.collegeIds) ? dataScope.collegeIds : [];
      if (collegeIds.length === 0) {
        return { code: 0, message: 'ok', data: [], trace_id: req.trace_id };
      }
      const collegeFilter = { classes: { org_id: { in: collegeIds } } };
      where = where ? { AND: [where, collegeFilter] } : collegeFilter;
    } else if (dataScope.type === 'class' || dataScope.type === 'self') {
      const scopedClassIds = ((await this.resolveScopedClassIds(dataScope)) || []) as bigint[];
      const mergedClassIds = new Map<string, bigint>(
        scopedClassIds.map((item) => [item.toString(), item]),
      );

      if (currentUserId && dataScope.type === 'class') {
        const [courseClasses, schedules, teacherBindings] = await Promise.all([
          this.prisma.course_classes.findMany({
            where: { teacher_user_id: currentUserId },
            select: { class_id: true },
          }),
          this.prisma.schedules.findMany({
            where: { teacher_user_id: currentUserId, status: 'active' },
            select: { class_id: true },
          }),
          this.prisma.teacher_course_bindings.findMany({
            where: { teacher_id: currentUserId },
            select: { class_id: true },
          }),
        ]);
        for (const item of [...courseClasses, ...schedules, ...teacherBindings]) {
          if (item.class_id) {
            mergedClassIds.set(item.class_id.toString(), item.class_id);
          }
        }
      }

      const allowedClassIds = Array.from(mergedClassIds.values());
      allowedClassIdSet = new Set(allowedClassIds.map((item) => item.toString()));

      const scopeConditions: any[] = [];
      if (allowedClassIds.length > 0) {
        scopeConditions.push({ class_id: { in: allowedClassIds } });
      }
      if (currentUserId && dataScope.type === 'class') {
        scopeConditions.push({ teacher_user_id: currentUserId });
      }

      if (scopeConditions.length === 0) {
        return { code: 0, message: 'ok', data: [], trace_id: req.trace_id };
      }

      const scopeFilter =
        scopeConditions.length === 1 ? scopeConditions[0] : { OR: scopeConditions };
      where = where ? { AND: [where, scopeFilter] } : scopeFilter;
    }

    const sessions = await this.prisma.class_sessions.findMany({
      where,
      orderBy: { session_start: 'desc' },
      take: 500,
      include: {
        courses: true,
        classes: true,
      },
    });

    const sessionIds = sessions.map(s => s.id);
    const snapshotMap = await this.attendanceSnapshotService.getOrRefreshSessionSnapshots(sessionIds);

    const refreshSeconds = await this.getQrRefreshSeconds();
    const now = new Date();

    const staleEndedSessionIds = sessions
      .filter((s) => {
        const snapshot = snapshotMap.get(s.id.toString());
        if (!snapshot) {
          return false;
        }
        const sessionEnd = this.getSessionDeadline(s);
        const isEnded = sessionEnd <= now || String(s.status || '').trim() === 'ended';
        if (!isEnded) {
          return false;
        }
        const total = Number(snapshot.total_students || 0);
        const checkedIn = Number(snapshot.checked_in_count || 0);
        const leave = Number(snapshot.leave_count || 0);
        const expectedAbsent = Math.max(total - leave - checkedIn, 0);
        return expectedAbsent > 0 && Number(snapshot.absent_count || 0) === 0;
      })
      .map((s) => s.id);

    if (staleEndedSessionIds.length > 0) {
      await this.attendanceSnapshotService.refreshSessions(staleEndedSessionIds);
      const refreshed = await this.attendanceSnapshotService.getOrRefreshSessionSnapshots(
        staleEndedSessionIds,
      );
      refreshed.forEach((value, key) => snapshotMap.set(String(key), value));
    }

    return {
      code: 0,
      message: 'ok',
      data: sessions.map((s) => {
        const snapshot = snapshotMap.get(s.id.toString()) || {};
        const totalStudents = Number(snapshot.total_students || 0);
        const checkedInCount = Number(snapshot.checked_in_count || 0);
        const onTimeCount = Number(snapshot.on_time_count || 0);
        const lateCount = Number(snapshot.late_count || 0);
        const leaveCount = Number(snapshot.leave_count || 0);
        const sessionEnd = this.getSessionDeadline(s);
        const isEnded = sessionEnd <= now || String(s.status || '').trim() === 'ended';
        const computedAbsent = Math.max(totalStudents - leaveCount - checkedInCount, 0);
        const absentCount = isEnded
          ? Number(snapshot.absent_count || 0) > 0
            ? Number(snapshot.absent_count || 0)
            : computedAbsent
          : 0;
        const qrState = getRollingQrState({
          sessionStart: s.session_start,
          sessionEnd,
          qrTokenHash: s.qr_token_hash || '',
          refreshSeconds,
          now,
        });
        const canExposeScanToken =
          dataScope.type !== 'self' &&
          (dataScope.type === 'all' ||
            dataScope.type === 'college' ||
            (currentUserId !== null && s.teacher_user_id === currentUserId) ||
            allowedClassIdSet.has(s.class_id.toString()));

        return {
          id: s.id.toString(),
          course_id: s.course_id.toString(),
          course_name: s.courses?.course_name || '未知课程',
          class_id: s.class_id.toString(),
          class_name: s.classes?.class_name || '未知班级',
          teacher_user_id: s.teacher_user_id.toString(),
          session_start: s.session_start,
          session_end: sessionEnd,
          qr_expire_at: s.qr_expire_at,
          qr_refresh_seconds: refreshSeconds,
          qr_next_refresh_at: qrState.nextRefreshAt,
          qr_countdown_seconds: qrState.remainingSeconds,
          expire_seconds: Math.max(
            60,
            Math.round((sessionEnd.getTime() - s.session_start.getTime()) / 1000),
          ),
          expire_minutes: Math.max(
            1,
            Math.ceil((sessionEnd.getTime() - s.session_start.getTime()) / 60000),
          ),
          status: s.status,
          created_at: s.created_at,
          scan_token: canExposeScanToken ? qrState.currentToken : '',
          stats: {
            total: totalStudents,
            checkedIn: checkedInCount,
            onTime: onTimeCount,
            late: lateCount,
            leave: leaveCount,
            absent: absentCount,
          },
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Get('qr-config')
  @Permissions('attendance:read')
  async getQrConfig(@Req() req: any) {
    const refreshSeconds = await this.getQrRefreshSeconds();
    return {
      code: 0,
      message: 'ok',
      data: {
        qr_refresh_seconds: refreshSeconds,
        qr_refresh_minutes: Math.max(1, Math.ceil(refreshSeconds / 60)),
      },
      trace_id: req.trace_id,
    };
  }

  @Post('sessions')
  @Permissions('attendance:manage')
  // ⚠️ 这里**故意不加** @DataScope。
  //
  // 原因（实测）：DataScopeInterceptor 的 collectScopedResourceChecks 会把
  // body 里的 course_id 也当作 'course' 实体做范围校验，而它的
  // `case 'course'` 只处理 college / self 两类范围：
  //
  //   case 'course': {
  //     ...
  //     if (dataScope.type === 'college' && dataScope.collegeIds) { ... }
  //     break;          // ← class 范围直接落空 → return false → 403
  //   }
  //
  // 于是 head_teacher（scope_type=class）**连自己班的课次都建不了**，
  // 实测 code=403「权限不足，无法访问此资源」。
  // 而 batch-create 等端点虽然挂了同一个装饰器，却因为不带 course_id
  // 而侥幸绕开了这个分支。
  //
  // 正确做法：不加装饰器，改为在 handler 内做**显式**范围校验
  // （见下方 assertCanManageClass），它能正确处理 all/college/class/self
  // 四种范围以及教师的授课绑定关系。
  async createSession(@Body() dto: CreateSessionDto, @Req() req: any) {
    try {

      // 验证必填字段
      if (!dto.course_id) {
        return {
          code: 400,
          message: '课程 ID 不能为空',
          data: null,
          trace_id: req.trace_id,
        };
      }

      if (!dto.class_id) {
        return {
          code: 400,
          message: '班级 ID 不能为空',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const [courseInfo, classInfo] = await Promise.all([
        this.prisma.courses.findUnique({
          where: { id: BigInt(dto.course_id) },
          select: { id: true, org_id: true, status: true },
        }),
        this.prisma.classes.findUnique({
          where: { id: BigInt(dto.class_id) },
          select: { id: true, org_id: true, status: true },
        }),
      ]);

      if (!courseInfo || String(courseInfo.status || '') !== 'active') {
        return {
          code: 400,
          message: '课程不存在或未启用',
          data: null,
          trace_id: req.trace_id,
        };
      }

      if (!classInfo || String(classInfo.status || '') !== 'active') {
        return {
          code: 400,
          message: '班级不存在或未启用',
          data: null,
          trace_id: req.trace_id,
        };
      }

      // 数据范围校验（本轮修复）：没有 @DataScope 时 req.dataScope 为
      // undefined，因此必须显式校验，否则任何拥有 attendance:manage 的
      // 角色都能给**任意班级**开签到课次（越权写入）。
      const scopeError = await this.assertCanManageClass(
        BigInt(String(dto.class_id)),
        classInfo.org_id,
        BigInt(req.user.sub),
        req,
      );
      if (scopeError) {
        return scopeError;
      }

      if (courseInfo.org_id.toString() !== classInfo.org_id.toString()) {
        return {
          code: 400,
          message: '所选课程与班级不属于同一学院',
          data: null,
          trace_id: req.trace_id,
        };
      }

      if (dto.org_id && /^\d+$/.test(String(dto.org_id).trim())) {
        if (classInfo.org_id.toString() !== String(dto.org_id).trim()) {
          return {
            code: 400,
            message: '所选班级不属于当前学院，请重新选择',
            data: null,
            trace_id: req.trace_id,
          };
        }
      }

      // ----------------------------------------------------------------
      // start_time 校验（本轮修复）
      //
      // 修复前这里直接 `new Date(dto.start_time)`，完全不校验：
      // 'not-a-date' / '' / '1789000000000' 都会变成 Invalid Date，
      // 其 getTime() 为 NaN，NaN 一路传进
      //   prisma.schedules.findMany({ where: { session_start: { gte: NaN } } })
      // 抛 "Invalid `prisma.schedules.findMany()` invocation"，
      // 再被下面的 catch 转成 {code:500} 的 **HTTP 201** ——
      // 客户端按状态码判断会以为课次创建成功。
      // ----------------------------------------------------------------
      const startParsed = parseDateTimeInput(dto.start_time, 'start_time');
      if (!startParsed.ok) {
        return {
          code: 400,
          message: startParsed.reason,
          data: null,
          trace_id: req.trace_id,
        };
      }
      const start = startParsed.date;

      const rangeCheck = isValidSessionStart(start);
      if (!rangeCheck.ok) {
        return {
          code: 400,
          message: rangeCheck.reason || 'start_time 超出合理范围',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const qrRefreshSeconds = await this.getQrRefreshSeconds();
      const expireAt = new Date(start.getTime() + qrRefreshSeconds * 1000);
      const sessionDefaults = await this.resolveSessionDefaults(
        BigInt(dto.course_id),
        BigInt(dto.class_id),
        start,
        BigInt(req.user.sub),
      );
      const attendanceWindowSeconds = this.resolveAttendanceWindowSeconds(
        dto,
        sessionDefaults.sessionEnd,
        start,
      );
      const sessionEnd = new Date(start.getTime() + attendanceWindowSeconds * 1000);

      const salt = randomBytes(8).toString('hex');
      const qrTokenHash = createHash('sha256')
        .update(dto.class_id + ':' + dto.course_id + ':' + start.toISOString() + ':' + salt)
        .digest('hex');

      const session = await this.prisma.class_sessions.create({
        data: {
          course_id: BigInt(dto.course_id),
          class_id: BigInt(dto.class_id),
          teacher_user_id: sessionDefaults.teacherUserId,
          session_start: start,
          session_end: sessionEnd,
          qr_token_hash: qrTokenHash,
          qr_expire_at: expireAt,
          status: 'active',
        },
      });
      await this.attendanceSnapshotService.refreshSessions([session.id]);
      const qrState = await this.buildQrStateForSession(session);

      return {
        code: 0,
        message: 'ok',
        data: {
          session_id: session.id.toString(),
          scan_token: qrState.scan_token,
          session_end: session.session_end?.toISOString() || null,
          expire_seconds: attendanceWindowSeconds,
          expire_minutes: Math.max(1, Math.ceil(attendanceWindowSeconds / 60)),
          qr_expire_at: expireAt.toISOString(),
          qr_refresh_seconds: qrRefreshSeconds,
          qr_next_refresh_at: qrState.qr_next_refresh_at,
          qr_countdown_seconds: qrState.qr_countdown_seconds,
          leave_students: qrState.leave_students,
        },
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error(
        '创建签到课次失败',
        error instanceof Error ? error.stack : String(error),
      );
      // 交给 HttpExceptionFilter 统一处理，保证 **HTTP 状态码与响应体一致**。
      // 修复前这里 return { code: 500 }，而控制器方法默认返回 201，
      // 于是出现"HTTP 201 + body.code=500"的矛盾响应，
      // 客户端按 status 判断会误认为创建成功。
      throw new InternalServerErrorException('创建签到课次失败，请稍后重试或联系管理员');
    }
  }

  @Post('sessions/batch-create')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'class', field: 'class_id' })
  async batchCreateSessions(@Body() dto: BatchCreateSessionsDto, @Req() req: any) {
    const count = this.clampBatchSessionCount(dto?.count);
    if (count <= 0) {
      return {
        code: 400,
        message: '批量创建数量必须大于 0',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const result = await this.createBatchSessions(
      count,
      this.resolveBatchExpireMinutes(dto?.expire_minutes),
      req,
    );
    if (!result) {
      return {
        code: 400,
        message: '当前没有可用于随机创建签到的班级和课程数据',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return {
      code: 0,
      message: '批量创建成功',
      data: result,
      trace_id: req.trace_id,
    };
  }

  @Post('sessions/batch-end')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'class', field: 'class_id' })
  async batchEndSessions(@Body() dto: BatchEndSessionsDto, @Req() req: any) {
    const result = await this.endSessionsBatch(dto?.session_ids || [], req);
    return {
      code: 0,
      message: '批量结束处理完成',
      data: result,
      trace_id: req.trace_id,
    };
  }

  @Post('sessions/batch-end-job')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'class', field: 'class_id' })
  async startBatchEndJob(@Body() dto: BatchSessionJobDto, @Req() req: any) {
    const startedAt = Date.now();
    const sessionIds = this.normalizeSessionIds(dto?.session_ids || []);
    if (sessionIds.length === 0) {
      return {
        code: 400,
        message: '请选择要结束的签到',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const jobId = randomUUID();
    this.logger.log(
      `[batchEnd][start] job=${jobId} sessions=${sessionIds.length} sessionIds=${sessionIds.join(',')} startCost=${Date.now() - startedAt}ms`,
    );
    void this.runBatchSessionJob(jobId, 'batch_end', sessionIds, req?.dataScope || { type: 'all' });

    return {
      code: 0,
      message: '批量结束任务已启动',
      data: {
        job_id: jobId,
        total: sessionIds.length,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('sessions/batch-delete')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'class', field: 'class_id' })
  async batchDeleteSessions(@Body() dto: BatchDeleteSessionsDto, @Req() req: any) {
    const result = await this.deleteSessionsBatch(dto?.session_ids || [], req);
    return {
      code: 0,
      message: '批量删除处理完成',
      data: result,
      trace_id: req.trace_id,
    };
  }

  @Post('sessions/batch-delete-job')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'class', field: 'class_id' })
  async startBatchDeleteJob(@Body() dto: BatchSessionJobDto, @Req() req: any) {
    const sessionIds = this.normalizeSessionIds(dto?.session_ids || []);
    if (sessionIds.length === 0) {
      return {
        code: 400,
        message: '请选择要删除的签到',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const jobId = randomUUID();
    void this.runBatchSessionJob(jobId, 'batch_delete', sessionIds, req?.dataScope || { type: 'all' });

    return {
      code: 0,
      message: '批量删除任务已启动',
      data: {
        job_id: jobId,
        total: sessionIds.length,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('batch-jobs/:id')
  @Permissions('attendance:manage')
  async getBatchJob(@Param('id') id: string, @Req() req: any) {
    const startedAt = Date.now();
    const job = await this.loadBatchJob(id);
    this.logger.log(
      `[batchJob][http] job=${id} found=${Boolean(job)} status=${job?.status || 'missing'} cost=${Date.now() - startedAt}ms`,
    );
    if (!job) {
      return {
        code: 404,
        message: '任务不存在或已过期',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return {
      code: 0,
      message: 'ok',
      data: job,
      trace_id: req.trace_id,
    };
  }

  // ============================================================
  // P1-6 日记录录入：作业状态 / 课堂表现 / 备注
  // ------------------------------------------------------------
  // 这是 homework_status 与 class_behavior 两个字段的**唯一真实录入入口**。
  // 没有它，homework_not_submit / homework_late_submit / class_behavior
  // 三个预警指标永远无法触发（原先 10 处写入全部硬编码 'unknown'）。
  // ============================================================

  private static readonly HOMEWORK_STATUSES = [
    'submitted',
    'not_submit',
    'late_submit',
    'unknown',
  ];
  private static readonly CLASS_BEHAVIORS = ['normal', 'disruptive'];

  /** 单条日记录录入（作业 / 课堂表现 / 备注） */
  @Post('daily-records')
  @Idempotent()
  @Permissions('attendance:manage')
  async upsertDailyRecord(@Body() dto: DailyRecordDto, @Req() req: any) {
    return this.saveDailyRecords([dto], req);
  }

  /** 批量日记录录入（同一班级多名学生一次提交） */
  @Post('daily-records/batch')
  @Idempotent()
  @Permissions('attendance:manage')
  async upsertDailyRecordsBatch(@Body() dto: BatchDailyRecordDto, @Req() req: any) {
    const records = Array.isArray(dto?.records) ? dto.records : [];
    if (records.length === 0) {
      return { code: 400, message: 'records 不能为空', data: null, trace_id: req.trace_id };
    }
    if (records.length > 500) {
      return { code: 400, message: '单次最多录入 500 条', data: null, trace_id: req.trace_id };
    }
    return this.saveDailyRecords(records, req);
  }

  /**
   * 日记录写入内核。
   *
   * 关键约束（对齐 §7.3）：
   *  - `course_id` **必填**，绝不写 NULL —— 唯一键 (student_id, record_date, course_id)
   *    在 course_id 为 NULL 时 MySQL 不去重，唯一键形同虚设；
   *  - 使用 upsert 合并到已有行，因此录入作业**不会覆盖**同一格的考勤状态；
   *  - 未传的字段保持原值（先查原行再决定 update 内容）。
   */
  private async saveDailyRecords(records: DailyRecordDto[], req: any) {
    const currentUserId = this.getRequestUserId(req);
    const classAccessCache = new Map<string, string | null>();
    const results: Array<{
      student_id: string;
      course_id: string;
      record_date: string;
      action: 'created' | 'updated';
      error?: string;
    }> = [];
    let failed = 0;

    for (const item of records) {
      const studentIdRaw = String(item?.student_id ?? '').trim();
      const courseIdRaw = String(item?.course_id ?? '').trim();
      const dateRaw = String(item?.record_date ?? '').trim();

      // --- 参数校验（错误带明细，便于前端逐条提示）---
      if (!studentIdRaw) {
        failed++;
        results.push({ student_id: '', course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: 'student_id 不能为空' });
        continue;
      }
      if (!courseIdRaw) {
        failed++;
        results.push({ student_id: studentIdRaw, course_id: '', record_date: dateRaw, action: 'created', error: 'course_id 必填（唯一键含 NULL 会失效）' });
        continue;
      }
      if (!/^\d+$/.test(studentIdRaw) || !/^\d+$/.test(courseIdRaw)) {
        failed++;
        results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: 'student_id 或 course_id 格式无效' });
        continue;
      }
      const recordDate = new Date(`${dateRaw}T00:00:00Z`);
      if (!dateRaw || Number.isNaN(recordDate.getTime())) {
        failed++;
        results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: 'record_date 格式应为 YYYY-MM-DD' });
        continue;
      }
      if (item.homework_status && !AttendanceController.HOMEWORK_STATUSES.includes(item.homework_status)) {
        failed++;
        results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: `homework_status 非法，应为 ${AttendanceController.HOMEWORK_STATUSES.join('/')}` });
        continue;
      }
      if (item.class_behavior && !AttendanceController.CLASS_BEHAVIORS.includes(item.class_behavior)) {
        failed++;
        results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: `class_behavior 非法，应为 ${AttendanceController.CLASS_BEHAVIORS.join('/')}` });
        continue;
      }

      try {
        const studentId = BigInt(studentIdRaw);
        const courseId = BigInt(courseIdRaw);

        // 学生档案 → 解析 class_id / org_id（这两个字段 daily_records 非空）
        const student = await this.prisma.student_profiles.findUnique({
          where: { id: studentId },
          select: { class_id: true, org_id: true, classes: { select: { org_id: true } } },
        });
        if (!student) {
          failed++;
          results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: '学生档案不存在' });
          continue;
        }
        const orgId = student.org_id ?? student.classes?.org_id ?? null;
        if (orgId === null) {
          failed++;
          results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: '无法解析该学生的组织 id' });
          continue;
        }

        if (!currentUserId) {
          failed++;
          results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: '未登录或无权操作该学生日记录' });
          continue;
        }

        const classKey = `${student.class_id.toString()}:${orgId.toString()}`;
        let accessError = classAccessCache.get(classKey);
        if (accessError === undefined) {
          const denial = await this.assertCanManageClass(
            student.class_id,
            orgId,
            currentUserId,
            req,
          );
          accessError = denial ? denial.message : null;
          classAccessCache.set(classKey, accessError);
        }
        if (accessError) {
          failed++;
          results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: accessError });
          continue;
        }

        const course = await this.prisma.courses.findUnique({
          where: { id: courseId },
          select: { id: true },
        });
        if (!course) {
          failed++;
          results.push({ student_id: studentIdRaw, course_id: courseIdRaw, record_date: dateRaw, action: 'created', error: '课程不存在' });
          continue;
        }

        const existing = await this.prisma.daily_records.findUnique({
          where: {
            student_id_record_date_course_id: {
              student_id: studentId,
              record_date: recordDate,
              course_id: courseId,
            },
          },
          select: { id: true, homework_status: true },
        });

        let derivedAttendanceStatus = 'unknown';
        if (!existing) {
          const nextDay = new Date(recordDate.getTime() + 24 * 60 * 60 * 1000);
          const matchingAttendance = await this.prisma.attendance_records.findFirst({
            where: {
              student_id: studentId,
              sessions: {
                course_id: courseId,
                session_start: {
                  gte: recordDate,
                  lt: nextDay,
                },
              },
            },
            orderBy: { checkin_time: 'desc' },
            select: { attendance_status: true },
          });
          if (matchingAttendance?.attendance_status) {
            derivedAttendanceStatus = matchingAttendance.attendance_status;
          }
        }

        const homeworkStatus =
          item.homework_status ?? existing?.homework_status ?? 'unknown';
        const behavior = item.class_behavior ?? null;
        const remarks = item.remarks === undefined ? null : item.remarks;

        await this.prisma.daily_records.upsert({
          where: {
            student_id_record_date_course_id: {
              student_id: studentId,
              record_date: recordDate,
              course_id: courseId,
            },
          },
          update: {
            homework_status: homeworkStatus,
            ...(behavior !== null ? { class_behavior: behavior } : {}),
            ...(remarks !== null ? { remarks } : {}),
            source: 'manual',
            updated_at: new Date(),
          },
          create: {
            student_id: studentId,
            record_date: recordDate,
            class_id: student.class_id,
            org_id: orgId,
            course_id: courseId,
            attendance_status: derivedAttendanceStatus,
            homework_status: homeworkStatus,
            class_behavior: behavior,
            remarks,
            source: 'manual',
            approved_status: 'approved',
          },
        });

        results.push({
          student_id: studentIdRaw,
          course_id: courseIdRaw,
          record_date: dateRaw,
          action: existing ? 'updated' : 'created',
        });

        // 作业未交 / 课堂违纪会影响预警指标 → 触发该学生重算
        if (homeworkStatus === 'not_submit' || behavior === 'disruptive') {
          await this.enqueueStudentRecalc(studentId, recordDate, courseId).catch(() => undefined);
        }
      } catch (error: any) {
        failed++;
        this.logger.error(
          `[日记录录入] 失败 student=${studentIdRaw} course=${courseIdRaw}: ${error?.message || error}`,
        );
        results.push({
          student_id: studentIdRaw,
          course_id: courseIdRaw,
          record_date: dateRaw,
          action: 'created',
          error: error?.message || '写入失败',
        });
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        total: records.length,
        success: records.length - failed,
        failed,
        results,
      },
      trace_id: req.trace_id,
    };
  }

  /** 入队该学生的预警重算（失败不影响主写入） */
  private async enqueueStudentRecalc(studentId: bigint, recordDate: Date, courseId: bigint) {
    await this.warningQueueService.scheduleAffectedRecords(
      [{ studentId, recordDate, courseId }],
      'daily_record.upsert',
    );
  }

  @Post('checkin')
  @Idempotent()
  async checkin(@Body() dto: CheckinDto, @Req() req: any) {
    try {
      const now = new Date();
      const studentIdRaw = String(req.user?.student_id || '').trim();
      if (!studentIdRaw) {
        return { code: 4010, message: '请先绑定学生身份后再签到', data: null, trace_id: req.trace_id };
      }

      const rawSessionId = String(dto.session_id ?? '').trim();
      if (!/^\d+$/.test(rawSessionId)) {
        return { code: 4001, message: '签到课次 ID 格式无效', data: null, trace_id: req.trace_id };
      }

      // 阶段1: 并行获取 session 和二维码配置
      const [session, refreshSeconds] = await Promise.all([
        this.prisma.class_sessions.findUnique({
          where: { id: BigInt(rawSessionId) },
        }),
        this.getQrRefreshSeconds(),
      ]);

      if (!session) {
        return { code: 4040, message: '签到课次不存在', data: null, trace_id: req.trace_id };
      }

      // 验证扫码令牌
      const providedScanToken = String(dto.scan_token || '').trim();
      const isValidScanToken = session.qr_token_hash
        ? isRollingScanTokenValid({
            providedToken: providedScanToken,
            qrTokenHash: session.qr_token_hash,
            sessionStart: session.session_start,
            refreshSeconds,
            now,
            leewayBuckets: 1,
          })
        : false;
      if (!providedScanToken || !isValidScanToken) {
        return { code: 4008, message: '签到口令无效或二维码已过期，请刷新后重试', data: null, trace_id: req.trace_id };
      }

      const sessionDeadline = this.getSessionDeadline(session);
      const lateThreshold = this.getLateThreshold(session);

      if (now.getTime() > sessionDeadline.getTime()) {
        return { code: 4007, message: '已超过本节课签到截止时间', data: null, trace_id: req.trace_id };
      }

      if (session.status !== 'active') {
        return { code: 4004, message: '该课次签到已结束', data: null, trace_id: req.trace_id };
      }

      const attendanceStatus =
        now.getTime() > lateThreshold.getTime() ? 'late' : 'on_time';
      const isLate = attendanceStatus === 'late';
      const studentIdBigInt = BigInt(studentIdRaw);

      // 阶段2: 并行获取学生、已有记录
      const [student, existingRecord] = await Promise.all([
        this.prisma.student_profiles.findUnique({
          where: { id: studentIdBigInt },
          include: { users: true },
        }),
        this.prisma.attendance_records.findUnique({
          where: {
            session_id_student_id: {
              session_id: session.id,
              student_id: studentIdBigInt,
            },
          },
        }),
      ]);

      if (!student) {
        return { code: 4002, message: '操作失败', data: null, trace_id: req.trace_id };
      }

      if (student.class_id !== session.class_id) {
        return { code: 4003, message: '您不属于该班级，无法签到', data: null, trace_id: req.trace_id };
      }

      if (
        existingRecord &&
        ['on_time', 'late'].includes(String(existingRecord.attendance_status || ''))
      ) {
        return { code: 4005, message: '您已签到', data: null, trace_id: req.trace_id };
      }

      if (!session.course_id) {
        return { code: 4006, message: '操作失败', data: null, trace_id: req.trace_id };
      }

      // 阶段3: 事务内写入 attendance + daily，快照异步刷新
      const recordDate = computeRecordDate(session.session_start);
      const [record] = await this.prisma.$transaction([
        this.prisma.attendance_records.upsert({
          where: {
            session_id_student_id: {
              session_id: session.id,
              student_id: student.id,
            },
          },
          update: {
            checkin_time: now,
            attendance_status: attendanceStatus,
            source: 'scan',
          },
          create: {
            session_id: session.id,
            student_id: student.id,
            checkin_time: now,
            attendance_status: attendanceStatus,
            source: 'scan',
          },
        }),
        this.prisma.daily_records.upsert({
          where: {
            student_id_record_date_course_id: {
              student_id: student.id,
              record_date: recordDate,
              course_id: session.course_id,
            },
          },
          update: {
            attendance_status: attendanceStatus,
            source: 'scan',
          },
          create: {
            student_id: student.id,
            record_date: recordDate,
            class_id: session.class_id,
            org_id: student.org_id || BigInt(0),
            course_id: session.course_id,
            attendance_status: attendanceStatus,
            homework_status: 'unknown',
            source: 'scan',
            approved_status: 'approved',
          },
        }),
      ]);

      this.attendanceSnapshotService.refreshSessions([session.id]).catch(() => {});

      return {
        code: 0,
        message: isLate ? '签到成功（迟到）' : '签到成功',
        data: {
          id: record.id.toString(),
          student_name: student.users?.name || '',
          student_no: student.student_no || '',
          attendance_status: attendanceStatus,
          is_late: isLate,
          checkin_time: record.checkin_time,
        },
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error(
        '学生签到失败',
        error instanceof Error ? error.stack : String(error),
      );
      return {
        code: 500,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Delete('sessions/:id')
  @Permissions('attendance:manage')
  // ----------------------------------------------------------------
  // 数据范围（本轮修复）
  //
  // 修复前本端点**没有** @DataScope：request.dataScope 恒为 undefined，
  // handler 里的 `req?.dataScope || { type: 'all' }` 退化成 all ——
  // 任何拥有 attendance:manage 的角色都能删除**任意班级**的签到课次。
  // 实测（修复前）：
  //   张老师(head_teacher, scope=class 1) 删除 class=2 的课次
  //   → HTTP 200 {"code":0,"message":"删除成功","affected_students_count":5002}
  // 一次越权调用抹掉 5002 名学生的考勤留痕，并级联删除关联预警。
  //
  // ⚠️ entity 必须是 'session' 而**不是** 'class'：
  //   本路由的 `:id` 是课次 id。声明成 'class' 会让拦截器拿课次 id 去查
  //   classes 表，必然 not found → 连自己班的课次也被 403（把功能改死）。
  //   已为拦截器补上 entity='session'：先课次→class_id，再判范围。
  // ----------------------------------------------------------------
  @DataScope({ entity: 'session', field: 'id' })
  async deleteSession(@Param('id') id: string, @Req() req: any) {
    const result = await this.processSingleDeleteSession(id, req?.dataScope || { type: 'all' });
    if (!result.deleted) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    if ((result.recalcTargets || []).length > 0) {
      this.dispatchWarningRecalcAsync(
        result.recalcTargets || [],
        'attendance.delete_session',
      );
    }

    return {
      code: 0,
      message: '删除成功',
      data: {
        deleted_warnings_count: Number(result.deletedWarningsCount || 0),
        affected_students_count: Number(result.affectedStudentsCount || 0),
      },
      trace_id: req.trace_id,
    };
  }

  private async assertCanReadSession(
    session: { class_id: bigint; teacher_user_id: bigint; classes?: { org_id: bigint } | null },
    req: any,
    options?: { allowStudentSelf?: boolean },
  ) {
    const currentUserId = this.getRequestUserId(req);
    if (!currentUserId) {
      return { code: 403, message: '无权访问该课次', data: null, trace_id: req.trace_id };
    }
    if (session.teacher_user_id === currentUserId) {
      return null;
    }

    const dataScope = req.dataScope || (await this.resolveDataScopeByUserId(currentUserId));
    if (dataScope?.type === 'self' && options?.allowStudentSelf === false) {
      return { code: 403, message: '无权读取签到二维码状态', data: null, trace_id: req.trace_id };
    }

    const classOrgId =
      session.classes?.org_id ??
      (
        await this.prisma.classes.findUnique({
          where: { id: session.class_id },
          select: { org_id: true },
        })
      )?.org_id;

    if (classOrgId === undefined || classOrgId === null) {
      return { code: 403, message: '无法校验课次所属学院', data: null, trace_id: req.trace_id };
    }

    return this.assertCanManageClass(session.class_id, classOrgId, currentUserId, req);
  }

  @Get('sessions/:id/attendance')
  @Permissions('attendance:read')
  @DataScope({ entity: 'session', field: 'id' })
  async getSessionAttendance(@Param('id') id: string, @Req() req: any) {
    if (!/^\d+$/.test(String(id || '').trim())) {
      return { code: 400, message: '课次 ID 无效', data: null, trace_id: req.trace_id };
    }
    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
      include: { classes: { select: { org_id: true } } },
    });
    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }
    const denial = await this.assertCanReadSession(session, req, { allowStudentSelf: true });
    if (denial) {
      return denial;
    }

    // 获取班级所有学生
    const students = await this.prisma.student_profiles.findMany({
      where: { class_id: session.class_id },
      include: {
        users: true,
      },
    });

    // 获取该课次的签到记录
    const attendanceRecords = await this.prisma.attendance_records.findMany({
      where: { session_id: BigInt(id) },
    });

    // 创建签到记录映射
    const attendanceMap = new Map<string, string>();
    attendanceRecords.forEach(record => {
      attendanceMap.set(record.student_id.toString(), record.attendance_status || 'absent');
    });
    const approvedLeaveIds = await this.getApprovedLeaveStudentIdsForSession({
      ...session,
      qr_expire_at: session.session_end || session.session_start,
    });

    // 构建学生列表，包含签到状态
    const studentList = students.map(student => ({
      id: student.id.toString(),
      name: student.users?.name || '',
      student_no: student.student_no || '',
      status: attendanceMap.get(student.id.toString()) || (approvedLeaveIds.has(student.id.toString()) ? 'leave' : 'absent'),
      lateMinutes: 0, // 默认迟到分钟数为 0
    }));

    return {
      code: 0,
      message: 'ok',
      data: studentList,
      trace_id: req.trace_id,
    };
  }

  @Post('sessions/:id/end')
  @Permissions('attendance:manage')
  // 数据范围：`:id` 是课次 id，因此用 entity='session'
  // （拦截器先解析 课次 → class_id，再判范围）。
  @DataScope({ entity: 'session', field: 'id' })
  async endSession(@Param('id') id: string, @Req() req: any) {
    const endpointStart = Date.now();
    this.logger.log(
      `[endSession] trace=${req.trace_id || '-'} 进入 课次=${id} 守卫耗时=${endpointStart - (req._guardEnterAt || endpointStart)}ms`,
    );

    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
      include: {
        classes: {
          select: {
            student_profiles: {
              where: { status: 'active' },
              select: this.buildSessionStudentsSelect(),
            },
          },
        },
      },
    });
    this.logger.log(
      `[endSession] trace=${req.trace_id || '-'} 查询课次+学生 耗时=${Date.now() - endpointStart}ms 课次=${id} 学生数=${session?.classes?.student_profiles?.length || 0}`,
    );

    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const now = new Date();
    const sessionDeadline = this.getSessionDeadline(session);
    if (session.status !== 'active' || sessionDeadline.getTime() <= now.getTime()) {
      return {
        code: 400,
        message: '当前课次已结束或不可提前结束',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const lockKey = `lock:session:end:${id}`;
    const lockValue = `${process.pid}:${Date.now()}:${id}`;
    const locked = await this.redis.acquireLock(lockKey, 60_000, lockValue);
    if (!locked) {
      return {
        code: 409,
        message: '该签到正在处理中，请稍后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }

    try {
      const t1 = Date.now();
      const changed = await this.markSessionEndedFast(session.id, now);
      if (!changed) {
        // 已有其它实例/定时器完成了结算，直接返回，避免重复补缺勤
        await this.redis.releaseLock(lockKey, lockValue).catch(() => undefined);
        return {
          code: 0,
          message: '签到已结束',
          data: { affectedStudents: null },
          trace_id: req.trace_id,
        };
      }
      setImmediate(() => {
        this.finalizeSessionEarly(session, now)
          .catch((err: any) => {
            this.logger.error(
              `[endSession][async] session=${session.id?.toString()} 异步处理签到记录失败: ${err?.message || err}`,
            );
          })
          .finally(() => {
            this.redis.releaseLock(lockKey, lockValue).catch((releaseError: any) => {
              this.logger.error(
                `[endSession][async] session=${session.id?.toString()} 释放锁失败: ${releaseError?.message || releaseError}`,
              );
            });
          });
      });
      this.logger.log(
        `[endSession] trace=${req.trace_id || '-'} 提前结束课次(秒返回) 耗时=${Date.now() - t1}ms 课次=${id}`,
      );
      this.logger.log(
        `[endSession] trace=${req.trace_id || '-'} 总计 耗时=${Date.now() - endpointStart}ms 课次=${id} 锁=true`,
      );

      return {
        code: 0,
        message: '已提前结束签到',
        data: { affectedStudents: null },
        trace_id: req.trace_id,
      };
    } catch (error) {
      await this.redis.releaseLock(lockKey, lockValue);
      throw error;
    }
  }

  @Get('sessions/:id/qr-state')
  @Permissions('attendance:read')
  @DataScope({ entity: 'session', field: 'id' })
  async getSessionQrState(@Param('id') id: string, @Req() req: any) {
    if (!/^\d+$/.test(String(id || '').trim())) {
      return { code: 400, message: '课次 ID 无效', data: null, trace_id: req.trace_id };
    }
    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
      include: { classes: { select: { org_id: true } } },
    });
    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }
    const denial = await this.assertCanReadSession(session, req, { allowStudentSelf: false });
    if (denial) {
      return denial;
    }

    const qrState = await this.buildQrStateForSession(session);
    return {
      code: 0,
      message: 'ok',
      data: {
        session_id: session.id.toString(),
        session_end: this.getSessionDeadline(session),
        ...qrState,
      },
      trace_id: req.trace_id,
    };
  }

  /**
   * 立即换码（强制轮换）
   *
   * 旧行为：`换二维码` 只是重新读取 qr-state。滚动 token 由
   * `sha256(qr_token_hash : bucketIndex)` 决定，而 bucketIndex 只随
   * session_start + refreshSeconds 变化，所以在同一个刷新窗口内重新读到的
   * 一定还是同一串 token —— 前端看起来就是「点了没反应」。
   *
   * 这里换的是**种子**：重新生成随机 salt 覆盖 `qr_token_hash`，
   * 于是所有旧窗口的 token 立即失效，新 bucket 又能算出一串新 token。
   * 代价：正在扫旧码的学生会失败一次，需要重新扫新码（前端会提示）。
   */
  @Post('sessions/:id/rotate-qr')
  @Permissions('attendance:manage')
  @DataScope({ entity: 'session', field: 'id' })
  async rotateSessionQr(@Param('id') id: string, @Req() req: any) {
    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
    });
    if (!session) {
      return { code: 404, message: '课次不存在', data: null, trace_id: req.trace_id };
    }

    const now = new Date();
    const deadline = this.getSessionDeadline(session);
    if (String(session.status || '') !== 'active') {
      return { code: 400, message: '签到已结束，无法换码', data: null, trace_id: req.trace_id };
    }
    if (deadline.getTime() <= now.getTime()) {
      return { code: 400, message: '签到已过截止时间，无法换码', data: null, trace_id: req.trace_id };
    }
    if (now.getTime() < session.session_start.getTime()) {
      return { code: 400, message: '签到尚未开始，无法换码', data: null, trace_id: req.trace_id };
    }

    const lockKey = `lock:session:rotate-qr:${id}`;
    const lockValue = `${process.pid}:${Date.now()}:${id}`;
    const locked = await this.redis.acquireLock(lockKey, 10_000, lockValue);
    if (!locked) {
      return { code: 409, message: '换码处理中，请稍后再试', data: null, trace_id: req.trace_id };
    }

    try {
      const salt = randomBytes(8).toString('hex');
      const qrTokenHash = createHash('sha256')
        .update(
          `${session.class_id}:${session.course_id}:${session.session_start.toISOString()}:${salt}`,
        )
        .digest('hex');

      const updated = await this.prisma.class_sessions.update({
        where: { id: session.id },
        data: { qr_token_hash: qrTokenHash },
      });

      const qrState = await this.buildQrStateForSession(updated, now);
      this.logger.log(
        `[rotate-qr] trace=${req.trace_id || '-'} 课次=${id} 已换码 新token=${qrState.scan_token}`,
      );

      return {
        code: 0,
        message: '二维码已更新，旧码立即失效',
        data: {
          session_id: updated.id.toString(),
          session_end: this.getSessionDeadline(updated),
          ...qrState,
        },
        trace_id: req.trace_id,
      };
    } finally {
      await this.redis.releaseLock(lockKey, lockValue).catch(() => undefined);
    }
  }

  @Get('sessions/:id/records')
  @Permissions('attendance:read')
  @DataScope({ entity: 'session', field: 'id' })
  async getSessionRecords(@Param('id') id: string, @Req() req: any) {
    if (!/^\d+$/.test(String(id || '').trim())) {
      return { code: 400, message: '课次 ID 无效', data: null, trace_id: req.trace_id };
    }
    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
      include: { classes: { select: { org_id: true } } },
    });
    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }
    const denial = await this.assertCanReadSession(session, req, { allowStudentSelf: true });
    if (denial) {
      return denial;
    }

    // 获取该课次的签到记录，包含学生信息，仅显示已签到名单
    const records = await this.prisma.attendance_records.findMany({
      where: {
        session_id: BigInt(id),
        attendance_status: {
          in: ['on_time', 'late']
        }
      },
      include: {
        students: {
          include: {
            users: true,
            classes: {
              include: {
                orgs: true,
              },
            },
          },
        },
      },
    });

    // 构建签到记录列表
    const recordList = records.map(record => ({
      id: record.id.toString(),
      student_name: record.students?.users?.name || '',
      student_no: record.students?.student_no || '',
      gender: record.students?.gender || '',
      org_name: record.students?.classes?.orgs?.name || '',
      checkin_time: record.checkin_time,
      attendance_status: record.attendance_status,
      source: record.source,
    }));

    return {
      code: 0,
      message: 'ok',
      data: recordList,
      trace_id: req.trace_id,
    };
  }

  @Post('sessions/:id/status')
  @Permissions('attendance:manage')
  // 数据范围：`:id` 是课次 id → entity='session'
  @DataScope({ entity: 'session', field: 'id' })
  async saveSessionStatus(@Param('id') id: string, @Body() dto: { statusList: Array<{ student_id: string; status: string; late_minutes: number }> }, @Req() req: any) {
    try {
      const session = await this.prisma.class_sessions.findUnique({
        where: { id: BigInt(id) },
      });
      if (!session) {
        return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
      }

      const now = new Date();
      const recordDate = computeRecordDate(session.session_start);
      const validItems = (dto.statusList || []).filter(
        (item) => item?.student_id && item?.status,
      );

      if (validItems.length === 0) {
        return { code: 0, message: '保存成功', data: null, trace_id: req.trace_id };
      }

      const studentIds = validItems.map((item) => BigInt(item.student_id));
      const students = await this.prisma.student_profiles.findMany({
        where: { id: { in: studentIds } },
      });
      const studentMap = new Map(
        students.map((s: any) => [s.id.toString(), s]),
      );

      // 批量构建写入操作
      const operations: Prisma.PrismaPromise<any>[] = [];
      for (const item of validItems) {
        if (item.status === 'on_time' || item.status === 'late' || item.status === 'leave') {
          operations.push(
            this.prisma.attendance_records.upsert({
              where: {
                session_id_student_id: {
                  session_id: BigInt(id),
                  student_id: BigInt(item.student_id),
                },
              },
              update: {
                attendance_status: item.status,
                checkin_time: now,
              },
              create: {
                session_id: BigInt(id),
                student_id: BigInt(item.student_id),
                checkin_time: now,
                attendance_status: item.status,
                source: 'manual',
              },
            }),
          );
        } else {
          operations.push(
            this.prisma.attendance_records.deleteMany({
              where: {
                session_id: BigInt(id),
                student_id: BigInt(item.student_id),
              },
            }),
          );
        }
      }

      for (const item of validItems) {
        const student = studentMap.get(item.student_id);
        if (!student || !session.course_id) continue;

        operations.push(
          this.prisma.daily_records.upsert({
            where: {
              student_id_record_date_course_id: {
                student_id: BigInt(item.student_id),
                record_date: recordDate,
                course_id: session.course_id,
              },
            },
            update: {
              attendance_status: item.status,
              source: 'manual',
            },
            create: {
              student_id: BigInt(item.student_id),
              record_date: recordDate,
              class_id: session.class_id,
              org_id: student.org_id || BigInt(0),
              course_id: session.course_id,
              attendance_status: item.status,
              homework_status: 'unknown',
              source: 'manual',
              approved_status: 'approved',
            },
          }),
        );
      }

      // 单事务批量写入
      await this.executeTransactionWithRetry(
        `批量保存签到状态 session=${id}`,
        () => operations,
      );

      // 异步预警重算（批量入队）
      const warningTargets = validItems
        .filter((item) => item.status === 'late' || item.status === 'absent' || item.status === 'early_leave')
        .map((item) => ({
          studentId: BigInt(item.student_id),
          recordDate,
          courseId: session.course_id || undefined,
          sessionId: BigInt(id),
        }));

      if (warningTargets.length > 0) {
        this.warningQueueService.scheduleAffectedRecords(
          warningTargets,
          'attendance.batch_status_update',
        ).catch((err: any) =>
          this.logger.warn(`批量状态更新预警入队失败: ${err?.message || err}`),
        );
      }

      await this.attendanceSnapshotService.refreshSessions([session.id]);

      return {
        code: 0,
        message: '保存成功',
        data: null,
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error(
        '批量保存签到状态失败',
        error instanceof Error ? error.stack : String(error),
      );
      return {
        code: 500,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  @Post('sessions/:id/students/:student_id/status')
  @Permissions('attendance:manage')
  // 数据范围：`:id` 是课次 id → entity='session'。
  // params/body 里的 student_id 也会被一并校验（该学生须在同一范围内）。
  @DataScope({ entity: 'session', field: 'id' })
  async updateStudentStatus(
    @Param('id') id: string,
    @Param('student_id') studentId: string,
    @Body() dto: UpdateStudentStatusDto,
    @Req() req: any
  ) {
    try {
      const session = await this.prisma.class_sessions.findUnique({
        where: { id: BigInt(id) },
      });
      if (!session) {
        return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
      }

      // 检查课次是否已结束
      const now = new Date();
      if (this.getSessionDeadline(session).getTime() > now.getTime() && session.status === 'active') {
        return { code: 400, message: '操作失败', data: null, trace_id: req.trace_id };
      }

      const nowTime = new Date();

      if (dto.status === 'on_time' || dto.status === 'late' || dto.status === 'leave') {
        await this.prisma.attendance_records.upsert({
          where: {
            session_id_student_id: {
              session_id: BigInt(id),
              student_id: BigInt(studentId),
            },
          },
          update: {
            attendance_status: dto.status,
            checkin_time: nowTime,
          },
          create: {
            session_id: BigInt(id),
            student_id: BigInt(studentId),
            checkin_time: nowTime,
            attendance_status: dto.status,
            source: 'manual',
          },
        });
      } else {
        await this.prisma.attendance_records.deleteMany({
          where: {
            session_id: BigInt(id),
            student_id: BigInt(studentId),
          },
        });
      }

      // 更新 daily_records
      const recordDate = new Date(
        Date.UTC(
          session.session_start.getFullYear(),
          session.session_start.getMonth(),
          session.session_start.getDate()
        )
      );
      const student = await this.prisma.student_profiles.findUnique({
        where: { id: BigInt(studentId) },
      });

      if (student && session.course_id) {
        // 使用 upsert 确保原子性
        await this.prisma.daily_records.upsert({
          where: {
            student_id_record_date_course_id: {
              student_id: BigInt(studentId),
              record_date: recordDate,
              course_id: session.course_id,
            },
          },
          update: {
            attendance_status: dto.status,
            source: 'manual',
          },
          create: {
            student_id: BigInt(studentId),
            record_date: recordDate,
            class_id: session.class_id,
            org_id: student.org_id || BigInt(0),
            course_id: session.course_id,
            attendance_status: dto.status,
            homework_status: 'unknown',
            source: 'manual',
            approved_status: 'approved',
          },
        });
      }

      // 同步违规记录
      await this.syncViolationWarning(BigInt(studentId), session, dto.status);
      await this.attendanceSnapshotService.refreshSessions([session.id]);

      return {
        code: 0,
        message: '更新成功',
        data: null,
        trace_id: req.trace_id,
      };
    } catch (error) {
      this.logger.error(
        '更新学生签到状态失败',
        error instanceof Error ? error.stack : String(error),
      );
      return {
        code: 500,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  /**
   * 同步违规记录
   * 若改为请假，则删除对应预警
   * 除请假外，其它状态对应的预警记录要同步变更
   */
  private async syncViolationWarning(
    studentId: bigint,
    session: any,
    status: string
  ) {
    const recordDate = new Date(
      Date.UTC(
        session.session_start.getFullYear(),
        session.session_start.getMonth(),
        session.session_start.getDate()
      )
    );

    if (session.course_id) {
      await this.warningService.generateWarningForStudent(studentId, recordDate, session.course_id);
    }
  }

  private getMetricValue(metric: string): string {
    const valueMap: Record<string, string> = {
      late: 'late',
      absent: 'absent',
      early_leave: 'early_leave',
    };
    return valueMap[metric] || metric;
  }
}

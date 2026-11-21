import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Post,
  Delete,
  Put,
  Body,
  Req,
  Param,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { AuthGuard } from '../shared/auth.guard';
import { RolesGuard, Roles } from '../shared/roles.guard';
import { createHash, randomBytes } from 'crypto';
import { WarningService } from '../warning/warning.service';
import { WarningQueueService } from '../warning/warning-queue.service';
import { SessionWarningGenerationService } from '../warning/session-warning-generation.service';
import { ConfigService } from '../config/config.service';
import {
  isValidMainlandMobile,
  normalizeMobile,
} from '../shared/account-security.util';
import {
  CHANGE_REQUEST_PENDING_DEAN_STATUSES,
  CHANGE_REQUEST_STATUS,
  normalizeChangeRequestStatus,
} from '../shared/change-request-status.util';
import { markSessionSettled } from '../attendance/attendance.utils';
import {
  normalizeFileIdList,
  parseOptionalFileIds,
} from '../shared/file.util';
import {
  getRollingQrState,
} from '../shared/qr-session.util';

const RECENT_ENDED_RECALC_KEY_PREFIX = 'warning:scan:recent-ended';
const ABNORMAL_ATTENDANCE_STATUSES = ['late', 'absent', 'early_leave'] as const;

class UpdateProfileDto {
  name?: string;
  mobile?: string;
  email?: string;
  teacher_position?: string;
}

class BindOrgDto {
  org_id!: string;
}

class CreateOrgChangeRequestDto {
  target_org_id!: string;
  reason!: string;
  evidence_file_id?: string;
  evidence_file_ids?: string[];
}

class BindCoursesDto {
  bindings!: Array<{
    course_id: string;
    class_ids: string[];
  }>;
}

class CreateSessionDto {
  course_id!: string;
  class_id!: string;
  start_time!: string;
  expire_minutes?: number;
  expire_seconds?: number;
}

@Controller('teacher')
@UseGuards(AuthGuard, RolesGuard)
export class TeacherController {
  private readonly logger = new Logger(TeacherController.name);
  private readonly defaultAttendanceWindowMinutes = 15;
  private readonly teacherReferenceCacheTtlSeconds = 300;
  private readonly sessionSettledTtlSeconds = 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly warningService: WarningService,
    private readonly warningQueueService: WarningQueueService,
    private readonly sessionWarningGenerationService: SessionWarningGenerationService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) { }

  private buildSessionSettledKey(sessionId: bigint | string) {
    return `warning:session:settled:${sessionId.toString()}`;
  }

  private buildSessionSettledPayload() {
    return JSON.stringify({
      version: 2,
      status: 'settled',
      settled_at: new Date().toISOString(),
    });
  }

  private async markSessionSettled(sessionId: bigint | string) {
    try {
      await this.redis.set(
        this.buildSessionSettledKey(sessionId),
        this.buildSessionSettledPayload(),
        'EX',
        this.sessionSettledTtlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        `标记课次 ${sessionId.toString()} 预警已结算失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async blockRecentEndedRecovery(sessionId: bigint | string, ttlSeconds = 900) {
    try {
      await this.redis.set(
        `${RECENT_ENDED_RECALC_KEY_PREFIX}:${sessionId.toString()}`,
        new Date().toISOString(),
        'EX',
        ttlSeconds,
      );
    } catch (error) {
      this.logger.warn(
        `最近结束恢复锁失败 课次=${sessionId.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getCachedTeacherPayload<T>(cacheKey: string, loader: () => Promise<T>) {
    void cacheKey;
    return loader();
  }

  private async invalidateTeacherReferenceCaches(userId: bigint) {
    void userId;
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
    teacherUserId: bigint,
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
        teacher_user_id: teacherUserId,
        status: 'active',
        session_start: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      select: {
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

  private async getTeacherAssignableOrgIds(userId: bigint) {
    const courseClasses = await this.prisma.course_classes.findMany({
      where: { teacher_user_id: userId },
      include: {
        classes: {
          select: { org_id: true },
        },
      },
    });

    const orgIds = Array.from(
      new Set(
        courseClasses
          .map((item: any) => item.classes?.org_id?.toString())
          .filter(Boolean),
      ),
    ).map((id: string) => BigInt(id));

    if (orgIds.length > 0) {
      return orgIds;
    }

    const activeOrgs = await this.prisma.orgs.findMany({
      where: { status: 'active' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    return activeOrgs.map((item: any) => item.id);
  }

  private async getTeacherAvailableBindingScope(userId: bigint, orgId: bigint) {
    const [orgClasses, orgCourses] = await Promise.all([
      this.prisma.classes.findMany({
        where: {
          org_id: orgId,
          status: 'active',
        },
        select: { id: true },
      }),
      this.prisma.courses.findMany({
        where: {
          org_id: orgId,
          status: 'active',
        },
        select: { id: true },
      }),
    ]);

    const classIds = orgClasses.map((item: any) => item.id);
    const courseIds = orgCourses.map((item: any) => item.id);

    if (classIds.length === 0 || courseIds.length === 0) {
      return {
        mode: 'org_all' as const,
        courseIds,
        classIds,
        pairSet: new Set<string>(),
      };
    }

    const orgCourseClasses = await this.prisma.course_classes.findMany({
      where: {
        class_id: { in: classIds },
        course_id: { in: courseIds },
      },
      select: {
        course_id: true,
        class_id: true,
        teacher_user_id: true,
      },
    });

    const assignedPairs = orgCourseClasses.filter(
      (item: any) => item.teacher_user_id.toString() === userId.toString(),
    );

    if (assignedPairs.length > 0) {
      return {
        mode: 'assigned' as const,
        courseIds: this.uniqueBigIntValues(assignedPairs.map((item: any) => item.course_id)),
        classIds: this.uniqueBigIntValues(assignedPairs.map((item: any) => item.class_id)),
        pairSet: new Set(
          assignedPairs.map(
            (item: any) => `${item.course_id.toString()}:${item.class_id.toString()}`,
          ),
        ),
      };
    }

    if (orgCourseClasses.length > 0) {
      return {
        mode: 'org_pairs' as const,
        courseIds: this.uniqueBigIntValues(orgCourseClasses.map((item: any) => item.course_id)),
        classIds: this.uniqueBigIntValues(orgCourseClasses.map((item: any) => item.class_id)),
        pairSet: new Set(
          orgCourseClasses.map(
            (item: any) => `${item.course_id.toString()}:${item.class_id.toString()}`,
          ),
        ),
      };
    }

    return {
      mode: 'org_all' as const,
      courseIds,
      classIds,
      pairSet: new Set<string>(),
    };
  }

  private uniqueBigIntValues(values: Array<bigint | null | undefined>) {
    const map = new Map<string, bigint>();
    for (const value of values) {
      if (!value) {
        continue;
      }
      map.set(value.toString(), value);
    }
    return Array.from(map.values());
  }

  private resolveAttendanceWindowSeconds(
    dto: CreateSessionDto,
    fallbackMinutes: number,
  ) {
    const rawSeconds = Number(dto.expire_seconds);
    if (Number.isFinite(rawSeconds) && rawSeconds > 0) {
      return Math.min(4 * 60 * 60, Math.max(60, Math.round(rawSeconds)));
    }

    const rawMinutes = Number(dto.expire_minutes);
    if (Number.isFinite(rawMinutes) && rawMinutes > 0) {
      return Math.min(4 * 60 * 60, Math.max(60, Math.round(rawMinutes * 60)));
    }

    return Math.min(4 * 60 * 60, Math.max(60, Math.round(fallbackMinutes * 60)));
  }

  private async listLeaveStudentsForSession(session: {
    class_id: bigint;
    session_start: Date;
    session_end?: Date | null;
  }) {
    const sessionDeadline = this.getSessionDeadline({
      ...session,
      qr_expire_at: session.session_end || session.session_start,
    });
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

    const studentIds = this.uniqueBigIntValues(leaveRequests.map((item: any) => item.student_id));
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
  }) {
    const deadline = session.session_end || session.session_start;
    const leaveRequests = await this.prisma.leave_requests.findMany({
      where: {
        class_id: session.class_id,
        status: 'approved',
        from_date: { lte: deadline },
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
      this.logger.log(`[endSession][warning] 课次=${sessionId.toString()} 无目标需重算`);
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
      `[endSession][warning] 课次=${sessionId.toString()} 开始同步重算 目标数=${targets.length} 来源=${source}`,
    );
    try {
      const syncResult = await this.warningService.generateWarningsForAffectedRecordsSync(targets);
      const lockedTargets = Number(syncResult?.targets_locked || 0);
      this.logger.log(
        `[endSession][warning] 课次=${sessionId.toString()} 同步重算 耗时=${Date.now() - startedAt}ms 新建=${Number(syncResult?.warnings_generated || 0)} 锁定=${lockedTargets}`,
      );

      if (lockedTargets > 0) {
        try {
          const queueStartedAt = Date.now();
          const queueResult = await this.warningQueueService.scheduleAffectedRecords(
            targets,
            `${source}.locked_retry`,
          );
          this.logger.warn(
            `[endSession][warning] 课次=${sessionId.toString()} 锁占用补偿入队 耗时=${Date.now() - queueStartedAt}ms 模式=${queueResult?.mode || 'unknown'} 入队=${Number(queueResult?.warnings_enqueued || 0)} 去重=${Number(queueResult?.warnings_deduped || 0)} 锁定=${lockedTargets}`,
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
        `课次 ${sessionId.toString()} 同步生成预警失败，耗时=${Date.now() - startedAt}ms，降级为入队重试: ${error?.message || error}`,
      );

      try {
        const queueStartedAt = Date.now();
        const queueResult = await this.warningQueueService.scheduleAffectedRecords(targets, source);
        const lockedTargets = Number(queueResult?.targets_locked || 0);
        const canSettle = queueResult?.mode === 'sync_fallback' && lockedTargets === 0;
        this.logger.log(
          `[endSession][warning] 课次=${sessionId.toString()} 降级入队 耗时=${Date.now() - queueStartedAt}ms 模式=${queueResult?.mode || 'unknown'} 新建=${Number(queueResult?.warnings_generated || 0)} 入队=${Number(queueResult?.warnings_enqueued || 0)} 锁定=${lockedTargets}`,
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

  private async finalizeSessionEarly(session: any, cutoffTime: Date) {
    const finalizeStartedAt = Date.now();
    this.logger.log(
      `[endSession][finalize] 课次=${session.id.toString()} 开始 学生数=${session.classes?.student_profiles?.length || 0} 截止=${cutoffTime.toISOString()}`,
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
      `[endSession][finalize] 课次=${session.id.toString()} 查询已有记录 耗时=${Date.now() - t}ms 已有=${existingStudentIds.size} 待处理=${students.length - existingStudentIds.size} 已有异常=${affectedRecords.size}`,
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
      `[endSession][finalize] 课次=${session.id.toString()} 查询已批准请假 耗时=${Date.now() - t}ms 请假=${approvedLeaveIds.size}`,
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
      `[endSession][finalize] 课次=${session.id.toString()} 构建数据行 耗时=${Date.now() - t}ms 签到记录=${attendanceRows.length} 日报记录=${dailyRows.length} 缺勤=${absentStudentIds.length} 请假=${leaveStudentIds.length} 预警目标=${affectedRecords.size}`,
    );

    const operations: any[] = [];
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
        data: {
          status: 'ended',
          session_end: cutoffTime,
          qr_expire_at: cutoffTime,
        },
      }),
    );

    t = Date.now();
    await this.prisma.$transaction(operations);
    this.logger.log(
      `[endSession][finalize] 课次=${session.id.toString()} 提交事务 耗时=${Date.now() - t}ms`,
    );

    void this.blockRecentEndedRecovery(session.id);

    t = Date.now();
    const warningResult = await this.processSessionWarningTargets(
      session.id,
      Array.from(affectedRecords.values()),
      'teacher.end_session',
    );
    this.logger.log(
      `[endSession][finalize] 课次=${session.id.toString()} 预警编排完成 耗时=${Date.now() - t}ms 模式=${warningResult.warning_queue_mode} 新建=${warningResult.warnings_generated} 入队=${warningResult.warnings_enqueued} 去重=${warningResult.warnings_deduped} 锁定=${warningResult.targets_locked} 可结算=${warningResult.can_settle}`,
    );
    if (warningResult.can_settle) {
      t = Date.now();
      markSessionSettled(this.redis, session.id, this.sessionSettledTtlSeconds, this.logger).catch(
        () => {},
      );
      this.logger.log(
        `[endSession][finalize] 课次=${session.id.toString()} 结算标记已派发 耗时=${Date.now() - t}ms`,
      );
    } else {
      this.logger.warn(
        `[endSession][finalize] 课次=${session.id.toString()} 预警尚未稳定完成，跳过 settled 标记，等待恢复扫描`,
      );
    }

    this.logger.log(
      `[endSession][finalize] 课次=${session.id.toString()} 完成 总耗时=${Date.now() - finalizeStartedAt}ms`,
    );

    return {
      affectedStudents: students.length,
      absent_records_generated: absentCount,
      warnings_generated: Number(warningResult.warnings_generated || 0),
      warnings_enqueued: Number(warningResult.warnings_enqueued || 0),
      warnings_deduped: Number(warningResult.warnings_deduped || 0),
      warning_queue_mode: warningResult.warning_queue_mode,
      warning_targets_locked: Number(warningResult.targets_locked || 0),
      warning_can_settle: Boolean(warningResult.can_settle),
    };
  }

  private async buildQrStateForSession(
    session: {
      id: bigint;
      session_start: Date;
      session_end?: Date | null;
      qr_expire_at: Date;
      qr_token_hash: string | null;
      class_id: bigint;
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

  private parseOptionalFileId(value: unknown) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return null;
    }

    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException('图片参数不合法');
    }

    return BigInt(normalized);
  }

  private mergeOptionalFileIds(value: unknown, legacyValue?: unknown) {
    return Array.from(
      new Map(
        [
          ...parseOptionalFileIds(value, '图片参数'),
          ...parseOptionalFileIds(legacyValue, '图片参数'),
        ].map((item) => [item.toString(), item]),
      ).values(),
    );
  }

  private getStoredFileIds(value: unknown, legacyValue?: unknown) {
    return normalizeFileIdList(value, legacyValue);
  }

  private async isMobileInUse(
    mobile: string,
    excludeUserId?: bigint,
    excludeStudentId?: bigint,
  ): Promise<boolean> {
    const [existingUser, existingStudent] = await Promise.all([
      this.prisma.users.findFirst({
        where: {
          mobile,
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.student_profiles.findFirst({
        where: {
          mobile,
          ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}),
        },
        select: { id: true },
      }),
    ]);

    return !!existingUser || !!existingStudent;
  }

  private resolveDisplayMobile(value?: string | null) {
    const normalized = normalizeMobile(value) || '';
    return normalized && isValidMainlandMobile(normalized) ? normalized : '';
  }

  private resolveProfileAccount(user: {
    id?: bigint;
    mobile?: string | null;
    email?: string | null;
  }) {
    const mobile = String(user?.mobile || '').trim();
    if (mobile) {
      return mobile;
    }

    const email = String(user?.email || '').trim();
    if (email) {
      return email;
    }

    return user?.id ? `user_${user.id.toString()}` : '';
  }

  @Get('binding-status')
  @Roles('teacher', 'head_teacher')
  async getBindingStatus(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const orgBinding = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { org_id: true },
    });

    const courseBindings = await this.prisma.teacher_course_bindings.findMany({
      where: { teacher_id: userId },
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        org_id: orgBinding?.org_id?.toString() || null,
        has_bound_org: !!orgBinding?.org_id,
        has_bound_courses: courseBindings.length > 0,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('bind-org')
  @Roles('teacher')
  async bindOrg(@Body() dto: BindOrgDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const rawOrgId = String(dto.org_id || '').trim();
    if (!/^\d+$/.test(rawOrgId)) {
      return {
        code: 400,
        message: '学院 ID 无效',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const orgId = BigInt(rawOrgId);

    const existingUser = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { org_id: true },
    });
    if (existingUser?.org_id && existingUser.org_id !== orgId) {
      return {
        code: 403,
        message: '已绑定学院，请通过学院变更申请流程提交审批',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const allowedOrgIds = await this.getTeacherAssignableOrgIds(userId);
    if (!allowedOrgIds.some((item: bigint) => item.toString() === orgId.toString())) {
      return {
        code: 403,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    await this.prisma.$transaction([
      this.prisma.users.update({
        where: { id: userId },
        data: { org_id: orgId },
      }),
      this.prisma.teacher_course_bindings.deleteMany({
        where: { teacher_id: userId },
      }),
    ]);
    await this.invalidateTeacherReferenceCaches(userId);

    const org = await this.prisma.orgs.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });

    return {
      code: 0,
      message: '绑定成功',
      data: {
        org_id: org?.id.toString() || orgId.toString(),
        org_name: org?.name || '',
      },
      trace_id: req.trace_id,
    };
  }

  @Post('bind-courses')
  @Roles('teacher', 'head_teacher')
  async bindCourses(@Body() dto: BindCoursesDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true, org_id: true },
    });

    if (!user?.org_id) {
      return {
        code: 400,
        message: '请先绑定学院',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const bindings = Array.isArray(dto.bindings) ? dto.bindings : [];
    if (bindings.length === 0) {
      throw new BadRequestException('至少选择一个课程班级绑定');
    }

    const courseIds = Array.from(
      new Set(bindings.map((binding: any) => String(binding.course_id || '').trim()).filter(Boolean)),
    ).map((id) => BigInt(id));
    const classIds = Array.from(
      new Set(
        bindings
          .flatMap((binding: any) => binding.class_ids || [])
          .map((id: any) => String(id || '').trim())
          .filter(Boolean),
      ),
    ).map((id) => BigInt(id));

    const availableScope = await this.getTeacherAvailableBindingScope(userId, user.org_id);

    const [courses, classes] = await Promise.all([
      this.prisma.courses.findMany({
        where: {
          id: { in: courseIds },
          org_id: user.org_id,
          status: 'active',
        },
        select: { id: true },
      }),
      this.prisma.classes.findMany({
        where: {
          id: { in: classIds },
          org_id: user.org_id,
          status: 'active',
        },
        select: { id: true },
      }),
    ]);

    const courseIdSet = new Set(courses.map((item: any) => item.id.toString()));
    const classIdSet = new Set(classes.map((item: any) => item.id.toString()));

    for (const binding of bindings) {
      const courseId = String(binding.course_id || '').trim();
      if (!courseIdSet.has(courseId)) {
        return {
          code: 400,
          message: '存在不属于当前学院或未启用的课程',
          data: null,
          trace_id: req.trace_id,
        };
      }

      for (const classId of binding.class_ids || []) {
        const normalizedClassId = String(classId || '').trim();
        if (!classIdSet.has(normalizedClassId)) {
          return {
            code: 400,
            message: '存在不属于当前学院或未启用的班级',
            data: null,
            trace_id: req.trace_id,
          };
        }

        if (
          availableScope.mode !== 'org_all'
          && !availableScope.pairSet.has(`${courseId}:${normalizedClassId}`)
        ) {
          return {
            code: 403,
            message:
              availableScope.mode === 'assigned'
                ? '仅允许绑定已分配给当前教师的开课班'
                : '仅允许绑定当前学院已配置的课程班级',
            data: null,
            trace_id: req.trace_id,
          };
        }
      }
    }

    const requestedPairs = bindings.flatMap((binding: any) =>
      (binding.class_ids || []).map((classId: any) => `${String(binding.course_id || '').trim()}:${String(classId || '').trim()}`),
    );
    const requestedPairSet = new Set(requestedPairs);
    const existingBindings = await this.prisma.teacher_course_bindings.findMany({
      where: { teacher_id: userId },
    });
    const existingPairSet = new Set(
      existingBindings.map((item: any) => `${item.course_id.toString()}:${item.class_id.toString()}`),
    );

    if (existingBindings.length > 0) {
      const noChanges =
        existingPairSet.size === requestedPairSet.size
        && [...requestedPairSet].every((item) => existingPairSet.has(item));

      if (noChanges) {
        return {
          code: 400,
          message: '当前课程绑定未发生变化',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const pendingRequest = await this.prisma.change_requests.findFirst({
        where: {
          requester_user_id: userId,
          target_type: 'teacher_course_binding_change',
          target_id: userId,
          status: {
            in: [
              CHANGE_REQUEST_STATUS.SUBMITTED,
              ...CHANGE_REQUEST_PENDING_DEAN_STATUSES,
            ],
          },
        },
        orderBy: { created_at: 'desc' },
      });

      if (pendingRequest) {
        return {
          code: 409,
          message: '您已有待处理的课程变更申请，请勿重复提交',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const currentCourseIds = existingBindings.map((item: any) => item.course_id);
      const currentClassIds = existingBindings.map((item: any) => item.class_id);
      const [allCourses, allClasses] = await Promise.all([
        this.prisma.courses.findMany({
          where: {
            id: { in: this.uniqueBigIntValues([...courseIds, ...currentCourseIds]) },
          },
          select: { id: true, course_name: true, course_code: true },
        }),
        this.prisma.classes.findMany({
          where: {
            id: { in: this.uniqueBigIntValues([...classIds, ...currentClassIds]) },
          },
          select: { id: true, class_name: true },
        }),
      ]);

      const courseMap = new Map(
        allCourses.map((item: any) => [
          item.id.toString(),
          item.course_name || item.course_code || `课程${item.id.toString()}`,
        ]),
      );
      const classMap = new Map(
        allClasses.map((item: any) => [item.id.toString(), item.class_name || `班级${item.id.toString()}`]),
      );
      const summarizeBindings = (records: Array<{ courseId: string; classIds: string[] }>) =>
        records
          .map((item) => {
            const courseName = courseMap.get(item.courseId) || item.courseId;
            const classNames = item.classIds.map((classId) => classMap.get(classId) || classId);
            return `${courseName}：${classNames.join('、')}`;
          })
          .join('；');

      const currentBindingMap = new Map<string, string[]>();
      existingBindings.forEach((item: any) => {
        const courseId = item.course_id.toString();
        const current = currentBindingMap.get(courseId) || [];
        current.push(item.class_id.toString());
        currentBindingMap.set(courseId, current);
      });

      const targetBindings = bindings.map((binding: any) => ({
        course_id: String(binding.course_id || '').trim(),
        class_ids: Array.from(
          new Set(
            (binding.class_ids || [])
              .map((item: any) => String(item || '').trim())
              .filter(Boolean),
          ),
        ),
      }));
      const currentBindingsPayload = Array.from(currentBindingMap.entries()).map(([courseId, classIdList]) => ({
        course_id: courseId,
        class_ids: Array.from(new Set(classIdList)),
      }));

      const request = await this.prisma.change_requests.create({
        data: {
          requester_user_id: userId,
          target_type: 'teacher_course_binding_change',
          target_id: userId,
          reason: `申请调整 ${user.name || '教师'} 的任教课程与班级绑定`,
          status: CHANGE_REQUEST_STATUS.SUBMITTED,
          change_json: {
            request_type: 'teacher_course_binding_change',
            workflow_stage: 'teaching_admin_review',
            teacher_name: user.name || '',
            org_id: user.org_id.toString(),
            current_bindings: currentBindingsPayload,
            target_bindings: targetBindings,
            current_value: summarizeBindings(
              currentBindingsPayload.map((item) => ({
                courseId: item.course_id,
                classIds: item.class_ids,
              })),
            ),
            target_value: summarizeBindings(
              targetBindings.map((item) => ({
                courseId: item.course_id,
                classIds: item.class_ids as string[],
              })),
            ),
          } as any,
        },
      });

      return {
        code: 0,
        message: '课程变更申请已提交，等待教务管理员审批',
        data: {
          id: request.id.toString(),
          workflow_status: normalizeChangeRequestStatus(request.status),
          approval_submitted: true,
        },
        trace_id: req.trace_id,
      };
    }

    await this.prisma.$transaction(async (prisma: any) => {
      await prisma.teacher_course_bindings.deleteMany({
        where: { teacher_id: userId },
      });

      for (const binding of bindings) {
        const courseId = BigInt(binding.course_id);

        for (const classIdStr of binding.class_ids) {
          const classId = BigInt(classIdStr);

          await prisma.teacher_course_bindings.create({
            data: {
              teacher_id: userId,
              org_id: user.org_id!,
              course_id: courseId,
              class_id: classId,
            },
          });
        }
      }
    });
    await this.invalidateTeacherReferenceCaches(userId);

    return {
      code: 0,
      message: '绑定成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('orgs')
  @Roles('teacher')
  async getAllOrgs(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const data = await this.getCachedTeacherPayload(`teacher:orgs:${userId.toString()}`, async () => {
      const orgIds = await this.getTeacherAssignableOrgIds(userId);
      if (orgIds.length === 0) {
        return [];
      }

      const orgs = await this.prisma.orgs.findMany({
        where: {
          id: { in: orgIds },
          status: 'active',
        },
        orderBy: { id: 'asc' },
      });

      return orgs.map((org: any) => ({
        id: org.id.toString(),
        name: org.name,
      }));
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('courses')
  @Roles('teacher', 'head_teacher')
  async getCourses(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const data = await this.getCachedTeacherPayload(`teacher:courses:${userId.toString()}`, async () => {
      const user = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { org_id: true },
      });

      let courses: any[] = [];
      if (user?.org_id) {
        const availableScope = await this.getTeacherAvailableBindingScope(userId, user.org_id);
        if (availableScope.courseIds.length > 0) {
          courses = await this.prisma.courses.findMany({
            where: {
              id: { in: availableScope.courseIds },
              org_id: user.org_id,
              status: 'active',
            },
            orderBy: { id: 'asc' },
          });
        }
      }

      return courses.map((course: any) => ({
        id: course.id.toString(),
        course_code: course.course_code,
        course_name: course.course_name,
        credit: course.credit,
      }));
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('classes')
  @Roles('teacher', 'head_teacher')
  async getAllClasses(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const data = await this.getCachedTeacherPayload(`teacher:classes:${userId.toString()}`, async () => {
      const user = await this.prisma.users.findUnique({
        where: { id: userId },
        select: { org_id: true },
      });

      if (!user?.org_id) {
        return [];
      }

      const availableScope = await this.getTeacherAvailableBindingScope(userId, user.org_id);

      const classes = availableScope.classIds.length > 0
        ? await this.prisma.classes.findMany({
            where: {
              id: { in: availableScope.classIds },
              org_id: user.org_id,
              status: 'active',
            },
            orderBy: { id: 'asc' },
          })
        : [];

      return classes.map((cls: any) => ({
        id: cls.id.toString(),
        class_name: cls.class_name,
      }));
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('my-bindings')
  @Roles('teacher', 'head_teacher')
  async getMyBindings(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const data = await this.getCachedTeacherPayload(`teacher:my-bindings:${userId.toString()}`, async () => {
      const bindings = await this.prisma.teacher_course_bindings.findMany({
        where: { teacher_id: userId },
      });

      const courseIds = bindings.map((b: any) => b.course_id);
      const classIds = bindings.map((b: any) => b.class_id);

      const courses = await this.prisma.courses.findMany({
        where: { id: { in: courseIds } },
      });

      const classes = await this.prisma.classes.findMany({
        where: { id: { in: classIds } },
      });

      const courseMapById = new Map(courses.map((c: any) => [c.id.toString(), c]));
      const classMapById = new Map(classes.map((c: any) => [c.id.toString(), c]));

      const courseMap = new Map<string, any>();
      const classesByCourse: Record<string, any[]> = {};

      bindings.forEach((binding: any) => {
        const courseId = binding.course_id.toString();

        if (!courseMap.has(courseId)) {
          const course = courseMapById.get(courseId) as any;
          courseMap.set(courseId, {
            id: courseId,
            course_code: course?.course_code || '',
            course_name: course?.course_name || '',
            credit: course?.credit || 0,
          });
          classesByCourse[courseId] = [];
        }

        const classId = binding.class_id.toString();
        const cls = classMapById.get(classId) as any;

        classesByCourse[courseId].push({
          id: classId,
          class_name: cls?.class_name || '',
        });
      });

      return {
        courses: Array.from(courseMap.values()),
        classes_by_course: classesByCourse,
      };
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('sessions')
  @Roles('teacher', 'head_teacher')
  async listSessions(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const sessions = await this.prisma.class_sessions.findMany({
      where: {
        teacher_user_id: userId,
      },
      orderBy: { session_start: 'desc' },
      take: 50,
      include: {
        courses: true,
        classes: true,
      },
    });

    const sessionIds = sessions.map((s: any) => s.id);

    const refreshSeconds = await this.getQrRefreshSeconds();
    const now = new Date();
    const [attendanceRecords, supportMaps] = await Promise.all([
      this.prisma.attendance_records.findMany({
        where: { session_id: { in: sessionIds } },
      }),
      this.buildSessionSupportMaps(sessions),
    ]);

    const recordMap = new Map<bigint, any[]>();
    attendanceRecords.forEach((record: any) => {
      if (!recordMap.has(record.session_id)) {
        recordMap.set(record.session_id, []);
      }
      recordMap.get(record.session_id)!.push(record);
    });

    const studentCountMap = supportMaps.studentCountMap;
    const leaveIdMap = supportMaps.leaveIdMap;

    return {
      code: 0,
      message: 'ok',
      data: sessions.map((s: any) => {
        const records = recordMap.get(s.id) || [];
        const totalStudents = studentCountMap.get(s.class_id.toString()) || 0;
        const approvedLeaveIds = leaveIdMap.get(s.id.toString()) || new Set<string>();
        const checkedInCount = records.filter((r: any) =>
          r.attendance_status === 'on_time' || r.attendance_status === 'late'
        ).length;
        const onTimeCount = records.filter((r: any) => r.attendance_status === 'on_time').length;
        const lateCount = records.filter((r: any) => r.attendance_status === 'late').length;
        const recordStatusMap = new Map<string, string>();
        records.forEach((record: any) => {
          recordStatusMap.set(record.student_id.toString(), String(record.attendance_status || ''));
        });
        const effectiveLeaveIds = new Set<string>();
        recordStatusMap.forEach((status, studentId) => {
          if (status === 'leave') {
            effectiveLeaveIds.add(studentId);
          }
        });
        approvedLeaveIds.forEach((studentId) => {
          if (!recordStatusMap.has(studentId)) {
            effectiveLeaveIds.add(studentId);
          }
        });
        const leaveCount = effectiveLeaveIds.size;

        const isEnded = this.getSessionDeadline(s) <= now;
        const absentCount = isEnded ? Math.max(totalStudents - leaveCount - checkedInCount, 0) : 0;
        const sessionEnd = this.getSessionDeadline(s);
        const qrState = getRollingQrState({
          sessionStart: s.session_start,
          sessionEnd,
          qrTokenHash: s.qr_token_hash || '',
          refreshSeconds,
          now,
        });

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
          scan_token: qrState.currentToken,
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
  @Roles('teacher', 'head_teacher')
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
  @Roles('teacher', 'head_teacher')
  async createSession(@Body() dto: CreateSessionDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const bindings = await this.prisma.teacher_course_bindings.findMany({
      where: {
        teacher_id: userId,
        course_id: BigInt(dto.course_id),
        class_id: BigInt(dto.class_id),
      },
    });

    if (bindings.length === 0) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const start = new Date(dto.start_time);
    const qrRefreshSeconds = await this.getQrRefreshSeconds();
    const expireAt = new Date(start.getTime() + qrRefreshSeconds * 1000);
    const matchedSchedule = await this.findClosestSchedule(
      BigInt(dto.course_id),
      BigInt(dto.class_id),
      userId,
      start,
    );
    const attendanceWindowSeconds = this.resolveAttendanceWindowSeconds(
      dto,
      Number(matchedSchedule?.expire_minutes || this.defaultAttendanceWindowMinutes),
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
        teacher_user_id: userId,
        session_start: start,
        session_end: sessionEnd,
        qr_token_hash: qrTokenHash,
        qr_expire_at: expireAt,
        status: 'active',
      },
    });
    const qrState = await this.buildQrStateForSession(session);

    try {
      const [teacher, course] = await Promise.all([
        this.prisma.users.findUnique({
          where: { id: userId },
          select: { name: true },
        }),
        this.prisma.courses.findUnique({
          where: { id: BigInt(dto.course_id) },
          select: { course_name: true },
        }),
      ]);

      const courseName = course?.course_name || '课程';
      await this.prisma.class_notifications.create({
        data: {
          class_id: BigInt(dto.class_id),
          org_id: (
            await this.prisma.classes.findUnique({
              where: { id: BigInt(dto.class_id) },
              select: { org_id: true },
            })
          )?.org_id || BigInt(0),
          title: `${courseName}已开始`,
          content: `${courseName}已开始，请前往小程序进行签到。`,
          publisher_id: userId,
          publisher_name: teacher?.name || '任课教师',
        },
      });
    } catch (error) {
      this.logger.warn(
        `创建签到课次后发送班级通知失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      code: 0,
      message: 'ok',
        data: {
          session_id: session.id.toString(),
          scan_token: qrState.scan_token,
          session_end: sessionEnd.toISOString(),
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
  }

  @Get('sessions/:id/qr-state')
  @Roles('teacher', 'head_teacher')
  async getSessionQrState(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
    });

    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    if (session.teacher_user_id.toString() !== userId.toString()) {
      return { code: 403, message: '操作失败', data: null, trace_id: req.trace_id };
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

  @Delete('sessions/:id')
  @Roles('teacher', 'head_teacher')
  async deleteSession(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
    });

    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    if (session.teacher_user_id !== userId) {
      return { code: 403, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const sessionId = BigInt(id);
    const attendanceRecords = await this.prisma.attendance_records.findMany({
      where: { session_id: sessionId },
    });
    const affectedStudentIds = [...new Set(attendanceRecords.map((r: any) => r.student_id))];

    const recordDate = new Date(
      Date.UTC(
        session.session_start.getFullYear(),
        session.session_start.getMonth(),
        session.session_start.getDate()
      )
    );
    const dayStart = new Date(session.session_start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [warningRefs, currentWarningRefs, remainingRecords] = await Promise.all([
      affectedStudentIds.length > 0
        ? this.prisma.warnings.findMany({
            where: {
              student_id: { in: affectedStudentIds },
              trigger_detail_json: {
                path: '$.session_id',
                equals: sessionId.toString(),
              },
            },
            select: {
              id: true,
            },
          })
        : Promise.resolve([] as Array<{ id: bigint }>),
      affectedStudentIds.length > 0
        ? (this.prisma as any).warning_current_states.findMany({
            where: {
              student_id: { in: affectedStudentIds },
              trigger_detail_json: {
                path: '$.session_id',
                equals: sessionId.toString(),
              },
            },
            select: {
              id: true,
            },
          })
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

    const warningsToDelete = warningRefs.map((warning: { id: bigint }) => warning.id);
    const currentWarningsToDelete = currentWarningRefs.map((warning: { id: bigint }) => warning.id);
    const studentsWithRemainingRecords = new Set(
      remainingRecords.map((item) => item.student_id.toString()),
    );
    const dailyRecordStudentIdsToDelete = affectedStudentIds.filter(
      (studentId) => !studentsWithRemainingRecords.has(studentId.toString()),
    );
    const notificationJobIds =
      warningsToDelete.length > 0
        ? (
            await this.prisma.notification_jobs.findMany({
              where: { warning_id: { in: warningsToDelete } },
              select: { id: true },
            })
          ).map((job: any) => job.id as bigint)
        : [];

    await this.prisma.$transaction(async (tx) => {
      if (notificationJobIds.length > 0) {
        await tx.notification_logs.deleteMany({
          where: { job_id: { in: notificationJobIds } },
        });
      }

      if (warningsToDelete.length > 0) {
        await tx.notification_jobs.deleteMany({
          where: { warning_id: { in: warningsToDelete } },
        });
        await tx.warnings.deleteMany({
          where: { id: { in: warningsToDelete } },
        });
      }

      if (currentWarningsToDelete.length > 0) {
        await (tx as any).warning_current_states.deleteMany({
          where: { id: { in: currentWarningsToDelete } },
        });
      }

      if (dailyRecordStudentIdsToDelete.length > 0) {
        await tx.daily_records.deleteMany({
          where: {
            student_id: { in: dailyRecordStudentIdsToDelete },
            record_date: recordDate,
            course_id: session.course_id,
          },
        });
      }

      await tx.class_sessions.delete({
        where: { id: sessionId },
      });
    });

    if (affectedStudentIds.length > 0) {
      this.warningQueueService
        .scheduleAffectedRecords(
          affectedStudentIds.map((studentId: bigint) => ({
            studentId,
            recordDate,
            courseId: session.course_id,
          })),
          'teacher.delete_session',
        )
        .catch((error: any) => {
          this.logger.warn(`预警入队失败: ${error?.message || error}`);
          this.warningService
            .generateWarningsForAffectedRecordsSync(
              affectedStudentIds.map((studentId: bigint) => ({
                studentId,
                recordDate,
                courseId: session.course_id,
              })),
            )
            .catch(() => {});
        });
    }
    markSessionSettled(this.redis, id, this.sessionSettledTtlSeconds, this.logger).catch(() => {});

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Post('sessions/:id/end')
  @Roles('teacher', 'head_teacher')
  async endSession(@Param('id') id: string, @Req() req: any) {
    const endpointStart = Date.now();
    this.logger.log(
      `[endSession] 追踪=${req.trace_id || '-'} 进入 课次=${id} 守卫耗时=${endpointStart - (req._guardEnterAt || endpointStart)}ms`,
    );

    let t = Date.now();
    await this.prisma.ensureConnected();
    this.logger.log(
      `[endSession] 追踪=${req.trace_id || '-'} 确保连接 耗时=${Date.now() - t}ms 课次=${id}`,
    );

    // 课次级分布式锁：避免同一课次被重复结束，同时允许不同课次并行结束
    const lockKey = `lock:session:end:${id}`;
    t = Date.now();
    const lockResult = await this.redis.withLock(lockKey, 60_000, async () => {
      const callbackStartedAt = Date.now();
      const userId = BigInt(req.user.sub);
      const queryStartedAt = Date.now();
      const session = await this.prisma.class_sessions.findUnique({
        where: { id: BigInt(id) },
        include: {
          classes: {
            include: {
              student_profiles: true,
            },
          },
        },
      });
      this.logger.log(
        `[endSession] 追踪=${req.trace_id || '-'} 查询课次 耗时=${Date.now() - queryStartedAt}ms 课次=${id} 学生数=${session?.classes?.student_profiles?.length || 0}`,
      );

      if (!session) {
        return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
      }

      if (session.teacher_user_id !== userId) {
        return { code: 403, message: '操作失败', data: null, trace_id: req.trace_id };
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

      const finalizeStartedAt = Date.now();
      const result = await this.finalizeSessionEarly(session, now);
      this.logger.log(
        `[endSession] 追踪=${req.trace_id || '-'} 提前结束课次 耗时=${Date.now() - finalizeStartedAt}ms 课次=${id}`,
      );
      this.logger.log(
        `[endSession] 追踪=${req.trace_id || '-'} 锁回调总计 耗时=${Date.now() - callbackStartedAt}ms 课次=${id}`,
      );

      return {
        code: 0,
        message: '已提前结束签到',
        data: result,
        trace_id: req.trace_id,
      };
    });
    this.logger.log(
      `[endSession] 追踪=${req.trace_id || '-'} 获取锁总计 耗时=${Date.now() - t}ms 课次=${id} 已锁=${lockResult.locked}`,
    );
    this.logger.log(
      `[endSession] 追踪=${req.trace_id || '-'} 总计 耗时=${Date.now() - endpointStart}ms 课次=${id} 锁=${lockResult.locked}`,
    );

    if (!lockResult.locked) {
      return {
        code: 409,
        message: '该签到正在处理中，请稍后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return lockResult.result;
  }

  @Get('sessions/:id/attendance')
  @Roles('teacher', 'head_teacher')
  async getSessionAttendance(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
    });

    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    if (session.teacher_user_id !== userId) {
      return { code: 403, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const students = await this.prisma.student_profiles.findMany({
      where: { class_id: session.class_id },
      include: {
        users: true,
      },
    });

    const attendanceRecords = await this.prisma.attendance_records.findMany({
      where: { session_id: BigInt(id) },
    });

    const attendanceMap = new Map<string, string>();
    attendanceRecords.forEach((record: any) => {
      attendanceMap.set(record.student_id.toString(), record.attendance_status || 'absent');
    });
    const approvedLeaveIds = await this.getApprovedLeaveStudentIdsForSession({
      class_id: session.class_id,
      session_start: session.session_start,
      session_end: session.session_end,
    });

    const studentList = students.map((student: any) => ({
      id: student.id.toString(),
      name: student.users?.name || '',
      student_no: student.student_no || '',
      status: attendanceMap.get(student.id.toString()) || (approvedLeaveIds.has(student.id.toString()) ? 'leave' : 'absent'),
      lateMinutes: 0,
    }));

    return {
      code: 0,
      message: 'ok',
      data: studentList,
      trace_id: req.trace_id,
    };
  }

  @Get('sessions/:id/records')
  @Roles('teacher', 'head_teacher')
  async getSessionRecords(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
    });

    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    if (session.teacher_user_id !== userId) {
      return { code: 403, message: '操作失败', data: null, trace_id: req.trace_id };
    }

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

    const recordList = records.map((record: any) => ({
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

  @Post('sessions/:id/students/:student_id/status')
  @Roles('teacher', 'head_teacher')
  async updateStudentStatus(
    @Param('id') id: string,
    @Param('student_id') studentId: string,
    @Body() dto: { status: string; late_minutes?: number },
    @Req() req: any
  ) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const session = await this.prisma.class_sessions.findUnique({
      where: { id: BigInt(id) },
    });

    if (!session) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    if (session.teacher_user_id !== userId) {
      return { code: 403, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const now = new Date();
    if (this.getSessionDeadline(session).getTime() > now.getTime() && session.status === 'active') {
      return { code: 400, message: '操作失败', data: null, trace_id: req.trace_id };
    }

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
          checkin_time: now,
        },
        create: {
          session_id: BigInt(id),
          student_id: BigInt(studentId),
          checkin_time: now,
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

    await this.syncViolationWarning(BigInt(studentId), session, dto.status);

    return {
      code: 0,
      message: '更新成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  private async syncViolationWarning(studentId: bigint, session: any, status: string) {
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

  @Get('profile')
  @Roles('teacher', 'head_teacher')
  async getProfile(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: {
        orgs: true,
      },
    });

    if (!user) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        id: user.id.toString(),
        account: this.resolveProfileAccount(user),
        name: user.name,
        mobile: this.resolveDisplayMobile(user.mobile),
        email: user.email,
        teacher_position: user.teacher_position,
        org_id: user.org_id?.toString() || null,
        org_name: user.orgs?.name || null,
        user_type: user.user_type,
        status: user.status,
        created_at: user.created_at,
      },
      trace_id: req.trace_id,
    };
  }

  @Put('profile')
  @Roles('teacher', 'head_teacher')
  async updateProfile(@Body() dto: UpdateProfileDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.teacher_position !== undefined) updateData.teacher_position = dto.teacher_position;

    await this.prisma.users.update({
      where: { id: userId },
      data: updateData,
    });

    return {
      code: 0,
      message: '更新成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('org-change-requests')
  @Roles('teacher')
  async listOrgChangeRequests(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const requests = await this.prisma.change_requests.findMany({
      where: {
        requester_user_id: userId,
        target_type: 'teacher_org_change',
        target_id: userId,
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: requests.map((item: any) => {
        const change = (item.change_json as any) || {};
        const evidenceFileIds = this.getStoredFileIds(
          change.evidence_file_ids,
          change.evidence_file_id,
        );
        return {
          id: item.id.toString(),
          status: normalizeChangeRequestStatus(item.status),
          reason: item.reason || '',
          current_org_name: change.current_org_name || '',
          target_org_name: change.target_org_name || '',
          evidence_file_id: evidenceFileIds[0] || '',
          evidence_file_ids: evidenceFileIds,
          reject_reason: item.reject_reason || '',
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Get('course-binding-requests')
  @Roles('teacher', 'head_teacher')
  async listCourseBindingRequests(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const requests = await this.prisma.change_requests.findMany({
      where: {
        requester_user_id: userId,
        target_type: 'teacher_course_binding_change',
        target_id: userId,
      },
      orderBy: { created_at: 'desc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: requests.map((item: any) => {
        const change = (item.change_json as any) || {};
        return {
          id: item.id.toString(),
          status: normalizeChangeRequestStatus(item.status),
          reason: item.reason || '',
          current_value: change.current_value || '',
          target_value: change.target_value || '',
          reject_reason: item.reject_reason || '',
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Post('org-change-requests')
  @Roles('teacher')
  async createOrgChangeRequest(@Body() dto: CreateOrgChangeRequestDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const targetOrgIdText = String(dto.target_org_id || '').trim();
    const reason = String(dto.reason || '').trim();
    const evidenceFileIds = this.mergeOptionalFileIds(
      dto.evidence_file_ids,
      dto.evidence_file_id,
    );
    if (!targetOrgIdText || !reason) {
      return {
        code: 400,
        message: '请完整填写目标学院和申请原因',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const targetOrgId = BigInt(targetOrgIdText);
    const allowedOrgIds = await this.getTeacherAssignableOrgIds(userId);
    if (!allowedOrgIds.some((item: bigint) => item.toString() === targetOrgId.toString())) {
      return {
        code: 403,
        message: '无权申请该学院',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const [user, targetOrg, pendingRequest] = await Promise.all([
      this.prisma.users.findUnique({
        where: { id: userId },
        include: { orgs: true },
      }),
      this.prisma.orgs.findUnique({
        where: { id: targetOrgId },
        select: { id: true, name: true, status: true },
      }),
      this.prisma.change_requests.findFirst({
        where: {
          requester_user_id: userId,
          target_type: 'teacher_org_change',
          target_id: userId,
          status: { in: [...CHANGE_REQUEST_PENDING_DEAN_STATUSES] },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    if (!user) {
      return {
        code: 404,
        message: '教师不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!targetOrg || targetOrg.status !== 'active') {
      return {
        code: 404,
        message: '目标学院不存在或已停用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (user.org_id?.toString() === targetOrgId.toString()) {
      return {
        code: 400,
        message: '当前已绑定该学院，无需重复申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (pendingRequest) {
      return {
        code: 409,
        message: '您已有待处理的学院变更申请，请勿重复提交',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const request = await this.prisma.change_requests.create({
      data: {
        requester_user_id: userId,
        target_type: 'teacher_org_change',
        target_id: userId,
        reason,
        status: CHANGE_REQUEST_STATUS.PENDING_DEAN,
        change_json: {
          request_type: 'teacher_org_change',
          workflow_stage: 'vice_dean_review',
          teacher_name: user.name,
          current_org_id: user.org_id?.toString() || null,
          current_org_name: user.orgs?.name || '',
          target_org_id: targetOrg.id.toString(),
          target_org_name: targetOrg.name,
          evidence_file_id: evidenceFileIds[0]?.toString() || null,
          evidence_file_ids: evidenceFileIds.map((item) => item.toString()),
        } as any,
      },
    });

    return {
      code: 0,
      message: '学院变更申请已提交，等待教学副院长审批',
      data: { id: request.id.toString() },
      trace_id: req.trace_id,
    };
  }
}

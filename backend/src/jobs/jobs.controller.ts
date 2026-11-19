import { Controller, Post, Body, Req, UseGuards, Get, Logger } from '@nestjs/common';
import { AttendanceSchedulerService } from '../scheduler/attendance-scheduler.service';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';
import { AuthGuard } from '../shared/auth.guard';
import { RolesGuard, Roles } from '../shared/roles.guard';
import { WarningService } from '../warning/warning.service';
import { WarningQueueService } from '../warning/warning-queue.service';
import { SummaryService } from '../warning/summary.service';
import { markSessionSettled } from '../attendance/attendance.utils';

class RunDailyWarningDto {
  date?: string;
}

class ReconcileRecentWarningsDto {
  days?: number;
}

class RebuildSummariesDto {
  /** 学期编码；不传则用 grades 中最新的学期 */
  term_code?: string;
  /** 参考日期（YYYY-MM-DD）；不传则周=本周、月=本月 */
  reference_date?: string;
}

@Controller('jobs')
@UseGuards(AuthGuard, RolesGuard)
export class JobsController {
  private readonly logger = new Logger(JobsController.name);
  private readonly sessionSettledTtlSeconds = 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly warningService: WarningService,
    private readonly warningQueueService: WarningQueueService,
    private readonly attendanceSchedulerService: AttendanceSchedulerService,
    private readonly summaryService: SummaryService,
  ) {}

  /**
   * 手工重算三张汇总表（周/月/学期）。
   * 联调、补跑历史、以及成绩导入后立即刷新学期汇总都靠它。
   */
  @Post('rebuild_summaries')
  @Roles('sys_admin', 'student_admin', 'teaching_admin')
  async rebuildSummaries(@Body() dto: RebuildSummariesDto, @Req() req: any) {
    let referenceDate: Date | undefined;
    if (dto?.reference_date) {
      const parsed = new Date(dto.reference_date);
      if (Number.isNaN(parsed.getTime())) {
        return {
          code: 400,
          message: 'reference_date 格式非法，应为 YYYY-MM-DD',
          data: null,
          trace_id: req.trace_id,
        };
      }
      referenceDate = parsed;
    }

    const data = await this.summaryService.rebuildAll({
      termCode: dto?.term_code,
      referenceDate,
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('scan-status')
  @Roles('sys_admin', 'student_admin', 'head_teacher', 'teaching_admin')
  async getScanStatus(@Req() req: any) {
    const status = this.attendanceSchedulerService.getScanStatus();
    return {
      code: 0,
      message: 'ok',
      data: {
        interval_minutes: status.intervalMinutes,
        next_scan_at: status.nextScanAt?.toISOString() || null,
        warning_queue: status.queue || null,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('process_and_generate_warnings')
  @Roles('sys_admin', 'student_admin', 'teaching_admin')
  async processAndGenerateWarnings(@Req() req: any) {
    const result = await this.attendanceSchedulerService.processEndedSessionsNow();
    if (!result) {
      return {
        code: 409,
        message: '签到扫描正在运行，请稍后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return {
      code: 0,
      message: '处理完成',
      data: {
        sessions_processed: result.sessions_processed,
        absent_records_generated: result.absent_records_generated,
        warnings_mode: 'async_queue',
      },
      trace_id: req.trace_id,
    };
  }

  @Post('run_daily_warning')
  @Roles('sys_admin', 'student_admin', 'teaching_admin')
  async runDailyWarning(@Body() dto: RunDailyWarningDto, @Req() req: any) {
    const result = await this.warningService.runDailyWarning(dto.date);
    return {
      code: 0,
      message: '处理完成',
      data: {
        date: result.date,
        rules_processed: result.rules_processed,
        warnings_generated: result.warnings_generated,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('rescan_all_violations')
  @Roles('sys_admin')
  async rescanAllViolations(@Req() req: any) {
    const result = await this.warningService.rescanAllViolations();
    return {
      code: 0,
      message: '重新扫描完成',
      data: {
        rules_processed: result.rules_processed,
        warnings_generated: result.warnings_generated,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('reconcile_recent_warnings')
  @Roles('sys_admin')
  async reconcileRecentWarnings(@Body() dto: ReconcileRecentWarningsDto, @Req() req: any) {
    const result = await this.warningService.reconcileRecentWarnings(dto.days);
    let warningQueueMode = 'skipped';
    let warningsEnqueued = 0;
    let warningsDeduped = 0;
    const remainingTargets = Array.isArray((result as any)?.remaining_locked_targets)
      ? ((result as any).remaining_locked_targets as Array<{
          studentId: bigint;
          recordDate: Date;
          courseId?: bigint;
          sessionId?: bigint;
        }>)
      : [];

    if (remainingTargets.length > 0) {
      const queueResult = await this.warningQueueService.scheduleAffectedRecords(
        remainingTargets,
        'jobs.reconcile_recent_warnings.locked_retry',
      );
      warningQueueMode = String(queueResult?.mode || 'queued');
      warningsEnqueued = Number(queueResult?.warnings_enqueued || 0);
      warningsDeduped = Number(queueResult?.warnings_deduped || 0);
    }

    return {
      code: 0,
      message: '近期待账修复完成',
      data: {
        ...result,
        warning_queue_mode: warningQueueMode,
        warnings_enqueued: warningsEnqueued,
        warnings_deduped: warningsDeduped,
      },
      trace_id: req.trace_id,
    };
  }

  @Post('process_ended_sessions')
  @Roles('sys_admin', 'student_admin', 'teaching_admin')
  async processEndedSessions(@Req() req: any) {
    const result = await this.attendanceSchedulerService.processEndedSessionsNow();
    if (!result) {
      return {
        code: 409,
        message: '签到扫描正在运行，请稍后再试',
        data: null,
        trace_id: req.trace_id,
      };
    }
    return {
      code: 0,
      message: '处理完成',
      data: {
        sessions_processed: result.sessions_processed,
        absent_records_generated: result.absent_records_generated,
        warnings_mode: 'async_queue',
      },
      trace_id: req.trace_id,
    };
  }

  private async processWarningTargetsImmediately(
    targets: Array<{
      studentId: bigint;
      recordDate: Date;
      courseId?: bigint;
      sessionId?: bigint;
    }>,
    source: string,
  ) {
    if (targets.length === 0) {
      return {
        warnings_generated: 0,
        warnings_enqueued: 0,
        warnings_deduped: 0,
        warning_queue_mode: 'skipped',
        targets_locked: 0,
        can_settle: true,
      };
    }

    try {
      const syncResult = await this.warningService.generateWarningsForAffectedRecordsSync(targets);
      const lockedTargets = Number(syncResult?.targets_locked || 0);

      if (lockedTargets > 0) {
        this.logger.warn(`同步预警重算仍有 ${lockedTargets} 个目标被锁占用，本次暂不标记 settled`);
        return {
          warnings_generated: Number(syncResult?.warnings_generated || 0),
          warnings_enqueued: 0,
          warnings_deduped: 0,
          warning_queue_mode: 'sync_partial_locked',
          targets_locked: lockedTargets,
          can_settle: false,
        };
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
      this.logger.warn(`同步生成预警失败，降级为入队重试: ${error?.message || error}`);

      try {
        const queueResult = await this.warningQueueService.scheduleAffectedRecords(targets, source);
        const lockedTargets = Number(queueResult?.targets_locked || 0);
        const canSettle = queueResult?.mode === 'sync_fallback' && lockedTargets === 0;

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
          '预警恢复链路也失败',
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

  private async processEndedSessionsInternal() {
    const now = new Date();
    let processedCount = 0;
    let absentCount = 0;
    let warningsGenerated = 0;
    let warningsEnqueued = 0;
    let warningsDeduped = 0;
    let warningQueueMode = 'skipped';
    const affectedRecords = new Map<
      string,
      {
        studentId: bigint;
        recordDate: Date;
        courseId?: bigint;
        sessionId?: bigint;
      }
    >();
    const sessionsToSettle = new Set<string>();
    const sessionsPendingWarningSettlement = new Set<string>();

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

    for (const session of endedSessions) {
      const students = session.classes?.student_profiles || [];
      if (students.length === 0) {
        await this.prisma.class_sessions.update({
          where: { id: session.id },
          data: { status: 'ended' },
        });
        sessionsToSettle.add(session.id.toString());
        processedCount += 1;
        continue;
      }

      const sessionStudentIds = students.map((student) => student.id);
      const existingRecords = await this.prisma.attendance_records.findMany({
        where: {
          session_id: session.id,
          student_id: { in: sessionStudentIds },
        },
        select: {
          student_id: true,
        },
      });
      const existingStudentIdSet = new Set(existingRecords.map((record) => record.student_id.toString()));

      const missingStudents = students.filter(
        (student) => !existingStudentIdSet.has(student.id.toString()),
      );

      if (missingStudents.length === 0) {
        await this.prisma.class_sessions.update({
          where: { id: session.id },
          data: { status: 'ended' },
        });
        sessionsToSettle.add(session.id.toString());
        processedCount += 1;
        continue;
      }

      const recordDate = new Date(
        Date.UTC(
          session.session_start.getFullYear(),
          session.session_start.getMonth(),
          session.session_start.getDate(),
        ),
      );

      const attendanceCreateData = missingStudents.map((student) => ({
        session_id: session.id,
        student_id: student.id,
        checkin_time: session.session_end || session.qr_expire_at,
        attendance_status: 'absent',
        source: 'system',
      }));

      if (attendanceCreateData.length > 0) {
        await this.prisma.attendance_records.createMany({
          data: attendanceCreateData,
          skipDuplicates: true,
        });
      }

      for (const student of missingStudents) {
        await this.prisma.daily_records.upsert({
          where: {
            student_id_record_date_course_id: {
              student_id: student.id,
              record_date: recordDate,
              course_id: session.course_id,
            },
          },
          update: {
            attendance_status: 'absent',
            source: 'system',
          },
          create: {
            student_id: student.id,
            record_date: recordDate,
            class_id: session.class_id,
            org_id: student.org_id || BigInt(0),
            course_id: session.course_id,
            attendance_status: 'absent',
            homework_status: 'unknown',
            source: 'system',
            approved_status: 'approved',
          },
        });

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

      absentCount += missingStudents.length;

      await this.prisma.class_sessions.update({
        where: { id: session.id },
        data: { status: 'ended' },
      });
      sessionsPendingWarningSettlement.add(session.id.toString());
      processedCount += 1;
    }

    if (affectedRecords.size > 0) {
      const warningResult = await this.processWarningTargetsImmediately(
        Array.from(affectedRecords.values()),
        'jobs.process_ended_sessions',
      );
      warningsGenerated = warningResult.warnings_generated;
      warningsEnqueued = warningResult.warnings_enqueued;
      warningsDeduped = warningResult.warnings_deduped;
      warningQueueMode = warningResult.warning_queue_mode;

      if (warningResult.can_settle) {
        sessionsPendingWarningSettlement.forEach((sessionId) => {
          sessionsToSettle.add(sessionId);
        });
      }
    } else {
      warningsGenerated = 0;
      warningsEnqueued = 0;
      warningsDeduped = 0;
      warningQueueMode = 'skipped';
    }

    await Promise.all(
      Array.from(sessionsToSettle).map((sessionId) =>
        markSessionSettled(this.redis, sessionId, this.sessionSettledTtlSeconds, this.logger),
      ),
    );

    return {
      sessions_processed: processedCount,
      absent_records_generated: absentCount,
      warnings_generated: warningsGenerated,
      warnings_enqueued: warningsEnqueued,
      warnings_deduped: warningsDeduped,
      warning_queue_mode: warningQueueMode,
    };
  }
}

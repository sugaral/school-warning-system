import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = 'Asia/Shanghai';
const ABNORMAL_ATTENDANCE_STATUSES = ['late', 'absent', 'early_leave'];
const ACTIVE_WARNING_STATUSES = ['open', 'acknowledged'];
type WarningSummarySnapshot = {
  activeWarningCount: number;
  closedWarningCount: number;
  allWarningCount: number;
  activeHighestLevel: string;
  closedHighestLevel: string;
  allHighestLevel: string;
  activeLastWarningAt: Date | null;
  closedLastWarningAt: Date | null;
  allLastWarningAt: Date | null;
};

type AbnormalSummarySnapshot = {
  todayCount: number;
  weekCount: number;
  monthCount: number;
};

@Injectable()
export class WarningSnapshotService {
  private readonly logger = new Logger(WarningSnapshotService.name);
  private readonly classViewCacheTtlSeconds = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async buildClassViewStudentsCacheKey(
    userId: bigint,
    classId: bigint,
    scope: string,
    keyword: string,
    page = 1,
    pageSize = 50,
  ) {
    return [
      'warnings:class-view:students:v4',
      `user:${userId.toString()}`,
      `class:${classId.toString()}`,
      `scope:${String(scope || 'all').trim().toLowerCase() || 'all'}`,
      `keyword:${encodeURIComponent(String(keyword || '').trim().toLowerCase())}`,
      `page:${Math.max(1, Number(page) || 1)}`,
      `size:${Math.max(1, Number(pageSize) || 50)}`,
    ].join(':');
  }

  async buildClassViewStudentDetailCacheKey(
    userId: bigint,
    studentId: bigint,
    scope: string,
    view: string,
  ) {
    return [
      'warnings:class-view:detail:v4',
      `user:${userId.toString()}`,
      `student:${studentId.toString()}`,
      `scope:${String(scope || 'all').trim().toLowerCase() || 'all'}`,
      `view:${String(view || 'day').trim().toLowerCase() || 'day'}`,
    ].join(':');
  }

  private logCacheResult(kind: string, key: string, hit: boolean, startedAt: number) {
    this.logger.log(
      `[预警缓存] ${kind} ${hit ? '命中' : '未命中'} 耗时=${Date.now() - startedAt}ms key=${key}`,
    );
  }

  async getCachedClassViewStudents(_key: string) {
    return null;
  }

  async setCachedClassViewStudents(_key: string, _value: any) {
    return;
  }

  async getCachedClassViewStudentDetail(_key: string) {
    return null;
  }

  async setCachedClassViewStudentDetail(_key: string, _value: any) {
    return;
  }

  async invalidateStudents(
    studentIdsInput: Array<bigint | string | number | null | undefined>,
    classIdsInput: Array<bigint | string | number | null | undefined> = [],
  ) {
    const studentIds = this.uniqueBigInts(studentIdsInput);
    const classIds = this.uniqueBigInts(classIdsInput);

    this.logger.log(
      `[预警快照] invalidate skipped students=${studentIds.length} classes=${classIds.length} reason=class-view-cache-disabled`,
    );
  }

  async refreshStudents(values: Array<bigint | string | number | null | undefined>) {
    const startedAt = Date.now();
    const studentIds = this.uniqueBigInts(values);
    if (studentIds.length === 0) {
      return;
    }

    const studentsQueryStartedAt = Date.now();
    const students = await this.prisma.student_profiles.findMany({
      where: {
        id: { in: studentIds },
      },
      select: {
        id: true,
        class_id: true,
        org_id: true,
      },
    });
    const studentsQueryCost = Date.now() - studentsQueryStartedAt;

    const periods = this.getCurrentPeriods();
    const abnormalStart = dayjs(periods.weekStart).isBefore(dayjs(periods.monthStart))
      ? periods.weekStart
      : periods.monthStart;

    const summaryQueryStartedAt = Date.now();
    const [activeWarnings, warningHistory, abnormalRecords] = await Promise.all([
      (this.prisma as any).warning_current_states.findMany({
        where: {
          student_id: { in: studentIds },
          status: { in: ACTIVE_WARNING_STATUSES },
          metric: { not: 'warning_total' },
        },
        select: {
          student_id: true,
          metric: true,
          level: true,
          status: true,
          updated_at: true,
          course_key: true,
          course_id: true,
          trigger_detail_json: true,
        },
      }),
      this.prisma.warnings.findMany({
        where: {
          student_id: { in: studentIds },
          status: 'closed',
          metric: { not: 'warning_total' },
        },
        select: {
          student_id: true,
          metric: true,
          level: true,
          status: true,
          created_at: true,
        },
      }),
      this.prisma.attendance_records.findMany({
        where: {
          student_id: { in: studentIds },
          attendance_status: { in: ABNORMAL_ATTENDANCE_STATUSES },
          sessions: {
            session_start: {
              gte: abnormalStart,
              lte: new Date(),
            },
          },
        },
        select: {
          student_id: true,
          sessions: {
            select: {
              session_start: true,
            },
          },
        },
      }),
    ]);
    const summaryQueryCost = Date.now() - summaryQueryStartedAt;

    const warningSummaryMap = this.buildWarningSummaryMap(activeWarnings, warningHistory);
    const abnormalSummaryMap = this.buildAbnormalSummaryMap(abnormalRecords, periods);
    const rows = students.map((student: any) => {
      const warningSummary = warningSummaryMap.get(student.id.toString()) || {
        activeWarningCount: 0,
        closedWarningCount: 0,
        allWarningCount: 0,
        activeHighestLevel: '',
        closedHighestLevel: '',
        allHighestLevel: '',
        activeLastWarningAt: null,
        closedLastWarningAt: null,
        allLastWarningAt: null,
      };
      const abnormalSummary = abnormalSummaryMap.get(student.id.toString()) || {
        todayCount: 0,
        weekCount: 0,
        monthCount: 0,
      };

      return {
        student_id: student.id,
        class_id: student.class_id,
        org_id: student.org_id || 0n,
        today_warning_total: abnormalSummary.todayCount,
        week_warning_total: abnormalSummary.weekCount,
        month_warning_total: abnormalSummary.monthCount,
        active_warning_count: warningSummary.activeWarningCount,
        closed_warning_count: warningSummary.closedWarningCount,
        all_warning_count: warningSummary.allWarningCount,
        active_highest_level: warningSummary.activeHighestLevel || null,
        closed_highest_level: warningSummary.closedHighestLevel || null,
        all_highest_level: warningSummary.allHighestLevel || null,
        active_last_warning_at: warningSummary.activeLastWarningAt,
        closed_last_warning_at: warningSummary.closedLastWarningAt,
        all_last_warning_at: warningSummary.allLastWarningAt,
      };
    });

    const upsertStartedAt = Date.now();
    if (rows.length > 0) {
      const columns = [
        'student_id', 'class_id', 'org_id',
        'today_warning_total', 'week_warning_total', 'month_warning_total',
        'active_warning_count', 'closed_warning_count', 'all_warning_count',
        'active_highest_level', 'closed_highest_level', 'all_highest_level',
        'active_last_warning_at', 'closed_last_warning_at', 'all_last_warning_at', 'updated_at',
      ] as const;
      const now = new Date();
      const paramPlaceholders = rows
        .map(() => `(${columns.map(() => '?').join(', ')})`)
        .join(', ');
      const params: any[] = rows.flatMap((row: any) => [
        row.student_id, row.class_id, row.org_id,
        row.today_warning_total, row.week_warning_total, row.month_warning_total,
        row.active_warning_count, row.closed_warning_count, row.all_warning_count,
        row.active_highest_level, row.closed_highest_level, row.all_highest_level,
        row.active_last_warning_at, row.closed_last_warning_at, row.all_last_warning_at, now,
      ]);
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO student_warning_snapshots (${columns.join(', ')})
         VALUES ${paramPlaceholders}
         AS new
         ON DUPLICATE KEY UPDATE
           class_id = new.class_id,
           org_id = new.org_id,
           today_warning_total = new.today_warning_total,
           week_warning_total = new.week_warning_total,
           month_warning_total = new.month_warning_total,
           active_warning_count = new.active_warning_count,
           closed_warning_count = new.closed_warning_count,
           all_warning_count = new.all_warning_count,
           active_highest_level = new.active_highest_level,
           closed_highest_level = new.closed_highest_level,
           all_highest_level = new.all_highest_level,
           active_last_warning_at = new.active_last_warning_at,
           closed_last_warning_at = new.closed_last_warning_at,
           all_last_warning_at = new.all_last_warning_at,
           updated_at = new.updated_at`,
        ...params,
      );
    }
    const upsertCost = Date.now() - upsertStartedAt;

    const invalidateStartedAt = Date.now();
    await this.invalidateStudents(
      studentIds,
      students.map((student: any) => student.class_id),
    );
    const invalidateCost = Date.now() - invalidateStartedAt;

    this.logger.log(
      `[预警快照] refresh students=${studentIds.length} studentMs=${studentsQueryCost} summaryMs=${summaryQueryCost} upsertMs=${upsertCost} invalidateMs=${invalidateCost} cost=${Date.now() - startedAt}ms`,
    );
  }

  async getOrRefreshStudentSnapshots(studentIdsInput: Array<bigint | string | number | null | undefined>) {
    const startedAt = Date.now();
    const studentIds = this.uniqueBigInts(studentIdsInput);
    if (studentIds.length === 0) {
      return new Map<string, any>();
    }

    let snapshots = await (this.prisma as any).student_warning_snapshots.findMany({
      where: {
        student_id: { in: studentIds },
      },
    });
    const snapshotMap = new Map(
      snapshots.map((item: any) => [item.student_id.toString(), item]),
    );
    const missingIds = studentIds.filter((studentId) => !snapshotMap.has(studentId.toString()));

    if (missingIds.length > 0) {
      this.logger.log(
        `[预警快照] miss students=${studentIds.length} missing=${missingIds.length} cost=${Date.now() - startedAt}ms`,
      );
      await this.refreshStudents(missingIds);
      snapshots = await (this.prisma as any).student_warning_snapshots.findMany({
        where: {
          student_id: { in: studentIds },
        },
      });
    } else {
      this.logger.log(
        `[预警快照] hit students=${studentIds.length} cost=${Date.now() - startedAt}ms`,
      );
    }

    return new Map(
      snapshots.map((item: any) => [item.student_id.toString(), item]),
    );
  }

  private uniqueBigInts(values: Array<bigint | string | number | null | undefined>) {
    const map = new Map<string, bigint>();
    for (const value of values) {
      if (value === null || value === undefined || value === '') {
        continue;
      }
      try {
        const bigintValue = BigInt(value as any);
        map.set(bigintValue.toString(), bigintValue);
      } catch {
        this.logger.warn(`跳过无效的 bigint 快照值：${String(value)}`);
      }
    }
    return Array.from(map.values());
  }

  private getCurrentPeriods() {
    const now = dayjs().tz(DEFAULT_TZ);
    const weekday = now.day() === 0 ? 7 : now.day();
    const weekStart = now.subtract(weekday - 1, 'day').startOf('day');

    return {
      todayStart: now.startOf('day').toDate(),
      todayEnd: now.endOf('day').toDate(),
      weekStart: weekStart.toDate(),
      weekEnd: weekStart.add(6, 'day').endOf('day').toDate(),
      monthStart: now.startOf('month').toDate(),
      monthEnd: now.endOf('month').toDate(),
    };
  }

  private buildWarningSummaryMap(activeWarnings: any[], warningHistory: any[]) {
    const map = new Map<string, WarningSummarySnapshot>();
    const levelWeight: Record<string, number> = {
      yellow: 1,
      orange: 2,
      red: 3,
      severe: 4,
    };
    const activeCourseSets = new Map<string, Set<string>>();

    activeWarnings.forEach((warning: any) => {
      const key = warning.student_id.toString();
      const current = map.get(key) || {
        activeWarningCount: 0,
        closedWarningCount: 0,
        allWarningCount: 0,
        activeHighestLevel: '',
        closedHighestLevel: '',
        allHighestLevel: '',
        activeLastWarningAt: null,
        closedLastWarningAt: null,
        allLastWarningAt: null,
      };
      const metric = String(warning.metric || '').trim();
      const status = String(warning.status || '').trim();
      const createdAt = warning.updated_at ? new Date(warning.updated_at) : null;

      if (metric === 'warning_total') {
        map.set(key, current);
        return;
      }

      if (ACTIVE_WARNING_STATUSES.includes(status)) {
        const detail = (warning.trigger_detail_json as Record<string, any>) || {};
        const courseKey =
          String(warning.course_key || '').trim() ||
          (detail.course_id ? String(detail.course_id).trim() : '__none__');
        const seenCourseKeys = activeCourseSets.get(key) || new Set<string>();
        if (!seenCourseKeys.has(courseKey)) {
          current.activeWarningCount += 1;
          seenCourseKeys.add(courseKey);
          activeCourseSets.set(key, seenCourseKeys);
        }
      }
      if (status === 'closed') {
        current.closedWarningCount += 1;
      }
      current.allWarningCount += 1;

      if (ACTIVE_WARNING_STATUSES.includes(status)) {
        if ((levelWeight[warning.level] || 0) > (levelWeight[current.activeHighestLevel] || 0)) {
          current.activeHighestLevel = warning.level;
        }
        if (
          createdAt &&
          (!current.activeLastWarningAt || createdAt.getTime() > current.activeLastWarningAt.getTime())
        ) {
          current.activeLastWarningAt = createdAt;
        }
      }

      if (status === 'closed') {
        if ((levelWeight[warning.level] || 0) > (levelWeight[current.closedHighestLevel] || 0)) {
          current.closedHighestLevel = warning.level;
        }
        if (
          createdAt &&
          (!current.closedLastWarningAt || createdAt.getTime() > current.closedLastWarningAt.getTime())
        ) {
          current.closedLastWarningAt = createdAt;
        }
      }

      if ((levelWeight[warning.level] || 0) > (levelWeight[current.allHighestLevel] || 0)) {
        current.allHighestLevel = warning.level;
      }
      if (
        createdAt &&
        (!current.allLastWarningAt || createdAt.getTime() > current.allLastWarningAt.getTime())
      ) {
        current.allLastWarningAt = createdAt;
      }

      map.set(key, current);
    });

    warningHistory.forEach((warning: any) => {
      const key = warning.student_id.toString();
      const current = map.get(key) || {
        activeWarningCount: 0,
        closedWarningCount: 0,
        allWarningCount: 0,
        activeHighestLevel: '',
        closedHighestLevel: '',
        allHighestLevel: '',
        activeLastWarningAt: null,
        closedLastWarningAt: null,
        allLastWarningAt: null,
      };
      const metric = String(warning.metric || '').trim();
      const status = String(warning.status || '').trim();
      const createdAt = warning.created_at ? new Date(warning.created_at) : null;

      if (metric === 'warning_total' || status !== 'closed') {
        map.set(key, current);
        return;
      }

      current.closedWarningCount += 1;
      if ((levelWeight[warning.level] || 0) > (levelWeight[current.closedHighestLevel] || 0)) {
        current.closedHighestLevel = warning.level;
      }
      if (
        createdAt &&
        (!current.closedLastWarningAt || createdAt.getTime() > current.closedLastWarningAt.getTime())
      ) {
        current.closedLastWarningAt = createdAt;
      }

      current.allWarningCount += 1;
      if ((levelWeight[warning.level] || 0) > (levelWeight[current.allHighestLevel] || 0)) {
        current.allHighestLevel = warning.level;
      }
      if (
        createdAt &&
        (!current.allLastWarningAt || createdAt.getTime() > current.allLastWarningAt.getTime())
      ) {
        current.allLastWarningAt = createdAt;
      }

      map.set(key, current);
    });

    return map;
  }

  private buildAbnormalSummaryMap(records: any[], periods: ReturnType<WarningSnapshotService['getCurrentPeriods']>) {
    const map = new Map<string, AbnormalSummarySnapshot>();

    records.forEach((record: any) => {
      const key = record.student_id.toString();
      const current = map.get(key) || {
        todayCount: 0,
        weekCount: 0,
        monthCount: 0,
      };
      const sessionTime = new Date(record.sessions?.session_start);

      if (sessionTime >= periods.todayStart && sessionTime <= periods.todayEnd) {
        current.todayCount += 1;
      }
      if (sessionTime >= periods.weekStart && sessionTime <= periods.weekEnd) {
        current.weekCount += 1;
      }
      if (sessionTime >= periods.monthStart && sessionTime <= periods.monthEnd) {
        current.monthCount += 1;
      }

      map.set(key, current);
    });

    return map;
  }
}

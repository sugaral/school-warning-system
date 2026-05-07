import * as fs from 'fs';
import * as path from 'path';
import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { ConfigService } from '../config/config.service';
import {
  getAcademicWeekInfo,
  getAcademicWeekInfoByNumber,
  resolveSemesterStartDate,
} from '../shared/academic-calendar.util';

dayjs.extend(utc);
dayjs.extend(timezone);

const REPORT_TZ = 'Asia/Shanghai';

type ReportScope = {
  type: 'all' | 'limited' | 'none';
  orgIds: bigint[];
  classIds: bigint[];
  studentIds: bigint[];
};

type ReportRange = {
  start: Date;
  endExclusive: Date;
  startLabel: string;
  endLabel: string;
  monthLabel?: string;
  semesterLabel?: string;
  weekNumber?: number;
  weekLabel?: string;
};

@Controller('admin/reports')
@UseGuards(AuthGuard, PermissionGuard)
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('ReportsController');
  }

  private logError(error: any, context: string) {
    const errorMsg = `[${new Date().toISOString()}] Error in ${context}: ${error.message}\n${error.stack}\n\n`;
    this.logger.error({ context, err: error }, `${context} 中发生错误: ${error.message}`);
    try {
      fs.appendFileSync(path.join(process.cwd(), 'error.log'), errorMsg);
    } catch (writeError) {
      this.logger.error({ err: writeError }, '写入 error.log 失败');
    }
  }

  private getRequestUserId(req: any) {
    return BigInt(req.user?.sub || req.user?.userId || req.user?.id);
  }

  private uniqueBigInts(values: Array<bigint | null | undefined>) {
    const map = new Map<string, bigint>();
    for (const value of values) {
      if (!value) {
        continue;
      }
      map.set(value.toString(), value);
    }
    return Array.from(map.values());
  }

  private normalizeStatus(status?: string) {
    const normalized = String(status || '').trim();
    if (!normalized || normalized === 'all' || normalized === 'undefined') {
      return undefined;
    }
    return normalized;
  }

  private async resolveReportScope(userId: bigint): Promise<ReportScope> {
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: {
        role: true,
        scope_type: true,
        scope_id: true,
      },
    });

    if (userRoles.length === 0) {
      return {
        type: 'none',
        orgIds: [],
        classIds: [],
        studentIds: [],
      };
    }

    const hasAllScope = userRoles.some(
      (role) =>
        role.role === 'sys_admin' ||
        role.scope_type === 'system' ||
        role.scope_type === 'school',
    );
    if (hasAllScope) {
      return {
        type: 'all',
        orgIds: [],
        classIds: [],
        studentIds: [],
      };
    }

    const orgIds: bigint[] = [];
    const classIds: bigint[] = [];
    let needsSelfScope = false;

    for (const role of userRoles) {
      if ((role.scope_type === 'org' || role.scope_type === 'college') && role.scope_id) {
        orgIds.push(role.scope_id);
        continue;
      }

      if (role.scope_type === 'class' && role.scope_id) {
        classIds.push(role.scope_id);
        continue;
      }

      if (role.scope_type === 'self') {
        needsSelfScope = true;
      }
    }

    const studentIds: bigint[] = [];
    if (needsSelfScope) {
      const studentProfile = await this.prisma.student_profiles.findUnique({
        where: { user_id: userId },
        select: { id: true },
      });
      if (studentProfile?.id) {
        studentIds.push(studentProfile.id);
      }
    }

    const scopedOrgIds = this.uniqueBigInts(orgIds);
    const scopedClassIds = this.uniqueBigInts(classIds);
    const scopedStudentIds = this.uniqueBigInts(studentIds);

    if (
      scopedOrgIds.length === 0 &&
      scopedClassIds.length === 0 &&
      scopedStudentIds.length === 0
    ) {
      return {
        type: 'none',
        orgIds: [],
        classIds: [],
        studentIds: [],
      };
    }

    return {
      type: 'limited',
      orgIds: scopedOrgIds,
      classIds: scopedClassIds,
      studentIds: scopedStudentIds,
    };
  }

  private getScopeMeta(scope: ReportScope) {
    if (scope.type === 'all') {
      return { scopeType: 'school', scopeId: null as bigint | null };
    }

    if (scope.orgIds.length === 1 && scope.classIds.length === 0 && scope.studentIds.length === 0) {
      return { scopeType: 'org', scopeId: scope.orgIds[0] };
    }

    if (scope.classIds.length === 1 && scope.orgIds.length === 0 && scope.studentIds.length === 0) {
      return { scopeType: 'class', scopeId: scope.classIds[0] };
    }

    if (scope.studentIds.length === 1 && scope.orgIds.length === 0 && scope.classIds.length === 0) {
      return { scopeType: 'self', scopeId: scope.studentIds[0] };
    }

    return { scopeType: 'mixed', scopeId: null as bigint | null };
  }

  private async createExportJob(
    userId: bigint,
    type: string,
    params: any,
    scope: ReportScope,
  ) {
    const scopeMeta = this.getScopeMeta(scope);
    return this.prisma.export_jobs.create({
      data: {
        creator_user_id: userId,
        scope_type: scopeMeta.scopeType,
        scope_id: scopeMeta.scopeId,
        report_type: type,
        params_json: params,
        status: 'completed',
        updated_at: new Date(),
      },
    });
  }

  private buildWarningWhere(
    range: ReportRange,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    if (scope.type === 'none') {
      return null;
    }

    const baseWhere: any = {
      created_at: {
        gte: range.start,
        lt: range.endExclusive,
      },
    };

    if (status) {
      baseWhere.status = status;
    }

    if (selectedOrgId) {
      if (
        scope.type !== 'all' &&
        scope.orgIds.length > 0 &&
        !scope.orgIds.some((item) => item.toString() === selectedOrgId.toString())
      ) {
        return null;
      }
      baseWhere.org_id = selectedOrgId;
    }

    if (scope.type === 'all') {
      return baseWhere;
    }

    const scopeOr: any[] = [];
    if (scope.orgIds.length > 0) {
      scopeOr.push({ org_id: { in: scope.orgIds } });
    }
    if (scope.classIds.length > 0) {
      scopeOr.push({ class_id: { in: scope.classIds } });
    }
    if (scope.studentIds.length > 0) {
      scopeOr.push({ student_id: { in: scope.studentIds } });
    }

    if (scopeOr.length === 0) {
      return null;
    }

    return {
      AND: [baseWhere, { OR: scopeOr }],
    };
  }

  private buildOverviewCacheKey(
    userId: bigint,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    return JSON.stringify({
      userId: userId.toString(),
      status: status || '',
      selectedOrgId: selectedOrgId ? selectedOrgId.toString() : '',
      scopeType: scope.type,
      orgIds: scope.orgIds.map((item) => item.toString()).sort(),
      classIds: scope.classIds.map((item) => item.toString()).sort(),
      studentIds: scope.studentIds.map((item) => item.toString()).sort(),
    });
  }

  private async findWarningsForReport(
    range: ReportRange,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    const where = this.buildWarningWhere(range, status, scope, selectedOrgId);
    if (!where) {
      return [];
    }

    return this.prisma.warnings.findMany({
      where,
      select: {
        id: true,
        student_id: true,
        org_id: true,
        level: true,
        metric: true,
        window: true,
        period_start: true,
        period_end: true,
        trigger_summary: true,
        trigger_detail_json: true,
        status: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  private async buildWarningContext(warnings: any[]) {
    const studentIds = this.uniqueBigInts(
      warnings.map((warning: { student_id: bigint }) => warning.student_id),
    );

    if (studentIds.length === 0) {
      return new Map<string, any>();
    }

    const students = await this.prisma.student_profiles.findMany({
      where: { id: { in: studentIds } },
      select: {
        id: true,
        student_no: true,
        users: {
          select: {
            name: true,
          },
        },
        classes: {
          select: {
            class_name: true,
            orgs: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return new Map(students.map((student: any) => [student.id.toString(), student]));
  }

  private dedupeWarnings(warnings: any[]) {
    const dedupMap = new Map<string, any>();

    const sortedWarnings = [...warnings].sort((left, right) => {
      const createdAtDiff =
        new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }

      const leftId = BigInt(left.id || 0);
      const rightId = BigInt(right.id || 0);
      if (leftId === rightId) {
        return 0;
      }
      return rightId > leftId ? 1 : -1;
    });

    for (const warning of sortedWarnings) {
      const detail = (warning.trigger_detail_json as Record<string, any>) || {};
      const triggerAt =
        detail.triggered_at || detail.session_start || detail.latest_session_start || warning.created_at;
      const key = [
        warning.student_id?.toString?.() || '',
        warning.metric || '',
        warning.window || '',
        dayjs(warning.period_start).tz(REPORT_TZ).format('YYYY-MM-DD'),
        dayjs(warning.period_end).tz(REPORT_TZ).format('YYYY-MM-DD'),
        detail.course_id ? String(detail.course_id) : '',
        detail.session_id ? String(detail.session_id) : '',
        dayjs(triggerAt).utc().millisecond(0).format('YYYY-MM-DDTHH:mm:ss[Z]'),
      ].join('_');

      if (!dedupMap.has(key)) {
        dedupMap.set(key, warning);
      }
    }

    return Array.from(dedupMap.values());
  }

  private escapeCsvCell(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private getDefaultSemester() {
    const now = dayjs().tz(REPORT_TZ);
    const month = now.month() + 1;
    const year = now.year();

    if (month >= 8) {
      return `${year}-${year + 1}-1`;
    }

    if (month >= 2) {
      return `${year - 1}-${year}-2`;
    }

    return `${year - 1}-${year}-1`;
  }

  private getDailyRange(reportDate?: string): ReportRange {
    const start = reportDate
      ? dayjs.tz(reportDate, REPORT_TZ).startOf('day')
      : dayjs().tz(REPORT_TZ).startOf('day');

    return {
      start: start.toDate(),
      endExclusive: start.add(1, 'day').toDate(),
      startLabel: start.format('YYYY-MM-DD'),
      endLabel: start.format('YYYY-MM-DD'),
    };
  }

  private async getSemesterStartDate(referenceDate?: string) {
    const teachingConfig = await this.configService.getSectionConfig('teaching', {});
    const reference = referenceDate
      ? dayjs.tz(referenceDate, REPORT_TZ).toDate()
      : new Date();
    return resolveSemesterStartDate(teachingConfig?.semesterStartDate, reference);
  }

  private async getWeeklyRange(
    startDate?: string,
    weekNumber?: string | number,
  ): Promise<ReportRange> {
    const anchor = startDate
      ? dayjs.tz(startDate, REPORT_TZ).startOf('day').toDate()
      : dayjs().tz(REPORT_TZ).startOf('day').toDate();
    const semesterStart = await this.getSemesterStartDate(startDate);
    const normalizedWeekNumber = Number(weekNumber);
    const weekInfo =
      Number.isFinite(normalizedWeekNumber) && normalizedWeekNumber > 0
        ? getAcademicWeekInfoByNumber(normalizedWeekNumber, semesterStart)
        : getAcademicWeekInfo(anchor, semesterStart);
    const start = dayjs.tz(weekInfo.weekStart, REPORT_TZ).startOf('day');

    return {
      start: start.toDate(),
      endExclusive: start.add(7, 'day').toDate(),
      startLabel: weekInfo.startDateLabel,
      endLabel: weekInfo.endDateLabel,
      weekNumber: weekInfo.weekNumber,
      weekLabel: weekInfo.weekLabel,
    };
  }

  private getMonthlyRange(month?: string): ReportRange {
    const start = month
      ? dayjs.tz(`${month}-01`, REPORT_TZ).startOf('month')
      : dayjs().tz(REPORT_TZ).startOf('month');

    return {
      start: start.toDate(),
      endExclusive: start.add(1, 'month').toDate(),
      startLabel: start.format('YYYY-MM-DD'),
      endLabel: start.endOf('month').format('YYYY-MM-DD'),
      monthLabel: start.format('YYYY-MM'),
    };
  }

  private getSemesterRange(semester?: string): ReportRange {
    const semesterValue = semester || this.getDefaultSemester();
    const match = /^(\d{4})-(\d{4})-(1|2)$/.exec(semesterValue);

    if (!match) {
      const fallback = this.getDefaultSemester();
      return this.getSemesterRange(fallback);
    }

    const startYear = Number(match[1]);
    const semesterNo = Number(match[3]);
    const start =
      semesterNo === 1
        ? dayjs.tz(`${startYear}-09-01`, REPORT_TZ).startOf('day')
        : dayjs.tz(`${startYear + 1}-02-01`, REPORT_TZ).startOf('day');
    const endExclusive =
      semesterNo === 1
        ? dayjs.tz(`${startYear + 1}-02-01`, REPORT_TZ).startOf('day')
        : dayjs.tz(`${startYear + 1}-08-01`, REPORT_TZ).startOf('day');

    return {
      start: start.toDate(),
      endExclusive: endExclusive.toDate(),
      startLabel: start.format('YYYY-MM-DD'),
      endLabel: endExclusive.subtract(1, 'day').format('YYYY-MM-DD'),
      semesterLabel: semesterValue,
    };
  }

  private async getDailyStats(
    reportDate: string | undefined,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    const range = this.getDailyRange(reportDate);
    const warnings = await this.findWarningsForReport(range, status, scope, selectedOrgId);
    const studentMap = await this.buildWarningContext(warnings);
    const orgStats = new Map<string, number>();
    const typeStats = new Map<string, number>();

    warnings.forEach((warning: any) => {
      const student = studentMap.get(warning.student_id.toString()) as any;
      const orgName = student?.classes?.orgs?.name || '未知';
      orgStats.set(orgName, (orgStats.get(orgName) || 0) + 1);
      const warningType = warning.trigger_summary || '未知';
      typeStats.set(warningType, (typeStats.get(warningType) || 0) + 1);
    });

    return {
      date: range.startLabel,
      total: warnings.length,
      orgStats: Array.from(orgStats.entries()).map(([org, count]) => ({ org, count })),
      typeStats: Array.from(typeStats.entries()).map(([type, count]) => ({ type, count })),
      warnings: warnings.map((warning: any) => {
        const student = studentMap.get(warning.student_id.toString()) as any;
        return {
          id: warning.id.toString(),
          studentName: student?.users?.name,
          studentNo: student?.student_no,
          className: student?.classes?.class_name,
          orgName: student?.classes?.orgs?.name,
          warningType: warning.trigger_summary,
          warningLevel: warning.level,
          status: warning.status,
          createdAt: warning.created_at.toISOString(),
        };
      }),
    };
  }

  private async getWeeklyStats(
    startDate: string | undefined,
    weekNumber: string | number | undefined,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    const range = await this.getWeeklyRange(startDate, weekNumber);
    const warnings = await this.findWarningsForReport(range, status, scope, selectedOrgId);
    const studentMap = await this.buildWarningContext(warnings);
    const dailyStats = new Map<string, number>();

    warnings.forEach((warning: any) => {
      const date = dayjs(warning.created_at).tz(REPORT_TZ).format('YYYY-MM-DD');
      dailyStats.set(date, (dailyStats.get(date) || 0) + 1);
    });

    return {
      startDate: range.startLabel,
      endDate: range.endLabel,
      weekNumber: range.weekNumber,
      weekLabel: range.weekLabel,
      total: warnings.length,
      dailyStats: Array.from(dailyStats.entries()).map(([date, count]) => ({ date, count })),
      warnings: warnings.map((warning: any) => {
        const student = studentMap.get(warning.student_id.toString()) as any;
        return {
          id: warning.id.toString(),
          studentName: student?.users?.name || '',
          studentNo: student?.student_no || '',
          className: student?.classes?.class_name || '',
          warningType: warning.trigger_summary || '',
          warningLevel: warning.level || '',
          status: warning.status || '',
          createdAt: warning.created_at
            ? dayjs(warning.created_at).tz(REPORT_TZ).format('YYYY-MM-DD HH:mm:ss')
            : '',
        };
      }),
    };
  }

  private async getMonthlyStats(
    month: string | undefined,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    const range = this.getMonthlyRange(month);
    const warnings = await this.findWarningsForReport(range, status, scope, selectedOrgId);
    const studentMap = await this.buildWarningContext(warnings);
    const levelStats = new Map<string, number>();

    warnings.forEach((warning: any) => {
      const level = warning.level || '未知';
      levelStats.set(level, (levelStats.get(level) || 0) + 1);
    });

    return {
      month: range.monthLabel,
      total: warnings.length,
      levelStats: Array.from(levelStats.entries()).map(([level, count]) => ({ level, count })),
      warnings: warnings.map((warning: any) => {
        const student = studentMap.get(warning.student_id.toString()) as any;
        return {
          id: warning.id.toString(),
          studentName: student?.users?.name || '',
          studentNo: student?.student_no || '',
          className: student?.classes?.class_name || '',
          warningType: warning.trigger_summary || '',
          warningLevel: warning.level || '',
          status: warning.status || '',
          createdAt: warning.created_at
            ? dayjs(warning.created_at).tz(REPORT_TZ).format('YYYY-MM-DD HH:mm:ss')
            : '',
        };
      }),
    };
  }

  private async getSemesterStats(
    semester: string | undefined,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    const range = this.getSemesterRange(semester);
    const warnings = await this.findWarningsForReport(range, status, scope, selectedOrgId);
    const studentMap = await this.buildWarningContext(warnings);
    const orgStats = new Map<string, { total: number; closed: number }>();

    warnings.forEach((warning: any) => {
      const student = studentMap.get(warning.student_id.toString()) as any;
      const orgName = student?.classes?.orgs?.name || '未知';
      const stats = orgStats.get(orgName) || { total: 0, closed: 0 };
      stats.total += 1;
      if (warning.status === 'closed') {
        stats.closed += 1;
      }
      orgStats.set(orgName, stats);
    });

    return {
      semester: range.semesterLabel,
      startDate: range.startLabel,
      endDate: range.endLabel,
      total: warnings.length,
      orgStats: Array.from(orgStats.entries()).map(([org, stats]) => ({
        org,
        ...stats,
        closeRate: stats.total > 0 ? `${((stats.closed / stats.total) * 100).toFixed(2)}%` : '0%',
      })),
    };
  }

  @Get('overview')
  @Permissions('report:export')
  async getReportsOverview(
    @Query('status') status: string,
    @Query('org_id') orgId: string,
    @Req() req: any,
  ) {
    try {
      const userId = this.getRequestUserId(req);
      const scope = await this.resolveReportScope(userId);
      const normalizedStatus = this.normalizeStatus(status);
      const normalizedOrgId = /^\d+$/.test(String(orgId || '').trim())
        ? BigInt(String(orgId).trim())
        : null;

      const cacheKey = this.buildOverviewCacheKey(userId, normalizedStatus, scope, normalizedOrgId);

      const payload = await this.prisma.$transaction(async (tx) => {
        const cache = await tx.dashboard_cache.findUnique({
          where: { cache_key: cacheKey },
          select: { payload_json: true, expires_at: true },
        });
        if (cache?.expires_at && cache.expires_at.getTime() > Date.now() && cache.payload_json) {
          return cache.payload_json as any;
        }

        const [dailyRange, weeklyRange, monthlyRange, semesterRange] = await Promise.all([
          Promise.resolve(this.getDailyRange()),
          this.getWeeklyRange(),
          Promise.resolve(this.getMonthlyRange()),
          Promise.resolve(this.getSemesterRange()),
        ]);

        const [dailyWarnings, weeklyWarnings, monthlyWarnings, semesterWarnings, history] = await Promise.all([
          this.findWarningsForReport(dailyRange, normalizedStatus, scope, normalizedOrgId),
          this.findWarningsForReport(weeklyRange, normalizedStatus, scope, normalizedOrgId),
          this.findWarningsForReport(monthlyRange, normalizedStatus, scope, normalizedOrgId),
          this.findWarningsForReport(semesterRange, normalizedStatus, scope, normalizedOrgId),
          tx.export_jobs.findMany({
            where: { creator_user_id: userId },
            orderBy: { created_at: 'desc' },
            take: 10,
            select: { id: true, report_type: true, status: true, created_at: true },
          }),
        ]);

        const monthlyDedupedWarnings = this.dedupeWarnings(monthlyWarnings);
        const semesterStudentMap = await this.buildWarningContext(semesterWarnings);
      const levelSummary = { yellow: 0, orange: 0, red: 0, severe: 0, other: 0 };
      const orgRankMap = new Map<string, { org_id: string | null; org_name: string; total: number; closed: number }>();

      for (const warning of monthlyDedupedWarnings) {
        const level = String(warning.level || 'other');
        if (Object.prototype.hasOwnProperty.call(levelSummary, level)) {
          (levelSummary as any)[level] += 1;
        } else {
          levelSummary.other += 1;
        }
      }

      for (const warning of semesterWarnings) {
        const student = semesterStudentMap.get(warning.student_id.toString()) as any;
        const orgIdValue = student?.classes?.orgs?.id ? String(student.classes.orgs.id) : null;
        const orgName = student?.classes?.orgs?.name || '未知学院';
        const current = orgRankMap.get(orgName) || {
          org_id: orgIdValue,
          org_name: orgName,
          total: 0,
          closed: 0,
        };
        current.total += 1;
        if (warning.status === 'closed') {
          current.closed += 1;
        }
        orgRankMap.set(orgName, current);
      }

      const reportTypeLabels: Record<string, string> = {
        daily: '日报表',
        weekly: '周报表',
        monthly: '月报表',
        semester: '学期报表',
      };

        const result = {
          summary: {
            todayWarnings: dailyWarnings.length,
            weeklyWarnings: weeklyWarnings.length,
            monthlyWarnings: monthlyDedupedWarnings.length,
            semesterWarnings: semesterWarnings.length,
            exportCount: history.length,
          },
          ranges: {
            daily: { date: dailyRange.startLabel },
            weekly: {
              startDate: weeklyRange.startLabel,
              endDate: weeklyRange.endLabel,
              weekNumber: weeklyRange.weekNumber,
              weekLabel: weeklyRange.weekLabel,
            },
            monthly: {
              month: monthlyRange.monthLabel,
              startDate: monthlyRange.startLabel,
              endDate: monthlyRange.endLabel,
            },
            semester: {
              semester: semesterRange.semesterLabel,
              startDate: semesterRange.startLabel,
              endDate: semesterRange.endLabel,
            },
          },
          monthlyLevelStats: levelSummary,
          semesterOrgRank: Array.from(orgRankMap.values())
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)
            .map((item) => ({
              ...item,
              closeRate: item.total > 0 ? Number(((item.closed / item.total) * 100).toFixed(2)) : 0,
            })),
          recentExports: history.map((item: any) => ({
            id: item.id.toString(),
            reportType: reportTypeLabels[item.report_type] || item.report_type,
            status: item.status,
            createdAt: item.created_at,
          })),
        };

        await tx.dashboard_cache.upsert({
          where: { cache_key: cacheKey },
          update: {
            payload_json: result as any,
            expires_at: new Date(Date.now() + 60 * 1000),
          },
          create: {
            cache_key: cacheKey,
            payload_json: result as any,
            expires_at: new Date(Date.now() + 60 * 1000),
          },
        });

        return result;
      });

      return {
        code: 0,
        message: 'ok',
        data: payload,
      };
    } catch (error: any) {
      this.logError(error, 'getReportsOverview');
      return { code: 500, message: '获取报表总览失败: ' + error.message };
    }
  }

  @Post('generate/daily')
  @Permissions('report:export')
  async generateDailyReport(
    @Query('date') date: string,
    @Query('status') status: string,
    @Query('org_id') orgId: string,
    @Req() req: any,
  ) {
    try {
      const userId = this.getRequestUserId(req);
      const scope = await this.resolveReportScope(userId);
      const normalizedStatus = this.normalizeStatus(status);
      const normalizedOrgId = /^\d+$/.test(String(orgId || '').trim())
        ? BigInt(String(orgId).trim())
        : null;
      const range = this.getDailyRange(date);
      const data = await this.getDailyStats(range.startLabel, normalizedStatus, scope, normalizedOrgId);

      const exportJob = await this.createExportJob(
        userId,
        'daily',
        { date: range.startLabel, status: normalizedStatus || 'all', org_id: normalizedOrgId?.toString() || '' },
        scope,
      );

      return {
        code: 0,
        message: 'ok',
        data: {
          ...data,
          export_job_id: exportJob.id.toString(),
        },
      };
    } catch (error: any) {
      this.logError(error, 'generateDailyReport');
      return { code: 500, message: '日报表生成失败: ' + error.message };
    }
  }

  @Post('generate/weekly')
  @Permissions('report:export')
  async generateWeeklyReport(
    @Query('startDate') startDate: string,
    @Query('weekNumber') weekNumber: string,
    @Query('status') status: string,
    @Query('org_id') orgId: string,
    @Req() req: any,
  ) {
    try {
      const userId = this.getRequestUserId(req);
      const scope = await this.resolveReportScope(userId);
      const normalizedStatus = this.normalizeStatus(status);
      const normalizedOrgId = /^\d+$/.test(String(orgId || '').trim())
        ? BigInt(String(orgId).trim())
        : null;
      const range = await this.getWeeklyRange(startDate, weekNumber);
      const data = await this.getWeeklyStats(
        range.startLabel,
        weekNumber || range.weekNumber,
        normalizedStatus,
        scope,
        normalizedOrgId,
      );

      const exportJob = await this.createExportJob(
        userId,
        'weekly',
        {
          startDate: range.startLabel,
          endDate: range.endLabel,
          weekNumber: range.weekNumber,
          weekLabel: range.weekLabel,
          status: normalizedStatus || 'all',
          org_id: normalizedOrgId?.toString() || '',
        },
        scope,
      );

      return {
        code: 0,
        message: 'ok',
        data: {
          ...data,
          export_job_id: exportJob.id.toString(),
        },
      };
    } catch (error: any) {
      this.logError(error, 'generateWeeklyReport');
      return { code: 500, message: '周报表生成失败: ' + error.message };
    }
  }

  @Post('generate/monthly')
  @Permissions('report:export')
  async generateMonthlyReport(
    @Query('month') month: string,
    @Query('status') status: string,
    @Query('org_id') orgId: string,
    @Req() req: any,
  ) {
    try {
      const userId = this.getRequestUserId(req);
      const scope = await this.resolveReportScope(userId);
      const normalizedStatus = this.normalizeStatus(status);
      const normalizedOrgId = /^\d+$/.test(String(orgId || '').trim())
        ? BigInt(String(orgId).trim())
        : null;
      const range = this.getMonthlyRange(month);
      const data = await this.getMonthlyStats(range.monthLabel, normalizedStatus, scope, normalizedOrgId);

      const exportJob = await this.createExportJob(
        userId,
        'monthly',
        { month: range.monthLabel, status: normalizedStatus || 'all', org_id: normalizedOrgId?.toString() || '' },
        scope,
      );

      return {
        code: 0,
        message: 'ok',
        data: {
          ...data,
          export_job_id: exportJob.id.toString(),
        },
      };
    } catch (error: any) {
      this.logError(error, 'generateMonthlyReport');
      return { code: 500, message: '月报表生成失败: ' + error.message };
    }
  }

  @Post('generate/semester')
  @Permissions('report:export')
  async generateSemesterReport(
    @Query('semester') semester: string,
    @Query('status') status: string,
    @Query('org_id') orgId: string,
    @Req() req: any,
  ) {
    try {
      const userId = this.getRequestUserId(req);
      const scope = await this.resolveReportScope(userId);
      const normalizedStatus = this.normalizeStatus(status);
      const normalizedOrgId = /^\d+$/.test(String(orgId || '').trim())
        ? BigInt(String(orgId).trim())
        : null;
      const range = this.getSemesterRange(semester);
      const data = await this.getSemesterStats(range.semesterLabel, normalizedStatus, scope, normalizedOrgId);

      const exportJob = await this.createExportJob(
        userId,
        'semester',
        { semester: range.semesterLabel, status: normalizedStatus || 'all', org_id: normalizedOrgId?.toString() || '' },
        scope,
      );

      return {
        code: 0,
        message: 'ok',
        data: {
          ...data,
          export_job_id: exportJob.id.toString(),
        },
      };
    } catch (error: any) {
      this.logError(error, 'generateSemesterReport');
      return { code: 500, message: '学期报表生成失败: ' + error.message };
    }
  }

  @Get('history')
  @Permissions('report:export')
  async getExportHistory(@Req() req: any) {
    try {
      const userId = this.getRequestUserId(req);
      const history = await this.prisma.export_jobs.findMany({
        where: { creator_user_id: userId },
        orderBy: { created_at: 'desc' },
        take: 20,
      });

      const reportTypeLabels: Record<string, string> = {
        daily: '日报表',
        weekly: '周报表',
        monthly: '月报表',
        semester: '学期报表',
      };

      return {
        code: 0,
        message: 'ok',
        data: {
          list: history.map((item: any) => ({
            id: item.id.toString(),
            reportType: reportTypeLabels[item.report_type] || item.report_type,
            date: item.created_at.toLocaleString(),
            status: item.status,
            fileName: `${reportTypeLabels[item.report_type] || '报表'}-${item.created_at
              .toLocaleString()
              .replace(/[\/:]/g, '-')}.csv`,
          })),
          total: history.length,
        },
      };
    } catch (error: any) {
      this.logError(error, 'getExportHistory');
      return { code: 500, message: '获取导出历史失败' };
    }
  }

  @Post('delete/:id')
  @Permissions('report:export')
  async deleteReport(@Param('id') id: string, @Req() req: any) {
    try {
      const userId = this.getRequestUserId(req);
      const job = await this.prisma.export_jobs.findUnique({
        where: { id: BigInt(id) },
      });

      if (!job) {
        return { code: 404, message: '报表不存在' };
      }

      if (job.creator_user_id !== userId) {
        return { code: 403, message: '无权删除他人生成的报表' };
      }

      await this.prisma.export_jobs.delete({
        where: { id: BigInt(id) },
      });

      return { code: 0, message: '删除成功' };
    } catch (error: any) {
      this.logError(error, 'deleteReport');
      return { code: 500, message: '删除报表失败' };
    }
  }

  @Get('download/:id')
  @Permissions('report:export')
  async downloadReport(@Param('id') id: string, @Req() req: any, @Res() res: any) {
    try {
      const userId = this.getRequestUserId(req);
      const job = await this.prisma.export_jobs.findUnique({
        where: { id: BigInt(id) },
      });

      if (!job) {
        return res.status(404).json({ code: 404, message: '报表不存在' });
      }

      if (job.creator_user_id !== userId) {
        return res.status(403).json({ code: 403, message: '无权下载他人生成的报表' });
      }

      const scope = await this.resolveReportScope(userId);
      const params = (job.params_json as any) || {};
      const normalizedStatus = this.normalizeStatus(params.status);
      const normalizedOrgId = /^\d+$/.test(String(params.org_id || '').trim())
        ? BigInt(String(params.org_id).trim())
        : null;

      let range: ReportRange;
      switch (job.report_type) {
        case 'daily':
          range = this.getDailyRange(params.date);
          break;
        case 'weekly':
          range = await this.getWeeklyRange(params.startDate, params.weekNumber);
          break;
        case 'monthly':
          range = this.getMonthlyRange(params.month);
          break;
        case 'semester':
          range = this.getSemesterRange(params.semester);
          break;
        default:
          return res.status(400).json({ code: 400, message: '未知的报表类型' });
      }

      const warnings = this.dedupeWarnings(
        await this.findWarningsForReport(range, normalizedStatus, scope, normalizedOrgId),
      );
      const studentMap = await this.buildWarningContext(warnings);

      const levelMap: Record<string, string> = {
        yellow: '黄色预警',
        orange: '橙色预警',
        red: '红色预警',
        severe: '严重预警',
      };
      const statusMap: Record<string, string> = {
        open: '待处理',
        acknowledged: '已确认',
        closed: '已关闭',
      };

      const lines = [
        [
          '预警ID',
          '学生姓名',
          '学号',
          '班级',
          '学院',
          '预警内容',
          '预警级别',
          '状态',
          '发布时间',
        ].map((cell) => this.escapeCsvCell(cell)).join(','),
      ];

      for (const warning of warnings) {
        const student = studentMap.get(warning.student_id.toString()) as any;
        lines.push(
          [
            warning.id.toString(),
            student?.users?.name || '未知',
            student?.student_no || '未知',
            student?.classes?.class_name || '未知',
            student?.classes?.orgs?.name || '未知',
            warning.trigger_summary || '',
            levelMap[warning.level] || warning.level,
            statusMap[warning.status] || warning.status,
            dayjs(warning.created_at).tz(REPORT_TZ).format('YYYY-MM-DD HH:mm:ss'),
          ]
            .map((cell) => this.escapeCsvCell(cell))
            .join(','),
        );
      }

      const buffer = Buffer.from(`\ufeff${lines.join('\n')}`);

      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report-${id}.csv"`,
        'Content-Length': buffer.length,
      });

      res.end(buffer);
    } catch (error: any) {
      this.logError(error, 'downloadReport');
      res.status(500).json({ code: 500, message: '下载失败' });
    }
  }
}

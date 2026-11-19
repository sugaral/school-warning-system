import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { WarningCasesService } from '../warning-cases/warning-cases.service';
import { ConfigService } from '../config/config.service';
import {
  buildAcademicWeeksFromStart,
  getAcademicWeekInfo,
  resolveSemesterStartDate,
  resolveSemesterTotalWeeks,
} from '../shared/academic-calendar.util';
import { getHeadTeacherClassScopeIds } from '../shared/head-teacher-scope.util';

type ScopeFilter = {
  filter: any;
  classIds: bigint[];
  orgIds: bigint[];
};

type WarningSummary = {
  yellow: number;
  orange: number;
  red: number;
  severe: number;
  totalWarnings: number;
  seriousWarnings: number;
  generalWarnings: number;
  resolvedWarnings: number;
  pendingWarnings: number;
};

@Controller('admin/stats')
@UseGuards(AuthGuard, PermissionGuard)
export class StatsController {
  private readonly dashboardCacheTtlSeconds = 60;
  private readonly payloadCache = new Map<string, { data: any; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly warningCasesService: WarningCasesService,
    private readonly configService: ConfigService,
  ) {}

  private async getCachedPayload<T>(cacheKey: string, loader: () => Promise<T>, ttlSeconds: number) {
    const now = Date.now();
    const cached = this.payloadCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }
    const data = await loader();
    this.payloadCache.set(cacheKey, { data, expiresAt: now + ttlSeconds * 1000 });
    return data;
  }

  private async getSemesterStartDate(referenceDate?: Date) {
    const teachingConfig = await this.configService.getSectionConfig('teaching', {});
    return resolveSemesterStartDate(teachingConfig?.semesterStartDate, referenceDate);
  }

  private async buildWeeklyWarningTrend(scope: ScopeFilter) {
    const teachingConfig = await this.configService.getSectionConfig('teaching', {});
    const semesterStartDate = resolveSemesterStartDate(teachingConfig?.semesterStartDate);
    const semesterTotalWeeks = resolveSemesterTotalWeeks(teachingConfig?.semesterTotalWeeks);
    const currentWeek = getAcademicWeekInfo(new Date(), semesterStartDate).weekNumber;
    const visibleWeekCount = Math.max(1, Math.min(currentWeek, semesterTotalWeeks));
    const weeks = buildAcademicWeeksFromStart(semesterStartDate, visibleWeekCount);
    const startDate = weeks[0]?.weekStart || semesterStartDate;

    const warnings = await this.prisma.warnings.findMany({
      where: {
        ...scope.filter,
        created_at: { gte: startDate },
      },
      select: {
        created_at: true,
        level: true,
        status: true,
      },
      orderBy: { created_at: 'asc' },
    });

    const weekMap = new Map(
      weeks.map((item) => [
        item.weekNumber,
        {
          label: item.weekLabel,
          total: 0,
          serious: 0,
          resolved: 0,
        },
      ]),
    );

    warnings.forEach((warning: any) => {
      const weekInfo = getAcademicWeekInfo(new Date(warning.created_at), semesterStartDate);
      const current = weekMap.get(weekInfo.weekNumber);
      if (!current) {
        return;
      }

      if (String(warning.status || '') === 'closed') {
        current.resolved += 1;
        return;
      }

      current.total += 1;
      if (['red', 'severe', 'high', 'critical'].includes(String(warning.level || ''))) {
        current.serious += 1;
      }
    });

    const ordered = weeks.map((week) => weekMap.get(week.weekNumber)!);
    return {
      labels: ordered.map((item) => item.label),
      totals: ordered.map((item) => item.total),
      serious: ordered.map((item) => item.serious),
      resolved: ordered.map((item) => item.resolved),
    };
  }

  private async getPermissionFilter(userId: bigint): Promise<ScopeFilter> {
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });

    const roles = userRoles.map((item: any) => item.role);
    const filter: any = {};
    const classIds: bigint[] = [];
    const orgIds: bigint[] = [];

    if (roles.includes('sys_admin') || roles.includes('dean') || roles.includes('teaching_admin')) {
      return { filter, classIds, orgIds };
    }

    if (roles.includes('student_admin')) {
      const scopedRole = userRoles.find((item: any) => item.role === 'student_admin');
      if (scopedRole?.scope_id) {
        orgIds.push(scopedRole.scope_id);
        filter.org_id = { in: orgIds };
      }
      return { filter, classIds, orgIds };
    }

    if (roles.includes('head_teacher')) {
      const headTeacherClassIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
        activeOnly: true,
      });
      if (headTeacherClassIds.length > 0) {
        classIds.push(...headTeacherClassIds);
        filter.class_id = { in: classIds };
      }
      return { filter, classIds, orgIds };
    }

    if (roles.includes('teacher')) {
      const bindings = await this.prisma.teacher_course_bindings.findMany({
        where: { teacher_id: userId },
        select: { class_id: true },
      });
      bindings.forEach((item: any) => classIds.push(item.class_id));
      if (classIds.length > 0) {
        filter.class_id = { in: [...new Set(classIds)] };
      }
    }

    return { filter, classIds: [...new Set(classIds)], orgIds };
  }

  private buildStudentWhere(scope: ScopeFilter) {
    const where: any = { status: 'active' };
    if (scope.classIds.length > 0) {
      where.class_id = { in: scope.classIds };
    } else if (scope.orgIds.length > 0) {
      where.org_id = { in: scope.orgIds };
    }
    return where;
  }

  private buildCaseWhere(scope: ScopeFilter, activeOnly = true) {
    const where: any = {};
    if (activeOnly) {
      where.is_active = true;
    }
    if (scope.classIds.length > 0) {
      where.class_id = { in: scope.classIds };
    } else if (scope.orgIds.length > 0) {
      where.org_id = { in: scope.orgIds };
    }
    return where;
  }

  private createEmptySummary(): WarningSummary {
    return {
      yellow: 0,
      orange: 0,
      red: 0,
      severe: 0,
      totalWarnings: 0,
      seriousWarnings: 0,
      generalWarnings: 0,
      resolvedWarnings: 0,
      pendingWarnings: 0,
    };
  }

  private applyWarningCount(
    summary: WarningSummary,
    level: string,
    status: string,
    count: number,
  ) {
    if (count <= 0) {
      return;
    }

    const normalizedLevel = String(level || '').toLowerCase();
    const normalizedStatus = String(status || '').toLowerCase();

    if (normalizedStatus === 'closed') {
      summary.resolvedWarnings += count;
      return;
    }

    summary.totalWarnings += count;

    if (normalizedLevel === 'yellow' || normalizedLevel === 'low') {
      summary.yellow += count;
      summary.generalWarnings += count;
    } else if (normalizedLevel === 'orange') {
      summary.orange += count;
      summary.generalWarnings += count;
    } else if (normalizedLevel === 'red' || normalizedLevel === 'high') {
      summary.red += count;
      summary.seriousWarnings += count;
    } else if (normalizedLevel === 'severe' || normalizedLevel === 'critical') {
      summary.severe += count;
      summary.seriousWarnings += count;
    }

    summary.pendingWarnings += count;
  }

  private summarizeGroupedWarnings(
    rows: Array<{
      level: string;
      status: string;
      _count: { _all: number };
    }>,
  ) {
    const summary = this.createEmptySummary();
    rows.forEach((row) => {
      this.applyWarningCount(summary, row.level, row.status, Number(row._count?._all || 0));
    });
    return summary;
  }

  private buildScopeSql(scope: ScopeFilter, alias = '') {
    const columnPrefix = alias ? `${alias}.` : '';
    const field = (name: string) => Prisma.raw(`${columnPrefix}${name}`);

    if (scope.classIds.length > 0) {
      return Prisma.sql` AND ${field('class_id')} IN (${Prisma.join(scope.classIds)})`;
    }
    if (scope.orgIds.length > 0) {
      return Prisma.sql` AND ${field('org_id')} IN (${Prisma.join(scope.orgIds)})`;
    }
    return Prisma.empty;
  }

  private async querySlaStats(scope: ScopeFilter, sinceDate: Date, totalWarningsCount: number) {
    const result = {
      rate: 0,
      avgHours: 0,
      values: {
        twentyFour: 0,
        twentyFourCount: 0,
        three: 0,
        threeCount: 0,
        seven: 0,
        sevenCount: 0,
        over: 0,
        overCount: 0,
      },
    };

    const scopeSql = this.buildScopeSql(scope);
    const rows = await this.prisma.$queryRaw<
      Array<{
        twentyFourCount: bigint | number | null;
        threeCount: bigint | number | null;
        sevenCount: bigint | number | null;
        overCount: bigint | number | null;
        avgHours: number | string | null;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN diff_hours <= 24 THEN 1 ELSE 0 END), 0) AS twentyFourCount,
        COALESCE(SUM(CASE WHEN diff_hours > 24 AND diff_hours <= 72 THEN 1 ELSE 0 END), 0) AS threeCount,
        COALESCE(SUM(CASE WHEN diff_hours > 72 AND diff_hours <= 168 THEN 1 ELSE 0 END), 0) AS sevenCount,
        COALESCE(SUM(CASE WHEN diff_hours > 168 THEN 1 ELSE 0 END), 0) AS overCount,
        COALESCE(AVG(diff_hours), 0) AS avgHours
      FROM (
        SELECT TIMESTAMPDIFF(
          HOUR,
          created_at,
          closed_at
        ) AS diff_hours
        FROM warnings
        WHERE created_at >= ${sinceDate}
          AND status = 'closed'
          AND closed_at IS NOT NULL
          ${scopeSql}
      ) resolved_warnings
    `);

    const row = rows[0] || {
      twentyFourCount: 0,
      threeCount: 0,
      sevenCount: 0,
      overCount: 0,
      avgHours: 0,
    };

    const twentyFourCount = Number(row.twentyFourCount || 0);
    const threeCount = Number(row.threeCount || 0);
    const sevenCount = Number(row.sevenCount || 0);
    const overCount = Number(row.overCount || 0);
    const avgHours = Number(row.avgHours || 0);
    const resolvedCount = twentyFourCount + threeCount + sevenCount + overCount;
    const total = Math.max(1, resolvedCount);

    result.values.twentyFourCount = twentyFourCount;
    result.values.twentyFour = Math.round((twentyFourCount / total) * 100);
    result.values.threeCount = threeCount;
    result.values.three = Math.round((threeCount / total) * 100);
    result.values.sevenCount = sevenCount;
    result.values.seven = Math.round((sevenCount / total) * 100);
    result.values.overCount = overCount;
    result.values.over = Math.round((overCount / total) * 100);
    result.rate = Math.round(((twentyFourCount + threeCount + sevenCount) / total) * 100);
    result.avgHours = avgHours;

    return result;
  }

  private summarizeWarnings(warnings: Array<{ level: string; status: string }>) {
    let yellow = 0;
    let orange = 0;
    let red = 0;
    let severe = 0;
    let resolvedWarnings = 0;
    let pendingWarnings = 0;

    warnings.forEach((warning) => {
      if (warning.level === 'yellow' || warning.level === 'low') yellow += 1;
      else if (warning.level === 'orange') orange += 1;
      else if (warning.level === 'red' || warning.level === 'high') red += 1;
      else if (warning.level === 'severe' || warning.level === 'critical') severe += 1;

      if (warning.status === 'closed') {
        resolvedWarnings += 1;
      } else {
        pendingWarnings += 1;
      }
    });

    return {
      yellow,
      orange,
      red,
      severe,
      totalWarnings: warnings.length,
      seriousWarnings: red + severe,
      generalWarnings: yellow + orange,
      resolvedWarnings,
      pendingWarnings,
    };
  }

  private calculateGrowth(current: number, previous: number) {
    if (!previous) {
      return current > 0 ? 100 : 0;
    }
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  private getWeekRangeLabel(date: Date) {
    const current = new Date(date);
    current.setHours(0, 0, 0, 0);
    const weekday = current.getDay();
    const offset = weekday === 0 ? 6 : weekday - 1;
    const weekStart = new Date(current.getTime() - offset * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    return {
      start: weekStart,
      end: weekEnd,
      label: `${weekStart.toISOString().split('T')[0].slice(5)}~${weekEnd.toISOString().split('T')[0].slice(5)}`,
    };
  }

  private getTrendWindow(timeRange: string) {
    if (timeRange === 'day') {
      const labels: string[] = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        labels.push(date.toISOString().split('T')[0].replace(/-/g, '/'));
      }
      return {
        labels,
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      };
    }

    if (timeRange === 'week') {
      const labels: string[] = [];
      const currentWeek = this.getWeekRangeLabel(new Date());
      for (let i = 11; i >= 0; i--) {
        const weekStart = new Date(currentWeek.start.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        labels.push(this.getWeekRangeLabel(weekStart).label);
      }
      return {
        labels,
        startDate: new Date(currentWeek.start.getTime() - 11 * 7 * 24 * 60 * 60 * 1000),
      };
    }

    const labels: string[] = [];
    const cursor = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    cursor.setDate(1);
    while (cursor <= new Date()) {
      labels.push(`${cursor.getFullYear()}/${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return {
      labels,
      startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
    };
  }

  private getTrendKey(date: Date, timeRange: string) {
    if (timeRange === 'day') {
      return date.toISOString().split('T')[0].replace(/-/g, '/');
    }
    if (timeRange === 'week') {
      return this.getWeekRangeLabel(date).label;
    }
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private buildTrend(labels: string[], warnings: Array<{ created_at: Date; level: string; status: string }>, timeRange: string) {
    const map = new Map<string, { total: number; red: number; yellow: number; resolved: number }>();
    labels.forEach((label: any) => {
      map.set(label, { total: 0, red: 0, yellow: 0, resolved: 0 });
    });

    warnings.forEach((warning) => {
      const key = this.getTrendKey(new Date(warning.created_at), timeRange);
      const current = map.get(key);
      if (!current) return;

      if (warning.status === 'closed') {
        current.resolved += 1;
        return;
      }

      current.total += 1;
      if (['red', 'severe', 'high', 'critical'].includes(warning.level)) {
        current.red += 1;
      } else if (['yellow', 'orange', 'low'].includes(warning.level)) {
        current.yellow += 1;
      }
    });

    return {
      labels,
      totals: labels.map((label: any) => map.get(label)?.total || 0),
      reds: labels.map((label: any) => map.get(label)?.red || 0),
      yellows: labels.map((label: any) => map.get(label)?.yellow || 0),
      resolveds: labels.map((label: any) => map.get(label)?.resolved || 0),
    };
  }

  private buildDeptDistribution(
    orgs: Array<{ id: bigint; name: string }>,
    warnings: Array<{ org_id: bigint; level: string; count?: number }>,
  ) {
    const map = new Map<string, { org_name: string; orange_count: number; red_count: number }>();
    orgs.forEach((org: any) => {
      map.set(org.id.toString(), {
        org_name: org.name,
        orange_count: 0,
        red_count: 0,
      });
    });

    warnings.forEach((warning) => {
      const key = warning.org_id.toString();
      const count = Number(warning.count || 1);
      const current = map.get(key) || {
        org_name: '未知学院',
        orange_count: 0,
        red_count: 0,
      };
      if (['red', 'severe', 'high', 'critical'].includes(warning.level)) {
        current.red_count += count;
      } else if (['yellow', 'orange', 'low'].includes(warning.level)) {
        current.orange_count += count;
      }
      map.set(key, current);
    });

    const rows = Array.from(map.values())
      .sort((a, b) => (b.red_count + b.orange_count) - (a.red_count + a.orange_count))
      .slice(0, 6);

    return {
      depts: rows.map((row) => row.org_name),
      orange: rows.map((row) => row.orange_count),
      red: rows.map((row) => row.red_count),
    };
  }

  private buildSlaStats(resolvedWarnings: Array<{ created_at: Date; closed_at?: Date | null; acknowledged_at?: Date | null; status: string }>, totalWarningsCount: number) {
    const result = {
      rate: 0,
      avgHours: 0,
      values: {
        twentyFour: 0,
        twentyFourCount: 0,
        three: 0,
        threeCount: 0,
        seven: 0,
        sevenCount: 0,
        over: 0,
        overCount: 0,
      },
    };

    const resolutionTimes = resolvedWarnings
      .map((warning) => {
        const resolvedAt = warning.status === 'closed' ? warning.closed_at : warning.acknowledged_at;
        if (!resolvedAt) return 0;
        return (new Date(resolvedAt).getTime() - new Date(warning.created_at).getTime()) / (1000 * 60 * 60);
      })
      .filter((value) => value >= 0);

    if (totalWarningsCount === 0) {
      return result;
    }

    const total = totalWarningsCount;
    const twentyFourCount = resolutionTimes.filter((value) => value <= 24).length;
    const threeCount = resolutionTimes.filter((value) => value > 24 && value <= 72).length;
    const sevenCount = resolutionTimes.filter((value) => value > 72 && value <= 168).length;
    const overCount = resolutionTimes.filter((value) => value > 168).length;

    result.values.twentyFourCount = twentyFourCount;
    result.values.twentyFour = Math.round((twentyFourCount / total) * 100);
    result.values.threeCount = threeCount;
    result.values.three = Math.round((threeCount / total) * 100);
    result.values.sevenCount = sevenCount;
    result.values.seven = Math.round((sevenCount / total) * 100);
    result.values.overCount = overCount;
    result.values.over = Math.round((overCount / total) * 100);
    result.rate = Math.round(((twentyFourCount + threeCount + sevenCount) / total) * 100);
    result.avgHours = resolutionTimes.reduce((sum, value) => sum + value, 0) / total;

    return result;
  }

  @Get()
  @Permissions('stats:view')
  async getStats() {
    const [totalUsers, totalStudents, totalTeachers, activeWarnings, totalOrgs, totalClasses, totalCourses, todayNotifications] = await Promise.all([
      this.prisma.users.count(),
      this.prisma.users.count({ where: { user_type: 'student' } }),
      this.prisma.users.count({ where: { user_type: 'teacher' } }),
      this.prisma.warnings.count({ where: { status: 'open' } }),
      this.prisma.orgs.count(),
      this.prisma.classes.count(),
      this.prisma.courses.count(),
      this.prisma.notification_logs.count({
        where: {
          sent_at: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    return {
      code: 0,
      message: 'ok',
      data: {
        totalUsers,
        totalStudents,
        totalTeachers,
        activeWarnings,
        totalOrgs,
        totalClasses,
        totalCourses,
        todayNotifications,
      },
    };
  }

  @Get('summary')
  @Permissions('stats:view')
  async getDashboardSummary(@Req() req: any) {
    const userId = BigInt(req.user.sub);
    const payload = await this.getCachedPayload(
      `admin:stats:summary:${userId.toString()}`,
      async () => {
        const scope = await this.getPermissionFilter(userId);
        const studentWhere = this.buildStudentWhere(scope);

        const [warningGroups, pendingLeaves, totalStudents, recentWarnings] = await Promise.all([
          this.prisma.warnings.groupBy({
            by: ['status'],
            where: scope.filter,
            _count: {
              id: true,
            },
          }),
          this.prisma.leave_requests.count({
            where: {
              ...(scope.classIds.length > 0 ? { class_id: { in: scope.classIds } } : {}),
              status: 'submitted',
            },
          }),
          this.prisma.student_profiles.count({ where: studentWhere }),
          this.prisma.warnings.findMany({
            where: scope.filter,
            orderBy: { created_at: 'desc' },
            take: 5,
          }),
        ]);

        let pendingWarnings = 0;
        warningGroups.forEach((item: any) => {
          if (String(item.status || '').trim().toLowerCase() === 'open') {
            pendingWarnings += Number(item._count?.id || 0);
          }
        });

        const studentIds = [...new Set(recentWarnings.map((item: any) => item.student_id))];
        const students = studentIds.length > 0
          ? await this.prisma.student_profiles.findMany({
              where: { id: { in: studentIds as any } },
              include: { users: true },
            })
          : [];
        const studentMap = new Map(students.map((item: any) => [item.id.toString(), item]));

        return {
          pendingWarnings,
          pendingLeaves,
          totalStudents,
          recentWarnings: recentWarnings.map((warning: any) => ({
            id: warning.id.toString(),
            student_no: (studentMap.get(warning.student_id.toString()) as any)?.student_no || '',
            name: (studentMap.get(warning.student_id.toString()) as any)?.users?.name || '未知',
            warning_level: warning.level,
            warning_reason: warning.trigger_summary,
            created_at: warning.created_at,
          })),
          todoList: [
            pendingWarnings > 0
              ? {
                  content: `有 ${pendingWarnings} 条预警待确认`,
                  time: '今日',
                  type: 'warning',
                  color: '#d4a017',
                  count: pendingWarnings,
                }
              : null,
            pendingLeaves > 0
              ? {
                  content: `有 ${pendingLeaves} 条请假待审批`,
                  time: '今日',
                  type: 'primary',
                  color: '#409eff',
                  count: pendingLeaves,
                }
              : null,
          ].filter(Boolean),
          activities: recentWarnings.slice(0, 3).map((warning: any) => ({
            title: `${(studentMap.get(warning.student_id.toString()) as any)?.users?.name || '学生'} 触发了 ${warning.trigger_summary}`,
            time: '近期',
          })),
        };
      },
      this.dashboardCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data: payload,
    };
  }

  @Get('org-warnings')
  @Permissions('stats:view')
  async getOrgWarnings() {
    const warningGroups = await this.prisma.warnings.groupBy({
      by: ['org_id'],
      where: { status: 'open' },
      _count: {
        id: true,
      },
    });
    const orgIds = warningGroups
      .map((item: any) => item.org_id?.toString?.())
      .filter(Boolean)
      .map((item: any) => BigInt(item));
    const orgs = orgIds.length > 0
      ? await this.prisma.orgs.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [];
    const orgMap = new Map(orgs.map((item: { id: bigint; name: string }) => [item.id.toString(), item.name]));
    

    return {
      code: 0,
      message: 'ok',
      data: warningGroups
        .map((item: any) => {
          const orgId = item.org_id?.toString?.() || '';
          const count = Number(item._count?.id || 0);
          return {
          org_name: orgMap.get(orgId) || '未知学院',
          warning_count: count,
          };
        })
        .sort((a, b) => b.warning_count - a.warning_count)
        .slice(0, 10),
    };
  }

  @Get('warning-trend')
  @Permissions('stats:view')
  async getWarningTrend() {
    const data = await this.getCachedPayload(
      'admin:stats:warning-trend:day',
      async () => {
        const labels = this.getTrendWindow('day').labels;
        const warnings = await this.prisma.warnings.findMany({
          where: { created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          select: { created_at: true, level: true, status: true },
        });
        return this.buildTrend(labels, warnings, 'day');
      },
      this.dashboardCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data,
    };
  }

  @Get('level-distribution')
  @Permissions('stats:view')
  async getLevelDistribution() {
    const data = await this.getCachedPayload(
      'admin:stats:level-distribution:day',
      async () => {
        const labels = this.getTrendWindow('day').labels;
        const warnings = await this.prisma.warnings.findMany({
          where: { created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          select: { created_at: true, level: true, status: true },
        });
        const trend = this.buildTrend(labels, warnings, 'day');
        return {
          levels: ['yellow', 'orange', 'red', 'severe'],
          trend: labels.map((label: any, index: number) => ({
            date: label,
            yellow: trend.yellows[index],
            red: trend.reds[index],
          })),
        };
      },
      this.dashboardCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data,
    };
  }

  @Get('user-type-distribution')
  @Permissions('stats:view')
  async getUserTypeDistribution() {
    const users = await this.prisma.users.findMany({
      select: { user_type: true },
    });
    const map = new Map<string, number>();
    users.forEach((user: any) => {
      map.set(user.user_type || '未知', (map.get(user.user_type || '未知') || 0) + 1);
    });
    return {
      code: 0,
      message: 'ok',
      data: Array.from(map.entries()).map(([user_type, count]) => ({ user_type, count })),
    };
  }

  @Get('system-health')
  @Permissions('stats:view')
  async getSystemHealth() {
    const uptime = process.uptime();
    const days = Math.floor(uptime / (24 * 60 * 60));
    const hours = Math.floor((uptime % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((uptime % (60 * 60)) / 60);
    const memoryUsage = process.memoryUsage();
    const memoryPercent = ((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100).toFixed(1);
    const memoryUsed = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
    const memoryTotal = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);
    const cpuUsage = process.cpuUsage();
    const cpuPercent = ((cpuUsage.user + cpuUsage.system) / 1000000 / uptime * 100).toFixed(1);

    return {
      code: 0,
      message: 'ok',
      data: {
        uptime: `${days}天 ${hours}小时 ${minutes}分钟`,
        memoryUsage: `${memoryPercent}% (${memoryUsed}MB / ${memoryTotal}MB)`,
        cpuUsage: `${cpuPercent}%`,
        diskUsage: 'N/A',
      },
    };
  }

  @Get('system2')
  @Permissions('stats:view')
  async getSystemStats2(@Query('timeRange') timeRange = 'month', @Req() req: any) {
    const userId = BigInt(req.user.sub);
    const scope = await this.getPermissionFilter(userId);
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const twelveMonthsAgo = new Date(Date.now() - 360 * 24 * 60 * 60 * 1000);
    const trendWindow = this.getTrendWindow(timeRange);
    const caseWhere = this.buildCaseWhere(scope, true);
    const previousCaseWhere = this.buildCaseWhere(scope, false);

    await this.warningCasesService.reconcileActiveCases({
      roles: [],
      userId,
      orgScopeIds: scope.orgIds,
      classScopeIds: scope.classIds,
    });

    const [currentWarningGroups, previousWarningGroups, trendWarnings, activeCases, previousCaseCount] =
      await Promise.all([
        this.prisma.warnings.groupBy({
          by: ['org_id', 'level', 'status'],
          where: {
            ...scope.filter,
            created_at: { gte: sixMonthsAgo },
          },
          _count: { _all: true },
        }),
        this.prisma.warnings.groupBy({
          by: ['level', 'status'],
          where: {
            ...scope.filter,
            created_at: {
              gte: twelveMonthsAgo,
              lt: sixMonthsAgo,
            },
          },
          _count: { _all: true },
        }),
        this.prisma.warnings.findMany({
          where: {
            ...scope.filter,
            created_at: { gte: trendWindow.startDate },
          },
          select: {
            created_at: true,
            level: true,
            status: true,
          },
        }),
        this.prisma.warning_cases.findMany({
          where: caseWhere,
          orderBy: [{ risk_score: 'desc' }, { handling_priority: 'desc' }, { updated_at: 'desc' }],
          take: 10,
        }),
        this.prisma.warning_cases.count({
          where: {
            ...previousCaseWhere,
            created_at: {
              gte: twelveMonthsAgo,
              lt: sixMonthsAgo,
            },
          },
        }),
      ]);

    const summary = this.summarizeGroupedWarnings(currentWarningGroups as any);
    const previousSummary = this.summarizeGroupedWarnings(previousWarningGroups as any);
    const trend = this.buildTrend(trendWindow.labels, trendWarnings, timeRange);

    const deptOrgIds = [
      ...new Set(
        currentWarningGroups
          .map((item: any) => item.org_id?.toString())
          .filter(Boolean),
      ),
    ].map((item: any) => BigInt(item));
    const orgRows =
      deptOrgIds.length > 0
        ? await this.prisma.orgs.findMany({
            where: { id: { in: deptOrgIds } },
            select: { id: true, name: true },
          })
        : [];
    const deptDistribution = this.buildDeptDistribution(
      orgRows,
      currentWarningGroups.map((item: any) => ({
        org_id: item.org_id,
        level: item.level,
        count: Number(item._count?._all || 0),
      })),
    );

    const studentIds = [...new Set(activeCases.map((item: any) => item.student_id?.toString()).filter(Boolean))].map((item: any) => BigInt(item));
    const orgIds = [...new Set(activeCases.map((item: any) => item.org_id?.toString()).filter(Boolean))].map((item: any) => BigInt(item));
    const [students, caseOrgs] = await Promise.all([
      studentIds.length > 0
        ? this.prisma.student_profiles.findMany({
            where: { id: { in: studentIds } },
            include: { users: true },
          })
        : Promise.resolve([]),
      orgIds.length > 0
        ? this.prisma.orgs.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const studentMap = new Map(students.map((item: any) => [item.id.toString(), item]));
    const orgMap = new Map(caseOrgs.map((item: any) => [item.id.toString(), item]));
    const statusLabels: Record<string, string> = {
      pending_assignment: '待分配',
      pending_intervention: '待干预',
      in_progress: '处理中',
      completed: '处理完成',
      resolved: '已解除',
    };
    const statusTypes: Record<string, string> = {
      pending_assignment: 'danger',
      pending_intervention: 'warning',
      in_progress: 'info',
      completed: 'success',
      resolved: 'info',
    };

    const studentsList = activeCases.map((item: any) => {
      const student = studentMap.get(item.student_id.toString()) as any;
      const org = orgMap.get(item.org_id.toString()) as any;
      return {
        id: student?.student_no || '',
        name: student?.users?.name || '未知学生',
        department: org?.name || '未知学院',
        riskScore: Number(item.risk_score || 0),
        warningCount: Number((item.warning_summary_json as any)?.active_warning_count || 0),
        lastWarning: item.latest_warning_at ? new Date(item.latest_warning_at).toISOString().split('T')[0].replace(/-/g, '/') : '',
        status: statusLabels[item.status] || item.status,
        statusType: statusTypes[item.status] || 'info',
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        overview: {
          totalWarnings: summary.totalWarnings,
          redWarnings: summary.seriousWarnings,
          yellowWarnings: summary.generalWarnings,
          resolvedWarnings: summary.resolvedWarnings,
          pendingWarnings: summary.pendingWarnings,
          highRiskCount: activeCases.length,
          totalGrowth: this.calculateGrowth(summary.totalWarnings, previousSummary.totalWarnings),
          redGrowth: this.calculateGrowth(summary.seriousWarnings, previousSummary.seriousWarnings),
          yellowGrowth: this.calculateGrowth(summary.generalWarnings, previousSummary.generalWarnings),
          resolvedGrowth: this.calculateGrowth(summary.resolvedWarnings, previousSummary.resolvedWarnings),
          pendingGrowth: this.calculateGrowth(summary.pendingWarnings, previousSummary.pendingWarnings),
          highRiskGrowth: this.calculateGrowth(activeCases.length, previousCaseCount),
        },
        trend,
        students: studentsList,
        deptDistribution,
      },
    };
  }

  @Get('system')
  @Permissions('stats:view')
  async getSystemStats(@Req() req: any) {
    const userId = BigInt(req.user.sub);
    const scope = await this.getPermissionFilter(userId);
    const warningsWhere = {
      ...scope.filter,
      created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    };
    const recentWeekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [warningGroups, recentTrendWarnings, studentCounts, weeklyTrend] = await Promise.all([
      this.prisma.warnings.groupBy({
        by: ['org_id', 'level', 'status'],
        where: warningsWhere,
        _count: { _all: true },
      }),
      this.prisma.warnings.findMany({
        where: {
          ...scope.filter,
          created_at: { gte: recentWeekStart },
        },
        select: {
          created_at: true,
          org_id: true,
        },
      }),
      this.prisma.student_profiles.groupBy({
        by: ['org_id'],
        where: this.buildStudentWhere(scope),
        _count: { id: true },
      }),
      this.buildWeeklyWarningTrend(scope),
    ]);

    const orgIds = [
      ...new Set(
        warningGroups
          .map((item: any) => item.org_id?.toString())
          .filter(Boolean),
      ),
    ].map((item: any) => BigInt(item));
    const orgRows = orgIds.length > 0
      ? await this.prisma.orgs.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];

    const orgMap = new Map<string, { department: string; studentCount: number; warningCount: number; redCount: number; yellowCount: number; resolvedCount: number; trend: number[] }>();
    orgRows.forEach((org: { id: bigint; name: string }) => {
      orgMap.set(org.id.toString(), {
        department: org.name,
        studentCount: 0,
        warningCount: 0,
        redCount: 0,
        yellowCount: 0,
        resolvedCount: 0,
        trend: [0, 0, 0, 0, 0, 0, 0],
      });
    });

    studentCounts.forEach((item: any) => {
      if (!item.org_id) return;
      const key = item.org_id.toString();
      const current = orgMap.get(key) || {
        department: '未知学院',
        studentCount: 0,
        warningCount: 0,
        redCount: 0,
        yellowCount: 0,
        resolvedCount: 0,
        trend: [0, 0, 0, 0, 0, 0, 0],
      };
      current.studentCount = Number(item._count.id || 0);
      orgMap.set(key, current);
    });

    warningGroups.forEach((warning: any) => {
      const key = warning.org_id.toString();
      const current = orgMap.get(key) || {
        department: '未知学院',
        studentCount: 0,
        warningCount: 0,
        redCount: 0,
        yellowCount: 0,
        resolvedCount: 0,
        trend: [0, 0, 0, 0, 0, 0, 0],
      };
      const count = Number(warning._count?._all || 0);
      if (String(warning.status || '') === 'closed') {
        current.resolvedCount += count;
        orgMap.set(key, current);
        return;
      }

      current.warningCount += count;
      if (['red', 'severe', 'high', 'critical'].includes(warning.level)) current.redCount += count;
      else if (['yellow', 'orange', 'low'].includes(warning.level)) current.yellowCount += count;
      orgMap.set(key, current);
    });

    recentTrendWarnings.forEach((warning: any) => {
      const key = warning.org_id.toString();
      const current = orgMap.get(key);
      if (!current) {
        return;
      }
      const daysAgo = Math.floor((Date.now() - new Date(warning.created_at).getTime()) / (24 * 60 * 60 * 1000));
      if (daysAgo >= 0 && daysAgo < 7) {
        current.trend[6 - daysAgo] += 1;
      }
    });

    const summary = this.summarizeGroupedWarnings(warningGroups as any);
    const slaStats = await this.querySlaStats(
      scope,
      warningsWhere.created_at.gte,
      summary.totalWarnings,
    );
    const avgResponse = slaStats.avgHours > 0 ? Math.round((slaStats.avgHours / 24) * 10) / 10 : 0;

    const orgPerformance = Array.from(orgMap.values())
      .map((org) => {
        const maxTrend = Math.max(...org.trend, 1);
        const trendPoints = org.trend.map((value: number, index: number) => {
          const x = index * 13 + 5;
          const y = 35 - (value / maxTrend) * 30;
          return `${x},${y}`;
        }).join(' ');
        const resolveRate = org.warningCount > 0 ? Math.round((org.resolvedCount / org.warningCount) * 100) : 0;
        return {
          department: org.department,
          studentCount: org.studentCount,
          warningCount: org.warningCount,
          redCount: org.redCount,
          yellowCount: org.yellowCount,
          resolveRate,
          avgResponse,
          trendPoints,
          status: resolveRate >= 75 ? '达标' : '待改善',
        };
      })
      .sort((a, b) => b.warningCount - a.warningCount);

    return {
      code: 0,
      message: 'ok',
      data: {
        warningStats: {
          yellow: summary.yellow,
          orange: summary.orange,
          red: summary.red,
          severe: summary.severe,
        },
        totalWarnings: summary.totalWarnings,
        slaComplianceRate: slaStats.rate,
        slaStats: slaStats.values,
        orgPerformance,
        weeklyTrend,
      },
    };
  }
}

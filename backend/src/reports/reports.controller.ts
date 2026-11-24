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
import { MinioService } from '../shared/minio.service';
import { ExportProcessorService } from './export-processor.service';
import {
  getAcademicWeekInfo,
  getAcademicWeekInfoByNumber,
  resolveSemesterStartDate,
} from '../shared/academic-calendar.util';

dayjs.extend(utc);
dayjs.extend(timezone);

const REPORT_TZ = 'Asia/Shanghai';

/**
 * 单个时间窗内**参与统计的预警行数上限**（性能修复）
 *
 * 实测故障：
 *   GET /admin/reports/overview 耗时 **56310ms**（响应体仅 401 字节），
 *   经 nginx 访问时直接 504 —— nginx 默认 proxy_read_timeout 是 60s，
 *   差 3.7 秒就会踩线，压测时必然超时。
 *
 * 根因：
 *   findWarningsForReport() 的 where 只按 created_at 过滤，**没有 take**。
 *   生产规模下 warnings 有 16.2 万行，一个学期窗口就能捞出 5 万行；
 *   overview 又同时跑 4 个窗口（day/week/month/term），并把 term 窗口的
 *   全部行喂给 buildWarningContext() 去查学生信息。
 *   于是每次请求都要把 5 万+ 行完整对象（含 trigger_detail_json）
 *   从 MySQL 取回、经 Prisma 反序列化，再在 Node 里建 Map。
 *
 * 修法：
 *   按 created_at 倒序取最近 N 行。created_at 上有索引
 *   （warnings_created_at_status_idx），所以这是一次索引范围扫描 + LIMIT，
 *   不再全量物化。
 *
 * 语义影响（已在 API 文档中说明）：
 *   统计口径由「区间内全部预警」变为「区间内最近 5000 条预警」。
 *   对日报/周报/月报这类区间本来就只有几百到几千行的场景**无影响**；
 *   只有学期级（term）这种累计数万行的窗口会被截断，
 *   此时数值代表"最近 5000 条的分布"，而不是全学期总数。
 *   这样选择是因为本接口返回的是**分布/排行（distribution ranking）**，
 *   用最近窗口更能反映当前态势，且响应时间从 56s 降到毫秒级。
 */
const REPORT_WARNING_SCAN_LIMIT = 5000;

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
    private readonly minio: MinioService,
    private readonly exportProcessor: ExportProcessorService,
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

  /**
   * 后台补算统计 —— **已停用**
   *
   * 实测教训：把统计聚合改成 fire-and-forget 之后，导出接口反而更慢
   * （23s → 28~53s）。原因：聚合是 CPU + 数据库密集操作，
   * fire-and-forget 并不让它"不耗资源"，只是把开销挪到后台与请求竞争
   * 同一条事件循环和同一个连接池；连续点击还会不断堆叠任务。
   *
   * 而这些统计**本来就不需要**：导出所需的全部数据由
   * ExportProcessorService 在 worker 进程里独立查询并生成 xlsx，
   * 响应体也不再返回 stats。因此这里直接不计算 —— 入队即刻返回。
   *
   * 保留方法签名以便将来需要"预热缓存"时按需启用（默认关闭）。
   */
  private refreshReportStatsInBackground(
    _label: string,
    _rangeLabel: string | undefined,
    _compute: () => Promise<any>,
  ) {
    // 有意为空：见上方说明。若确需预热，请改为写入独立队列由 worker 消费。
    return;
  }

  /**
   * 创建导出任务 —— P1-7 修复
   *
   * 修复前：直接写 `status: 'completed'`，从不出现 queued/running，
   * **没有 worker 消费**，`file_id`/`error_msg` 从不写入 → 属"伪异步"。
   *
   * 现在只入队（status='queued'），由 ExportProcessorService 的 @Cron
   * 在工作进程中领取并生成 xlsx、上传 MinIO、回填 file_id、置 success/failed。
   */
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
        // 入队态：等待 worker 处理（不再伪造成 completed）
        status: 'queued',
        updated_at: new Date(),
      },
    });
  }

  /**
   * 立即触发一次导出生成，最多同步等待 2 秒。
   * 若 2 秒内完成（常见于常规数据量），请求直接返回 completed；
   * 若超过 2 秒则后台继续执行，配合前端轮询和 @Cron 兜底避免阻塞接口。
   */
  private async triggerExportJob(exportJob: any) {
    const processPromise = this.exportProcessor.processOne(exportJob).catch((err) => {
      this.logger.warn(
        `[导出] 即时触发失败，等待定时任务重试：id=${exportJob.id.toString()} err=${err?.message || err}`,
      );
      return null;
    });

    await Promise.race([
      processPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]);

    const latest = await this.prisma.export_jobs.findUnique({
      where: { id: exportJob.id },
      select: { status: true },
    });
    return latest?.status || exportJob.status;
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

  /**
   * 精确计数（性能修复的配套）
   *
   * findWarningsForReport 带 take 后，用返回数组的 length 当"总数"会**顶到上限**
   * （实测四个窗口全部显示 5000），把截断暴露成错误的业务数字 —— 比慢更糟。
   *
   * 因此汇总数字改走 count()：
   *   - COUNT(*) 可以只走 warnings_created_at_status_idx 做索引扫描，
   *     不需要取回行数据、也不经 Prisma 反序列化，比 findMany 便宜一到两个数量级；
   *   - 返回值语义回到"区间内全部预警数"，与修复前一致。
   *
   * 明细/分布仍用带 take 的 findWarningsForReport（那才是真正贵的地方）。
   */
  private async countWarningsForReport(
    range: ReportRange,
    status: string | undefined,
    scope: ReportScope,
    selectedOrgId?: bigint | null,
  ) {
    const where = this.buildWarningWhere(range, status, scope, selectedOrgId);
    if (!where) {
      return 0;
    }
    return this.prisma.warnings.count({ where });
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
      // 性能修复：必须带 take，否则学期窗口会全量物化数万行（见常量注释）
      take: REPORT_WARNING_SCAN_LIMIT,
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

        // 明细/分布：受 REPORT_WARNING_SCAN_LIMIT 限制（贵）
        // 精确计数：走 count()，不受限制（便宜）—— 汇总数字必须准确
        const [
          dailyWarnings,
          weeklyWarnings,
          monthlyWarnings,
          semesterWarnings,
          history,
          dailyTotal,
          weeklyTotal,
          monthlyTotal,
          semesterTotal,
        ] = await Promise.all([
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
          this.countWarningsForReport(dailyRange, normalizedStatus, scope, normalizedOrgId),
          this.countWarningsForReport(weeklyRange, normalizedStatus, scope, normalizedOrgId),
          this.countWarningsForReport(monthlyRange, normalizedStatus, scope, normalizedOrgId),
          this.countWarningsForReport(semesterRange, normalizedStatus, scope, normalizedOrgId),
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
            // 精确总数（count()，不受 scan limit 影响）
            todayWarnings: dailyTotal,
            weeklyWarnings: weeklyTotal,
            monthlyWarnings: monthlyTotal,
            semesterWarnings: semesterTotal,
            exportCount: history.length,
            // 明确告知调用方：分布类字段只统计了最近 N 条，
            // 前端据此可显示"基于最近 5000 条"的提示，避免误读为全量分布。
            distributionSampleLimit: REPORT_WARNING_SCAN_LIMIT,
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
      void this.refreshReportStatsInBackground('daily', range.startLabel, () =>
        this.getDailyStats(range.startLabel, normalizedStatus, scope, normalizedOrgId),
      );

      const exportJob = await this.createExportJob(
        userId,
        'daily',
        { date: range.startLabel, status: normalizedStatus || 'all', org_id: normalizedOrgId?.toString() || '' },
        scope,
      );
      const currentStatus = await this.triggerExportJob(exportJob);

      return {
        code: 0,
        message: 'ok',
        data: {
          export_job_id: exportJob.id.toString(),
          status: currentStatus,
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
      // 注意：这里**不再** await getWeeklyStats。
      // 它是本接口原本 28s 耗时的真正来源（30k 预警下需去重 + 构建上下文），
      // 而导出所需数据完全由 worker 在 ExportProcessorService 中独立查询生成。
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
      const currentStatus = await this.triggerExportJob(exportJob);

      return {
        code: 0,
        message: 'ok',
        data: {
          export_job_id: exportJob.id.toString(),
          status: currentStatus,
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
      void this.refreshReportStatsInBackground('monthly', range.monthLabel, () =>
        this.getMonthlyStats(range.monthLabel, normalizedStatus, scope, normalizedOrgId),
      );

      const exportJob = await this.createExportJob(
        userId,
        'monthly',
        { month: range.monthLabel, status: normalizedStatus || 'all', org_id: normalizedOrgId?.toString() || '' },
        scope,
      );
      const currentStatus = await this.triggerExportJob(exportJob);

      return {
        code: 0,
        message: 'ok',
        data: {
          export_job_id: exportJob.id.toString(),
          status: currentStatus,
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
      void this.refreshReportStatsInBackground('semester', range.semesterLabel, () =>
        this.getSemesterStats(range.semesterLabel, normalizedStatus, scope, normalizedOrgId),
      );

      const exportJob = await this.createExportJob(
        userId,
        'semester',
        { semester: range.semesterLabel, status: normalizedStatus || 'all', org_id: normalizedOrgId?.toString() || '' },
        scope,
      );
      const currentStatus = await this.triggerExportJob(exportJob);

      return {
        code: 0,
        message: 'ok',
        data: {
          export_job_id: exportJob.id.toString(),
          status: currentStatus,
        },
      };
    } catch (error: any) {
      this.logError(error, 'generateSemesterReport');
      return { code: 500, message: '学期报表生成失败: ' + error.message };
    }
  }

  /**
   * 导出历史：按数据范围可见，而不是只看自己创建的。
   *
   * 之前固定 `creator_user_id = 当前用户`，导致换管理员登录后历史全部消失
   * （库里 100+ 条记录只返回 1 条）。现在：
   *  - 全校范围（sys_admin / school）→ 全部任务
   *  - 学院 / 班级 / 本人范围 → 自己创建的 + 落在自己范围内的任务
   */
  @Get('history')
  @Permissions('report:export')
  async getExportHistory(@Req() req: any) {
    try {
      const userId = this.getRequestUserId(req);
      const scope = await this.resolveReportScope(userId);

      if (scope.type === 'none') {
        return { code: 0, message: 'ok', data: { list: [], total: 0 } };
      }

      const where: any =
        scope.type === 'all'
          ? {}
          : {
              OR: [
                { creator_user_id: userId },
                ...(scope.orgIds.length
                  ? [{ scope_type: 'org', scope_id: { in: scope.orgIds } }]
                  : []),
                ...(scope.classIds.length
                  ? [{ scope_type: 'class', scope_id: { in: scope.classIds } }]
                  : []),
                ...(scope.studentIds.length
                  ? [{ scope_type: 'self', scope_id: { in: scope.studentIds } }]
                  : []),
              ],
            };

      const [history, historyTotal] = await Promise.all([
        this.prisma.export_jobs.findMany({
          where,
          orderBy: { created_at: 'desc' },
          take: 50,
        }),
        this.prisma.export_jobs.count({ where }),
      ]);

      const creatorIds = Array.from(
        new Set(history.map((item: any) => item.creator_user_id?.toString()).filter(Boolean)),
      ).map((id: any) => BigInt(id));
      const creators = creatorIds.length
        ? await this.prisma.users.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, name: true },
          })
        : [];
      const creatorNameMap = new Map(
        creators.map((user: any) => [user.id.toString(), user.name]),
      );

      const reportTypeLabels: Record<string, string> = {
        daily: '日报表',
        weekly: '周报表',
        monthly: '月报表',
        semester: '学期报表',
        term: '学期报表',
        warning_list: '预警清单',
        notify_success: '通知送达',
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
            errorMsg: item.error_msg || '',
            creatorName:
              creatorNameMap.get(item.creator_user_id?.toString()) || '未知用户',
            isMine: item.creator_user_id === userId,
            fileName: `${reportTypeLabels[item.report_type] || '报表'}-${item.created_at
              .toLocaleString()
              .replace(/[\/:]/g, '-')}.xlsx`,
          })),
          total: historyTotal,
        },
      };
    } catch (error: any) {
      this.logError(error, 'getExportHistory');
      return { code: 500, message: '获取导出历史失败' };
    }
  }

  /** 判断当前用户能否访问某个导出任务（本人 / 全校 / 范围内） */
  private async canAccessExportJob(userId: bigint, job: any): Promise<boolean> {
    if (!job) return false;
    if (job.creator_user_id === userId) return true;

    const scope = await this.resolveReportScope(userId);
    if (scope.type === 'all') return true;
    if (scope.type === 'none') return false;

    const scopeType = String(job.scope_type || '');
    const scopeId = job.scope_id as bigint | null;
    if (!scopeId) return false;

    if (scopeType === 'org') return scope.orgIds.some((id) => id === scopeId);
    if (scopeType === 'class') return scope.classIds.some((id) => id === scopeId);
    if (scopeType === 'self') return scope.studentIds.some((id) => id === scopeId);
    return false;
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

      if (!(await this.canAccessExportJob(userId, job))) {
        return { code: 403, message: '无权删除该报表（不在你的数据范围内）' };
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

      if (!(await this.canAccessExportJob(userId, job))) {
        return res.status(403).json({ code: 403, message: '无权下载该报表（不在你的数据范围内）' });
      }

      // P1-7：若 worker 已生成真实 xlsx 文件（file_id 已回填），
      // 优先直接下发该文件；否则回退到"下载时重新查库生成 CSV"的旧行为，
      // 保证历史任务与尚未处理完的任务仍可下载。
      // 兼容两种历史口径：'completed'（统一后）与 'success'（旧数据）。
      if (
        (job.status === 'completed' || job.status === 'success') &&
        job.file_id
      ) {
        const fileRow = await this.prisma.files.findUnique({
          where: { id: job.file_id },
        });
        if (fileRow) {
          // ----------------------------------------------------------------
          // 本轮修复：**只把"取对象"放进 try**，发送响应放到 try 之外。
          //
          // 修复前的写法是把 `res.end(buffer)` 也包在同一个 try 里：
          //   try { buffer = await getBuffer(...); setHeader(...); return res.end(buffer); }
          //   catch { logger.warn('回退按需生成'); }   // ← 继续往下走 CSV 兜底
          //
          // 于是"取对象成功、但发送到一半失败"时（实测在 ~245KB 处断开），
          // 异常被当成"对象缺失"，代码继续执行 CSV 兜底分支，
          // 而那时响应头早已发出 —— 兜底里的 res.status(...).json() 再次抛错，
          // 最终被全局过滤器记成 **HTTP 500**，客户端只拿到半截文件。
          //
          // 正确语义：`getBuffer` 失败（对象缺失/权限）才该回退生成；
          // 一旦开始发送，就只能记录错误并结束，绝不能再走 fallback。
          // ----------------------------------------------------------------
          let buffer: Buffer;
          try {
            buffer = await this.minio.getBuffer(
              this.minio.getUploadBucket(),
              fileRow.file_key,
            );
          } catch (error: any) {
            buffer = null as any;
            this.logger.warn(
              `下载导出文件失败，回退按需生成：job=${id} err=${error?.message || error}`,
            );
          }

          if (buffer) {
            res.setHeader(
              'Content-Type',
              fileRow.mime_type ||
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            );
            res.setHeader(
              'Content-Disposition',
              `attachment; filename*=UTF-8''${encodeURIComponent(fileRow.file_name)}`,
            );
            res.setHeader('Content-Length', String(buffer.length));

            // 发送阶段单独兜底：此时响应头已发出，不能再写 JSON
            try {
              await new Promise<void>((resolve, reject) => {
                res.once('error', reject);
                res.end(buffer, () => resolve());
              });
            } catch (sendError: any) {
              this.logger.warn(
                `导出文件下发中断：job=${id} bytes=${buffer.length} err=${sendError?.message || sendError}`,
              );
            }
            return;
          }
        }
      }

      // 任务尚未完成时给出明确状态，避免前端拿到空 CSV 一头雾水
      if (job.status === 'queued' || job.status === 'running') {
        return res.status(202).json({
          code: 202,
          message: '报表正在生成中，请稍后重试',
          data: { status: job.status },
        });
      }
      if (job.status === 'failed') {
        return res.status(500).json({
          code: 500,
          message: `报表生成失败：${job.error_msg || '未知原因'}`,
          data: { status: job.status },
        });
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

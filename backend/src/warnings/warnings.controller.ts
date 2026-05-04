import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { AuthGuard } from '../shared/auth.guard';
import { PrismaService } from '../shared/prisma.service';
import { Roles, RolesGuard } from '../shared/roles.guard';
import { WarningService } from '../warning/warning.service';
import { WarningProcessingService } from '../warning/warning-processing.service';
import { WarningSnapshotService } from '../warning/warning-snapshot.service';
import { ConfigService } from '../config/config.service';
import { getHeadTeacherClassScopeIds } from '../shared/head-teacher-scope.util';
import { serializeForAudit } from '../shared/json.util';
import { getAcademicWeekInfo, resolveSemesterStartDate } from '../shared/academic-calendar.util';

class RunDailyWarningDto {
  date!: string;
}

type WarningScopeContext = {
  roles: string[];
  scopedOrgIds: bigint[];
  scopedClassIds: bigint[];
  studentId?: bigint;
};

const DEFAULT_TZ = 'Asia/Shanghai';
const ABNORMAL_ATTENDANCE_STATUSES = ['late', 'absent', 'early_leave'];
const CLASS_VIEW_STUDENTS_DEFAULT_PAGE_SIZE = 50;
const CLASS_VIEW_STUDENTS_MAX_PAGE_SIZE = 100;
const CLASS_VIEW_DETAIL_WARNING_LIMIT = 200;
dayjs.extend(utc);
dayjs.extend(timezone);

@Controller('warnings')
@UseGuards(AuthGuard, RolesGuard)
export class WarningsController {
  private readonly logger = new Logger(WarningsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly warningService: WarningService,
    private readonly warningProcessingService: WarningProcessingService,
    private readonly warningSnapshotService: WarningSnapshotService,
    private readonly configService: ConfigService,
  ) {}

  @Post('jobs/run_daily_warning')
  @Roles('sys_admin', 'teaching_admin')
  async runDaily(@Body() dto: RunDailyWarningDto, @Req() req: any) {
    const userId = this.getRequestUserId(req);
    const result = await this.warningService.runDailyWarning(dto.date);

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: 'warning.run_daily',
        entity_type: 'warning',
        entity_id: 0n,
        after_json: serializeForAudit({ date: dto.date, result }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: 'ok',
      data: result,
      trace_id: req.trace_id,
    };
  }

  @Post('test/create-absent-records')
  @Roles('sys_admin')
  async createTestAbsentRecords(@Req() req: any) {
    const students = await this.prisma.student_profiles.findMany({
      select: {
        id: true,
        class_id: true,
        org_id: true,
      },
    });

    if (students.length === 0) {
      return {
        code: 0,
        message: '没有找到学生数据',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const today = new Date();
    let createdCount = 0;

    for (const student of students) {
      await this.prisma.daily_records.create({
        data: {
          student_id: student.id,
          record_date: today,
          class_id: student.class_id,
          org_id: student.org_id || 0n,
          attendance_status: 'absent',
          homework_status: 'unknown',
          source: 'manual',
          approved_status: 'approved',
        },
      });
      createdCount += 1;
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        date: today.toISOString().slice(0, 10),
        records: createdCount,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('class-view/students')
  @Roles('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin', 'teacher')
  async listClassViewStudents(
    @Query('org_id') orgId: string,
    @Query('class_id') classId: string,
    @Query('scope') scope = 'active',
    @Query('keyword') keyword = '',
    @Query('page') page = '1',
    @Query('page_size') pageSize = String(CLASS_VIEW_STUDENTS_DEFAULT_PAGE_SIZE),
    @Req() req: any,
  ) {
    const startedAt = Date.now();
    const userId = this.getRequestUserId(req);
    const pageNumber = this.normalizePageNumber(page);
    const normalizedPageSize = this.normalizePageSize(pageSize, CLASS_VIEW_STUDENTS_DEFAULT_PAGE_SIZE, CLASS_VIEW_STUDENTS_MAX_PAGE_SIZE);
    const scopeContext = await this.resolveWarningScopeContext(userId);
    const resolvedClassId = await this.resolveScopedClassId(classId, orgId, scopeContext);

    if (!resolvedClassId) {
      return {
        code: 0,
        message: 'ok',
        data: {
          class_id: '',
          class_name: '',
          org_id: '',
          org_name: '',
          week_label: (await this.getCurrentWeekInfo()).weekLabel,
          students: [],
          total: 0,
          page: pageNumber,
          page_size: normalizedPageSize,
          has_more: false,
        },
        trace_id: req.trace_id,
      };
    }

    const cacheKey = await this.warningSnapshotService.buildClassViewStudentsCacheKey(
      userId,
      resolvedClassId,
      scope,
      keyword,
      pageNumber,
      normalizedPageSize,
    );
    const cachedData = await this.warningSnapshotService.getCachedClassViewStudents(cacheKey);
    if (cachedData) {
      this.logger.log(
        `[预警接口] class-view/students class=${resolvedClassId.toString()} cached=true cost=${Date.now() - startedAt}ms`,
      );
      return {
        code: 0,
        message: 'ok',
        data: cachedData,
        trace_id: req.trace_id,
      };
    }

    const classInfo = await this.prisma.classes.findUnique({
      where: { id: resolvedClassId },
      include: {
        orgs: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!classInfo) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const normalizedKeyword = String(keyword || '').trim();
    const pageStart = (pageNumber - 1) * normalizedPageSize;
    const queryParams: any[] = [resolvedClassId];
    const whereParts = [
      'sp.class_id = ?',
      "sp.status = 'active'",
    ];

    if (scopeContext.studentId) {
      whereParts.push('sp.id = ?');
      queryParams.push(scopeContext.studentId);
    }

    if (normalizedKeyword) {
      const likeKeyword = `%${normalizedKeyword.replace(/[\\%_]/g, (matched) => `\\${matched}`)}%`;
      whereParts.push("(sp.student_no LIKE ? ESCAPE '\\\\' OR sp.major LIKE ? ESCAPE '\\\\' OR u.name LIKE ? ESCAPE '\\\\')");
      queryParams.push(likeKeyword, likeKeyword, likeKeyword);
    }

    queryParams.push(normalizedPageSize + 1, pageStart);
    const rawRows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT
         sp.id,
         sp.student_no,
         sp.gender,
         sp.major,
         u.name AS student_name,
         sws.active_warning_count,
         sws.closed_warning_count,
         sws.all_warning_count,
         sws.active_highest_level,
         sws.closed_highest_level,
         sws.all_highest_level,
         sws.active_last_warning_at,
         sws.closed_last_warning_at,
         sws.all_last_warning_at
       FROM student_profiles sp
       INNER JOIN users u ON u.id = sp.user_id
       LEFT JOIN student_warning_snapshots sws ON sws.student_id = sp.id
       WHERE ${whereParts.join(' AND ')}
       ORDER BY sp.student_no ASC, sp.id ASC
       LIMIT ? OFFSET ?`,
      ...queryParams,
    );
    const hasMore = rawRows.length > normalizedPageSize;
    const pageStudents = rawRows.slice(0, normalizedPageSize);

    const normalizedScope = String(scope || 'active').trim().toLowerCase();
    const students = pageStudents.map((student: any) => {
      const warningCount = Number(
        normalizedScope === 'history'
          ? student.closed_warning_count || 0
          : normalizedScope === 'all'
            ? student.all_warning_count || 0
            : student.active_warning_count || 0,
      );
      const highestLevel = warningCount > 0
        ? normalizedScope === 'history'
          ? student.closed_highest_level || ''
          : normalizedScope === 'all'
            ? student.all_highest_level || ''
            : student.active_highest_level || ''
        : '';
      const lastWarningAt = warningCount > 0
        ? normalizedScope === 'history'
          ? student.closed_last_warning_at || null
          : normalizedScope === 'all'
            ? student.all_last_warning_at || null
            : student.active_last_warning_at || null
        : null;
      return {
        id: student.id.toString(),
        student_no: student.student_no || '',
        student_name: student.student_name || '未知学生',
        gender: student.gender || '',
        major: student.major || '',
        warning_count: warningCount,
        highest_level: highestLevel,
        last_warning_at: lastWarningAt,
        processing_status: '',
        processing_text: '',
      };
    });

    const approximateTotal = pageStart + students.length + (hasMore ? 1 : 0);

    const responseData = {
      class_id: classInfo.id.toString(),
      class_name: classInfo.class_name || '',
      org_id: classInfo.org_id.toString(),
      org_name: classInfo.orgs?.name || '',
      week_label: (await this.getCurrentWeekInfo()).weekLabel,
      students,
      total: approximateTotal,
      page: pageNumber,
      page_size: normalizedPageSize,
      has_more: hasMore,
    };
    this.logger.log(
      `[预警接口] class-view/students class=${resolvedClassId.toString()} students=${students.length} hasMore=${hasMore} page=${pageNumber} cost=${Date.now() - startedAt}ms`,
    );
    await this.warningSnapshotService.setCachedClassViewStudents(cacheKey, responseData);

    return {
      code: 0,
      message: 'ok',
      data: responseData,
      trace_id: req.trace_id,
    };
  }

  @Get('class-view/students/:id/detail')
  @Roles('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin', 'teacher')
  async getClassViewStudentDetail(
    @Param('id') id: string,
    @Query('scope') scope = 'active',
    @Query('view') view = 'day',
    @Req() req: any,
  ) {
    const startedAt = Date.now();
    const studentId = BigInt(id);
    const userId = this.getRequestUserId(req);
    const scopeContext = await this.resolveWarningScopeContext(userId);
    const cacheKey = await this.warningSnapshotService.buildClassViewStudentDetailCacheKey(
      userId,
      studentId,
      scope,
      view,
    );
    const cachedData = await this.warningSnapshotService.getCachedClassViewStudentDetail(cacheKey);
    if (cachedData) {
      this.logger.log(
        `[预警接口] class-view/student-detail student=${studentId.toString()} cached=true cost=${Date.now() - startedAt}ms`,
      );
      return {
        code: 0,
        message: 'ok',
        data: cachedData,
        trace_id: req.trace_id,
      };
    }

    const studentQueryStartedAt = Date.now();
    const student = await this.prisma.student_profiles.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        student_no: true,
        gender: true,
        major: true,
        class_id: true,
        org_id: true,
        users: {
          select: {
            name: true,
          },
        },
        classes: {
          select: {
            class_name: true,
            org_id: true,
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
    const studentQueryCost = Date.now() - studentQueryStartedAt;

    if (!student) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!this.canAccessStudent(scopeContext, student)) {
      return await this.emptyClassViewDetail(req.trace_id);
    }

    const summaryStartedAt = Date.now();
    const [period, snapshot] = await Promise.all([
      this.resolveDetailViewPeriod(view),
      (this.prisma as any).student_warning_snapshots.findUnique({
        where: { student_id: student.id },
      }),
    ]);
    const summaryCost = Date.now() - summaryStartedAt;

    const normalizedScope = String(scope || 'active').trim().toLowerCase();
    const warningSummary =
      normalizedScope === 'history'
        ? {
            highestLevel: Number(snapshot?.closed_warning_count || 0) > 0 ? snapshot?.closed_highest_level || '' : '',
            warningCount: Number(snapshot?.closed_warning_count || 0),
            lastWarningAt:
              Number(snapshot?.closed_warning_count || 0) > 0 ? snapshot?.closed_last_warning_at || null : null,
          }
        : normalizedScope === 'all'
          ? {
              highestLevel: Number(snapshot?.all_warning_count || 0) > 0 ? snapshot?.all_highest_level || '' : '',
              warningCount: Number(snapshot?.all_warning_count || 0),
              lastWarningAt:
                Number(snapshot?.all_warning_count || 0) > 0 ? snapshot?.all_last_warning_at || null : null,
            }
          : {
              highestLevel:
                Number(snapshot?.active_warning_count || 0) > 0 ? snapshot?.active_highest_level || '' : '',
              warningCount: Number(snapshot?.active_warning_count || 0),
              lastWarningAt:
                Number(snapshot?.active_warning_count || 0) > 0 ? snapshot?.active_last_warning_at || null : null,
            };

    const processingState: { status?: string; text?: string } | null = null;

    if (warningSummary.warningCount === 0) {
      const responseData = {
        student: {
          id: student.id.toString(),
          student_no: student.student_no || '',
          student_name: student.users?.name || '未知学生',
          gender: student.gender || '',
          major: student.major || '',
          class_id: student.class_id.toString(),
          class_name: student.classes?.class_name || '',
          org_id: student.classes?.org_id?.toString?.() || student.org_id?.toString?.() || '',
          org_name: student.classes?.orgs?.name || '',
        },
        summary: {
          warning_count: warningSummary.warningCount,
          highest_level: warningSummary.highestLevel || '',
          last_warning_at: warningSummary.lastWarningAt,
          processing_status: '',
          processing_text: '',
        },
        view: period.key,
        view_label: period.label,
        warning_items_limit: CLASS_VIEW_DETAIL_WARNING_LIMIT,
        warning_items_truncated: false,
        course_groups: [],
      };
      this.logger.log(
        `[预警接口] class-view/student-detail student=${student.id.toString()} view=${period.key} groups=0 fastEmpty=true studentMs=${studentQueryCost} summaryMs=${summaryCost} warningsMs=0 cost=${Date.now() - startedAt}ms`,
      );
      await this.warningSnapshotService.setCachedClassViewStudentDetail(cacheKey, responseData);

      return {
        code: 0,
        message: 'ok',
        data: responseData,
        trace_id: req.trace_id,
      };
    }

    const warningsStartedAt = Date.now();
    const warningRows = await this.loadStudentWarnings(student.id, scope, period, CLASS_VIEW_DETAIL_WARNING_LIMIT + 1);
    const warningsCost = Date.now() - warningsStartedAt;
    const warnings = warningRows.slice(0, CLASS_VIEW_DETAIL_WARNING_LIMIT);
    const warningsTruncated = warningRows.length > CLASS_VIEW_DETAIL_WARNING_LIMIT;

    const responseData = {
      student: {
        id: student.id.toString(),
        student_no: student.student_no || '',
        student_name: student.users?.name || '未知学生',
        gender: student.gender || '',
        major: student.major || '',
        class_id: student.class_id.toString(),
        class_name: student.classes?.class_name || '',
        org_id: student.classes?.org_id?.toString?.() || student.org_id?.toString?.() || '',
        org_name: student.classes?.orgs?.name || '',
      },
      summary: {
        warning_count: warningSummary.warningCount,
        highest_level: warningSummary.highestLevel || '',
        last_warning_at: warningSummary.lastWarningAt,
        processing_status: '',
        processing_text: '',
      },
      view: period.key,
      view_label: period.label,
      warning_items_limit: CLASS_VIEW_DETAIL_WARNING_LIMIT,
      warning_items_truncated: warningsTruncated,
      course_groups: this.buildStudentCourseGroups(warnings, scope, null),
    };
    this.logger.log(
      `[预警接口] class-view/student-detail student=${student.id.toString()} view=${period.key} groups=${responseData.course_groups.length} studentMs=${studentQueryCost} summaryMs=${summaryCost} warningsMs=${warningsCost} cost=${Date.now() - startedAt}ms`,
    );
    await this.warningSnapshotService.setCachedClassViewStudentDetail(cacheKey, responseData);

    return {
      code: 0,
      message: 'ok',
      data: responseData,
      trace_id: req.trace_id,
    };
  }

  @Get()
  @Roles('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin')
  async listWarnings(
    @Query('org_id') orgId: string,
    @Query('major') major: string,
    @Query('class_id') classId: string,
    @Query('status') status: string,
    @Query('course_id') courseId: string,
    @Query('level') level: string,
    @Query('scope') scope = 'active',
    @Query('page') page = '1',
    @Query('page_size') pageSize = '20',
    @Req() req: any,
  ) {
    const pageNumber = parseInt(page, 10) || 1;
    const size = parseInt(pageSize, 10) || 20;
    const userId = this.getRequestUserId(req);
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    const roles = userRoles.map((item: any) => item.role);

    const where: any = {};
    where.metric = { not: 'warning_total' };
    const normalizedScope = String(scope || 'active').trim().toLowerCase();
    if (status) {
      where.status = status;
    } else if (normalizedScope === 'history') {
      where.status = { in: ['closed'] };
    } else if (normalizedScope === 'all') {
      // no status limit
    } else {
      where.status = { in: ['open', 'acknowledged'] };
    }
    if (level) {
      where.level = level;
    }

    const scopedOrgIds: bigint[] = [];
    const scopedClassIds: bigint[] = [];

    if (roles.includes('sys_admin') || roles.includes('dean') || roles.includes('teaching_admin')) {
      // full access
    } else if (roles.includes('student_admin')) {
      const studentAdminRole = userRoles.find((item: any) => item.role === 'student_admin');
      if (!studentAdminRole?.scope_id) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }
      scopedOrgIds.push(studentAdminRole.scope_id);
    } else if (roles.includes('head_teacher')) {
      const headTeacherClassIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
        activeOnly: true,
      });
      if (headTeacherClassIds.length === 0) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }
      scopedClassIds.push(...headTeacherClassIds);
    } else if (roles.includes('student')) {
      const studentProfile = await this.prisma.student_profiles.findUnique({
        where: { user_id: userId },
        select: { id: true },
      });
      if (!studentProfile) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }
      where.student_id = studentProfile.id;
    } else if (roles.includes('teacher')) {
      const teacherBindings = await this.prisma.teacher_course_bindings.findMany({
        where: { teacher_id: userId },
        select: { class_id: true },
      });
      if (teacherBindings.length === 0) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }
      for (const binding of teacherBindings) {
        scopedClassIds.push(binding.class_id);
      }
    } else {
      return this.emptyWarningList(pageNumber, size, req.trace_id);
    }

    if (scopedOrgIds.length > 0) {
      where.org_id = { in: this.uniqueBigInts(scopedOrgIds) };
    }
    if (scopedClassIds.length > 0) {
      where.class_id = { in: this.uniqueBigInts(scopedClassIds) };
    }

    if (classId) {
      const selectedClassId = BigInt(classId);
      if (scopedClassIds.length > 0 && !scopedClassIds.some((item: any) => item.toString() === selectedClassId.toString())) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }
      where.class_id = selectedClassId;
    } else if (major) {
      const classes = await this.prisma.classes.findMany({
        where: {
          major,
          ...(orgId ? { org_id: BigInt(orgId) } : {}),
          ...(scopedOrgIds.length > 0 ? { org_id: { in: this.uniqueBigInts(scopedOrgIds) } } : {}),
          ...(scopedClassIds.length > 0 ? { id: { in: this.uniqueBigInts(scopedClassIds) } } : {}),
        },
        select: { id: true },
      });

      if (classes.length === 0) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }

      where.class_id = { in: classes.map((item: any) => item.id) };
    } else if (orgId) {
      const selectedOrgId = BigInt(orgId);
      if (scopedOrgIds.length > 0 && !scopedOrgIds.some((item: any) => item.toString() === selectedOrgId.toString())) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }

      const classes = await this.prisma.classes.findMany({
        where: {
          org_id: selectedOrgId,
          ...(scopedClassIds.length > 0 ? { id: { in: this.uniqueBigInts(scopedClassIds) } } : {}),
        },
        select: { id: true },
      });

      if (classes.length === 0) {
        return this.emptyWarningList(pageNumber, size, req.trace_id);
      }

      where.class_id = { in: classes.map((item: any) => item.id) };
    }

    if (courseId && courseId !== 'all') {
      where.course_id = BigInt(courseId);
    }

    const warningRefs = normalizedScope === 'active'
      ? await (this.prisma as any).warning_current_states.findMany({
          where,
          select: {
            id: true,
            student_id: true,
            metric: true,
            created_at: true,
            trigger_detail_json: true,
          },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        })
      : await this.prisma.warnings.findMany({
          where,
          select: {
            id: true,
            student_id: true,
            metric: true,
            created_at: true,
            trigger_detail_json: true,
          },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });

    if (warningRefs.length === 0) {
      return this.emptyWarningList(pageNumber, size, req.trace_id);
    }

    const orderedStudentIds: bigint[] = [];
    const seenStudentIds = new Set<string>();
    for (const item of warningRefs) {
      const studentKey = item.student_id.toString();
      if (seenStudentIds.has(studentKey)) {
        continue;
      }
      seenStudentIds.add(studentKey);
      orderedStudentIds.push(item.student_id);
    }

    const total = orderedStudentIds.length;
    const warningTotal = warningRefs.length;
    const violationTotal = this.computeDedupedViolationTotal(warningRefs);
    const skip = (pageNumber - 1) * size;
    const pageStudentIds = orderedStudentIds.slice(skip, skip + size);
    if (pageStudentIds.length === 0) {
      return this.emptyWarningList(pageNumber, size, req.trace_id);
    }

    const warnings = normalizedScope === 'active'
      ? await (this.prisma as any).warning_current_states.findMany({
          where: {
            ...where,
            student_id: { in: pageStudentIds },
          },
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        })
      : await this.prisma.warnings.findMany({
          where: {
            ...where,
            student_id: { in: pageStudentIds },
          },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });

    const studentIds = this.uniqueBigInts(warnings.map((item: any) => item.student_id));
    const classIds = this.uniqueBigInts(warnings.map((item: any) => item.class_id));
    const processingMap =
      normalizedScope === 'active'
        ? await this.warningProcessingService.getStudentProcessingMap(studentIds)
        : new Map<string, { status: string; text: string }>();

    const [students, classes] = await Promise.all([
      this.prisma.student_profiles.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          users: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          class_name: true,
          org_id: true,
          counselor_user_id: true,
        },
      }),
    ]);

    const teacherIds = this.uniqueBigInts(
      classes.map((item: any) => item.counselor_user_id).filter((item: any): item is bigint => Boolean(item)),
    );
    const orgIds = this.uniqueBigInts([
      ...warnings.map((item: any) => item.org_id),
      ...classes.map((item: any) => item.org_id),
    ]);

    const [teachers, orgs] = await Promise.all([
      teacherIds.length > 0
        ? this.prisma.users.findMany({
            where: { id: { in: teacherIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      orgIds.length > 0
        ? this.prisma.orgs.findMany({
            where: { id: { in: orgIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const studentMap = new Map<string, any>(students.map((item: any) => [item.id.toString(), item]));
    const classMap = new Map<string, any>(classes.map((item: any) => [item.id.toString(), item]));
    const teacherMap = new Map<string, any>(teachers.map((item: any) => [item.id.toString(), item]));
    const orgMap = new Map<string, any>(orgs.map((item: any) => [item.id.toString(), item]));

    const items = warnings.map((warning: any) => {
      const student = studentMap.get(warning.student_id.toString());
      const classInfo = classMap.get(warning.class_id.toString());
      const teacher = classInfo?.counselor_user_id
        ? teacherMap.get(classInfo.counselor_user_id.toString())
        : null;
      const org = orgMap.get((classInfo?.org_id || warning.org_id).toString());
      const detail = (warning.trigger_detail_json as any) || {};
      const displayStatus = this.getDisplayStatus(warning);

      return {
        id: warning.id.toString(),
        student_id: warning.student_id.toString(),
        class_id: warning.class_id.toString(),
        org_id: warning.org_id.toString(),
        level: warning.level,
        metric: warning.metric,
        window: warning.window,
        period_start: warning.period_start,
        period_end: warning.period_end,
        rule_id: warning.rule_id.toString(),
        rule_snapshot_json: warning.rule_snapshot_json,
        trigger_summary: warning.trigger_summary,
        trigger_detail_json: warning.trigger_detail_json,
        course_id: detail.course_id || '',
        course_name: detail.course_name || '',
        violation_count: Number(detail.violation_count || 0),
        status: warning.status,
        display_status: displayStatus.display_status,
        display_status_text: displayStatus.display_status_text,
        created_at: warning.created_at,
        updated_at: warning.updated_at,
        acknowledged_at: warning.acknowledged_at,
        acknowledged_by: warning.acknowledged_by?.toString(),
        closed_at: warning.closed_at,
        closed_by: warning.closed_by?.toString(),
        close_note: warning.close_note,
        student_name: student?.users?.name || '未知学生',
        class_name: classInfo?.class_name || '未知班级',
        teacher_name: teacher?.name || '未知班主任',
        org_name: org?.name || '未知学院',
        processing_status: processingMap.get(warning.student_id.toString())?.status || '',
        processing_text: processingMap.get(warning.student_id.toString())?.text || '',
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        total,
        student_total: total,
        warning_total: warningTotal,
        violation_total: violationTotal,
        page: pageNumber,
        page_size: size,
        items,
      },
      trace_id: req.trace_id,
    };
  }

  @Post(':id/ack')
  @Roles('sys_admin', 'student_admin', 'head_teacher', 'student')
  async ackWarning(@Param('id') id: string, @Req() req: any) {
    const userId = this.getRequestUserId(req);
    const warningId = BigInt(id);
    const warning = await (this.prisma as any).warning_current_states.findUnique({
      where: { id: warningId },
      select: {
        id: true,
        student_id: true,
        class_id: true,
        org_id: true,
      },
    });

    if (!warning) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    const roles = userRoles.map((item: any) => item.role);

    if (!roles.includes('sys_admin')) {
      if (roles.includes('student_admin')) {
        const scopedRole = userRoles.find((item: any) => item.role === 'student_admin');
        if (!scopedRole?.scope_id || scopedRole.scope_id.toString() !== warning.org_id.toString()) {
          return this.forbidden(req.trace_id);
        }
      } else if (roles.includes('head_teacher')) {
        const headTeacherClassIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
          activeOnly: true,
        });
        if (
          headTeacherClassIds.length === 0
          || !headTeacherClassIds.some((item) => item.toString() === warning.class_id.toString())
        ) {
          return this.forbidden(req.trace_id);
        }
      } else if (roles.includes('student')) {
        const studentProfile = await this.prisma.student_profiles.findUnique({
          where: { user_id: userId },
          select: { id: true },
        });
        if (!studentProfile || studentProfile.id.toString() !== warning.student_id.toString()) {
          return this.forbidden(req.trace_id);
        }
      } else {
        return this.forbidden(req.trace_id);
      }
    }

    const updatedWarning = await (this.prisma as any).warning_current_states.update({
      where: { id: warningId },
      data: {
        status: 'acknowledged',
        acknowledged_at: new Date(),
        acknowledged_by: userId,
      },
    });

    await this.prisma.warnings.create({
      data: {
        student_id: updatedWarning.student_id,
        class_id: updatedWarning.class_id,
        org_id: updatedWarning.org_id,
        metric: updatedWarning.metric,
        level: updatedWarning.level,
        window: updatedWarning.window,
        period_start: updatedWarning.period_start,
        period_end: updatedWarning.period_end,
        rule_id: updatedWarning.rule_id,
        rule_snapshot_json: updatedWarning.rule_snapshot_json,
        trigger_summary: updatedWarning.trigger_summary,
        trigger_detail_json: updatedWarning.trigger_detail_json,
        status: 'acknowledged',
        acknowledged_at: updatedWarning.acknowledged_at,
        acknowledged_by: updatedWarning.acknowledged_by,
      },
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: 'warning.ack',
        entity_type: 'warning',
        entity_id: updatedWarning.id,
        after_json: { status: 'acknowledged' } as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    await this.warningSnapshotService.invalidateStudents(
      [warning.student_id],
      [warning.class_id],
    );

    return {
      code: 0,
      message: 'ok',
      data: { id: updatedWarning.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Get('courses')
  @Roles('sys_admin', 'student_admin', 'head_teacher', 'student', 'dean', 'teaching_admin', 'teacher')
  async listCourses(
    @Query('org_id') orgId: string,
    @Query('class_id') classId: string,
    @Req() req: any,
  ) {
    const userId = this.getRequestUserId(req);
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    const roles = userRoles.map((item: any) => item.role);
    const where: any = {
      status: { in: ['open', 'acknowledged'] },
      metric: { not: 'warning_total' },
    };
    const scopedOrgIds: bigint[] = [];
    const scopedClassIds: bigint[] = [];

    if (roles.includes('sys_admin') || roles.includes('dean') || roles.includes('teaching_admin')) {
      // full access
    } else if (roles.includes('student_admin')) {
      const studentAdminRole = userRoles.find((item: any) => item.role === 'student_admin');
      if (!studentAdminRole?.scope_id) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      scopedOrgIds.push(studentAdminRole.scope_id);
    } else if (roles.includes('head_teacher')) {
      const headTeacherClassIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
        activeOnly: true,
      });
      if (headTeacherClassIds.length === 0) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      scopedClassIds.push(...headTeacherClassIds);
    } else if (roles.includes('student')) {
      const studentProfile = await this.prisma.student_profiles.findUnique({
        where: { user_id: userId },
        select: { id: true },
      });
      if (!studentProfile) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      where.student_id = studentProfile.id;
    } else if (roles.includes('teacher')) {
      const teacherBindings = await this.prisma.teacher_course_bindings.findMany({
        where: { teacher_id: userId },
        select: { class_id: true },
      });
      if (teacherBindings.length === 0) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      for (const binding of teacherBindings) {
        scopedClassIds.push(binding.class_id);
      }
    } else {
      return {
        code: 0,
        message: 'ok',
        data: [],
        trace_id: req.trace_id,
      };
    }

    if (scopedOrgIds.length > 0) {
      where.org_id = { in: this.uniqueBigInts(scopedOrgIds) };
    }
    if (scopedClassIds.length > 0) {
      where.class_id = { in: this.uniqueBigInts(scopedClassIds) };
    }

    if (classId) {
      const selectedClassId = BigInt(classId);
      if (
        scopedClassIds.length > 0 &&
        !scopedClassIds.some((item: any) => item.toString() === selectedClassId.toString())
      ) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }

      if (scopedOrgIds.length > 0) {
        const classInScope = await this.prisma.classes.findFirst({
          where: {
            id: selectedClassId,
            org_id: { in: this.uniqueBigInts(scopedOrgIds) },
          },
          select: { id: true },
        });
        if (!classInScope) {
          return {
            code: 0,
            message: 'ok',
            data: [],
            trace_id: req.trace_id,
          };
        }
      }

      where.class_id = selectedClassId;
    } else if (orgId) {
      const selectedOrgId = BigInt(orgId);
      if (
        scopedOrgIds.length > 0 &&
        !scopedOrgIds.some((item: any) => item.toString() === selectedOrgId.toString())
      ) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }

      if (scopedClassIds.length > 0) {
        const classes = await this.prisma.classes.findMany({
          where: {
            org_id: selectedOrgId,
            id: { in: this.uniqueBigInts(scopedClassIds) },
          },
          select: { id: true },
        });
        if (classes.length === 0) {
          return {
            code: 0,
            message: 'ok',
            data: [],
            trace_id: req.trace_id,
          };
        }
        where.class_id = { in: classes.map((item: any) => item.id) };
      } else {
        where.org_id = selectedOrgId;
      }
    }

    const warnings = await (this.prisma as any).warning_current_states.findMany({
      where,
      select: {
        trigger_detail_json: true,
      },
    });

    const courseIdMap = new Map<string, bigint>();
    for (const warning of warnings) {
      const detail = warning.trigger_detail_json as any;
      const rawCourseId = detail?.course_id ?? detail?.courseId;
      const normalizedCourseId = String(rawCourseId || '').trim();
      if (!/^\d+$/.test(normalizedCourseId)) {
        continue;
      }
      courseIdMap.set(normalizedCourseId, BigInt(normalizedCourseId));
    }

    const courseIds = Array.from(courseIdMap.values());
    if (courseIds.length === 0) {
      return {
        code: 0,
        message: 'ok',
        data: [],
        trace_id: req.trace_id,
      };
    }

    const courses = await this.prisma.courses.findMany({
      where: {
        id: { in: courseIds },
      },
      select: {
        id: true,
        course_name: true,
      },
      orderBy: {
        course_name: 'asc',
      },
    });

    return {
      code: 0,
      message: 'ok',
      data: courses.map((course: any) => ({
        id: course.id.toString(),
        course_name: course.course_name,
      })),
      trace_id: req.trace_id,
    };
  }

  private getRequestUserId(req: any) {
    return BigInt(req.user?.sub || req.user?.userId);
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

  private computeDedupedViolationTotal(
    warnings: Array<{
      student_id: bigint;
      metric?: string | null;
      trigger_detail_json?: any;
    }>,
  ) {
    const counter = new Map<string, number>();

    for (const warning of warnings) {
      const detail = (warning?.trigger_detail_json as Record<string, any>) || {};
      if (String(warning?.metric || '').trim() === 'warning_total') {
        continue;
      }
      const courseId = String(detail.course_id || '').trim() || '__none__';
      const metric = String(warning?.metric || detail.violation_type || '').trim() || '__unknown__';
      const key = [warning.student_id.toString(), courseId, metric].join('_');
      const nextValue = Number(detail.violation_count || 0) || 0;
      const currentValue = counter.get(key) || 0;
      if (nextValue > currentValue) {
        counter.set(key, nextValue);
      }
    }

    return Array.from(counter.values()).reduce((sum, value) => sum + value, 0);
  }

  private async resolveWarningScopeContext(userId: bigint): Promise<WarningScopeContext> {
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });
    const roles = userRoles.map((item: any) => item.role);
    const scopedOrgIds: bigint[] = [];
    const scopedClassIds: bigint[] = [];
    let studentId: bigint | undefined;

    if (roles.includes('sys_admin') || roles.includes('dean') || roles.includes('teaching_admin')) {
      return { roles, scopedOrgIds, scopedClassIds };
    }

    if (roles.includes('student_admin')) {
      const studentAdminRole = userRoles.find((item: any) => item.role === 'student_admin');
      if (studentAdminRole?.scope_id) {
        scopedOrgIds.push(studentAdminRole.scope_id);
      }
      return { roles, scopedOrgIds, scopedClassIds };
    }

    if (roles.includes('head_teacher')) {
      const headTeacherClassIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
        activeOnly: true,
      });
      scopedClassIds.push(...headTeacherClassIds);
      return { roles, scopedOrgIds, scopedClassIds };
    }

    if (roles.includes('teacher')) {
      const teacherBindings = await this.prisma.teacher_course_bindings.findMany({
        where: { teacher_id: userId },
        select: { class_id: true },
      });
      teacherBindings.forEach((item: any) => scopedClassIds.push(item.class_id));
      return { roles, scopedOrgIds, scopedClassIds };
    }

    if (roles.includes('student')) {
      const studentProfile = await this.prisma.student_profiles.findUnique({
        where: { user_id: userId },
        select: { id: true, class_id: true },
      });
      if (studentProfile) {
        studentId = studentProfile.id;
        scopedClassIds.push(studentProfile.class_id);
      }
      return { roles, scopedOrgIds, scopedClassIds, studentId };
    }

    return { roles, scopedOrgIds, scopedClassIds, studentId };
  }

  private async resolveScopedClassId(classId: string, orgId: string, context: WarningScopeContext) {
    const normalizedClassId = String(classId || '').trim();
    if (/^\d+$/.test(normalizedClassId)) {
      const selectedClassId = BigInt(normalizedClassId);
      if (
        context.scopedClassIds.length > 0 &&
        !context.scopedClassIds.some((item) => item.toString() === selectedClassId.toString())
      ) {
        return null;
      }
      if (context.scopedOrgIds.length > 0) {
        const classInScope = await this.prisma.classes.findFirst({
          where: {
            id: selectedClassId,
            org_id: { in: this.uniqueBigInts(context.scopedOrgIds) },
          },
          select: { id: true },
        });
        if (!classInScope) {
          return null;
        }
      }
      return selectedClassId;
    }

    const where: any = { status: 'active' };
    if (context.scopedClassIds.length > 0) {
      where.id = { in: this.uniqueBigInts(context.scopedClassIds) };
    }
    if (context.scopedOrgIds.length > 0) {
      where.org_id = { in: this.uniqueBigInts(context.scopedOrgIds) };
    }
    if (/^\d+$/.test(String(orgId || '').trim())) {
      where.org_id = BigInt(orgId);
    }

    const fallbackClass = await this.prisma.classes.findFirst({
      where,
      orderBy: [{ class_name: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });

    return fallbackClass?.id || null;
  }

  private canAccessStudent(context: WarningScopeContext, student: any) {
    if (context.studentId && context.studentId.toString() !== student.id.toString()) {
      return false;
    }
    if (
      context.scopedClassIds.length > 0 &&
      !context.scopedClassIds.some((item) => item.toString() === student.class_id.toString())
    ) {
      return false;
    }
    if (
      context.scopedOrgIds.length > 0 &&
      !context.scopedOrgIds.some((item) => item.toString() === (student.org_id || student.classes?.org_id || 0n).toString())
    ) {
      return false;
    }
    return true;
  }

  private async getCurrentWeekInfo(referenceDate = new Date()) {
    const teachingConfig = await this.configService.getSectionConfig('teaching', {});
    return getAcademicWeekInfo(
      referenceDate,
      resolveSemesterStartDate(teachingConfig?.semesterStartDate, referenceDate),
    );
  }

  private async getCurrentPeriods(referenceDate = new Date()) {
    const now = dayjs(referenceDate).tz(DEFAULT_TZ);
    const weekInfo = await this.getCurrentWeekInfo(referenceDate);

    return {
      todayStart: now.startOf('day').toDate(),
      todayEnd: now.endOf('day').toDate(),
      weekStart: weekInfo.weekStart,
      weekEnd: dayjs(weekInfo.weekEnd).endOf('day').toDate(),
      monthStart: now.startOf('month').toDate(),
      monthEnd: now.endOf('month').toDate(),
      weekLabel: weekInfo.weekLabel,
    };
  }

  private applyWarningScopeFilter(where: any, scope: string) {
    const normalizedScope = String(scope || 'active').trim().toLowerCase();
    if (normalizedScope === 'history') {
      where.status = { in: ['closed'] };
    } else if (normalizedScope === 'all') {
      // no-op
    } else {
      where.status = { in: ['open', 'acknowledged'] };
    }
  }

  private async buildStudentWarningSummaryMap(studentIds: bigint[], scope: string) {
    const map = new Map<string, { highestLevel: string; warningCount: number; lastWarningAt: Date | null }>();
    if (studentIds.length === 0) {
      return map;
    }

    const snapshots = await this.warningSnapshotService.getOrRefreshStudentSnapshots(studentIds);
    const normalizedScope = String(scope || 'active').trim().toLowerCase();

    for (const studentId of studentIds) {
      const snapshot = snapshots.get(studentId.toString());
      if (!snapshot) {
        continue;
      }

      if (normalizedScope === 'history') {
        const warningCount = Number(snapshot.closed_warning_count || 0);
        map.set(studentId.toString(), {
          highestLevel: warningCount > 0 ? snapshot.closed_highest_level || '' : '',
          warningCount,
          lastWarningAt: warningCount > 0 ? snapshot.closed_last_warning_at || null : null,
        });
        continue;
      }

      if (normalizedScope === 'all') {
        const warningCount = Number(snapshot.all_warning_count || 0);
        map.set(studentId.toString(), {
          highestLevel: warningCount > 0 ? snapshot.all_highest_level || '' : '',
          warningCount,
          lastWarningAt: warningCount > 0 ? snapshot.all_last_warning_at || null : null,
        });
        continue;
      }

      const warningCount = Number(snapshot.active_warning_count || 0);
      map.set(studentId.toString(), {
        highestLevel: warningCount > 0 ? snapshot.active_highest_level || '' : '',
        warningCount,
        lastWarningAt: warningCount > 0 ? snapshot.active_last_warning_at || null : null,
      });
    }

    return map;
  }

  private async buildStudentAbnormalSummaryMap(studentIds: bigint[]) {
    const map = new Map<string, { todayCount: number; weekCount: number; monthCount: number }>();
    if (studentIds.length === 0) {
      return map;
    }

    const snapshots = await this.warningSnapshotService.getOrRefreshStudentSnapshots(studentIds);
    for (const studentId of studentIds) {
      const snapshot = snapshots.get(studentId.toString());
      if (!snapshot) {
        continue;
      }

      map.set(studentId.toString(), {
        todayCount: Number(snapshot.today_warning_total || 0),
        weekCount: Number(snapshot.week_warning_total || 0),
        monthCount: Number(snapshot.month_warning_total || 0),
      });
    }

    return map;
  }

  private async resolveDetailViewPeriod(view: string) {
    const periods = await this.getCurrentPeriods();
    const normalizedView = String(view || 'day').trim().toLowerCase();

    if (normalizedView === 'week') {
      return {
        key: 'week',
        start: periods.weekStart,
        end: periods.weekEnd,
        label: periods.weekLabel,
      };
    }
    if (normalizedView === 'month') {
      return {
        key: 'month',
        start: periods.monthStart,
        end: periods.monthEnd,
        label: '本月',
      };
    }
    if (normalizedView === 'all') {
      return {
        key: 'all',
        start: dayjs().tz(DEFAULT_TZ).subtract(60, 'day').startOf('day').toDate(),
        end: new Date(),
        label: '全部预警',
      };
    }

    return {
      key: 'day',
      start: periods.todayStart,
      end: periods.todayEnd,
      label: '今日预警',
    };
  }

  private async loadStudentWarnings(
    studentId: bigint,
    scope: string,
    period: { key: string; start: Date; end: Date },
    limit = CLASS_VIEW_DETAIL_WARNING_LIMIT,
  ) {
    const where: any = {
      student_id: studentId,
      metric: { not: 'warning_total' },
    };
    this.applyWarningScopeFilter(where, scope);
    where.period_start = { lte: period.end };
    where.period_end = { gte: period.start };
    if (period.key !== 'all') {
      where.window = period.key;
    }

    if (String(scope || 'active').trim().toLowerCase() === 'active') {
      return (this.prisma as any).warning_current_states.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        take: limit,
      });
    }

    return this.prisma.warnings.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  private buildStudentCourseGroups(
    warnings: any[],
    scope?: string,
    processingState?: { status?: string; text?: string } | null,
  ) {
    const groups = new Map<string, any>();
    const levelWeight: Record<string, number> = {
      yellow: 1,
      orange: 2,
      red: 3,
      severe: 4,
    };

    warnings.forEach((warning: any) => {
      const detail = (warning.trigger_detail_json as Record<string, any>) || {};
      const courseId = String(detail.course_id || '').trim() || '__none__';
      const courseName = String(detail.course_name || '').trim() || '未区分课程';
      const displayStatus = this.getDisplayStatus(warning);
      const current = groups.get(courseId) || {
        course_id: courseId === '__none__' ? '' : courseId,
        course_name: courseName,
        highest_level: '',
        warning_count: 0,
        warning_total_count: 0,
        warning_items: [],
      };
      current.warning_count += 1;
      current.warning_total_count += Number(detail.violation_count || 0) || 0;
      if ((levelWeight[warning.level] || 0) > (levelWeight[current.highest_level] || 0)) {
        current.highest_level = warning.level;
      }
      current.warning_items.push({
        id: warning.id.toString(),
        level: warning.level,
        level_text: this.getLevelText(warning.level),
        metric: warning.metric,
        metric_text: this.getWarningMetricText(warning),
        window: warning.window,
        window_text: this.getWindowText(warning.window),
        violation_count: Number(detail.violation_count || 0),
        trigger_summary: warning.trigger_summary,
        status: warning.status,
        status_text: this.getStatusText(warning.status),
        display_status: displayStatus.display_status,
        display_status_text: displayStatus.display_status_text,
        created_at: warning.created_at,
        close_note: warning.close_note || '',
        processing_status: processingState?.status || '',
        processing_text: processingState?.text || '',
      });
      groups.set(courseId, current);
    });

    const isActiveScope = String(scope || 'active').trim().toLowerCase() === 'active';

    return Array.from(groups.values())
      .map((group: any) => {
        const warningItems = group.warning_items.sort(
          (left: any, right: any) =>
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
        );
        return {
          ...group,
          warning_count: isActiveScope ? (warningItems.length > 0 ? 1 : 0) : group.warning_count,
          warning_items: warningItems,
        };
      })
      .filter((group: any) => (group.warning_items?.length || 0) > 0)
      .sort((left: any, right: any) => {
        const levelDiff = (levelWeight[right.highest_level] || 0) - (levelWeight[left.highest_level] || 0);
        if (levelDiff !== 0) {
          return levelDiff;
        }
        return (right.warning_count || 0) - (left.warning_count || 0);
      });
  }

  private normalizePageNumber(value: string) {
    const pageNumber = Number.parseInt(String(value || '1'), 10);
    return Math.max(1, Number.isFinite(pageNumber) ? pageNumber : 1);
  }

  private normalizePageSize(value: string, fallback: number, max: number) {
    const pageSize = Number.parseInt(String(value || fallback), 10);
    if (!Number.isFinite(pageSize) || pageSize <= 0) {
      return fallback;
    }
    return Math.min(max, pageSize);
  }

  private filterStudentsByKeyword(students: any[], keyword: string) {
    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    if (!normalizedKeyword) {
      return students;
    }

    return students.filter((student: any) => {
      const candidate = [
        student.student_no,
        student.users?.name,
        student.major,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');
      return candidate.includes(normalizedKeyword);
    });
  }

  private getMetricText(metric: string) {
    const map: Record<string, string> = {
      late: '迟到',
      absent: '缺勤',
      early_leave: '早退',
      warning_total: '累计预警',
    };
    return map[metric] || metric || '-';
  }

  private getWarningMetricText(warning: any) {
    const detail = (warning?.trigger_detail_json as Record<string, any>) || {};
    const hasAggregateCounts =
      Number(detail.late_count || 0) > 0 ||
      Number(detail.absent_count || 0) > 0 ||
      Number(detail.early_leave_count || 0) > 0;

    if (hasAggregateCounts) {
      return '综合异常';
    }

    return this.getMetricText(String(warning?.metric || ''));
  }

  private getWindowText(window: string) {
    const map: Record<string, string> = {
      day: '日',
      week: '周',
      month: '月',
      term: '学期',
    };
    return map[window] || window || '-';
  }

  private isRelatedInfoSyncWarning(warning: any) {
    const status = String(warning?.status || '').trim().toLowerCase();
    const closeNote = String(warning?.close_note || '').trim();
    if (status !== 'closed' || !closeNote) {
      return false;
    }

    return [
      '系统重算后该课程在当前时间窗内已不再满足预警条件',
      '系统重算后该异常事件已不存在，自动关闭对应日预警',
      '系统重算后该异常事件已不再命中日预警规则',
      '系统重算后已不再满足当前预警规则',
    ].includes(closeNote);
  }

  private getDisplayStatus(warning: any) {
    const status = String(warning?.status || '').trim();
    if (this.isRelatedInfoSyncWarning(warning)) {
      return {
        display_status: 'synced',
        display_status_text: '相关信息同步',
      };
    }

    return {
      display_status: status,
      display_status_text: this.getStatusText(status),
    };
  }

  private getStatusText(status: string) {
    const map: Record<string, string> = {
      open: '待确认',
      acknowledged: '已确认',
      closed: '已关闭',
    };
    return map[status] || status || '-';
  }

  private getLevelText(level: string) {
    const map: Record<string, string> = {
      yellow: '黄色预警',
      orange: '橙色预警',
      red: '红色预警',
      severe: '严重预警',
    };
    return map[level] || level || '-';
  }

  private async emptyClassViewDetail(traceId: string) {
    return {
      code: 0,
      message: 'ok',
      data: {
        student: null,
        summary: {
          warning_count: 0,
          highest_level: '',
          last_warning_at: null,
          processing_status: '',
          processing_text: '',
        },
        view: 'day',
        view_label: '今日预警',
        course_groups: [],
      },
      trace_id: traceId,
    };
  }

  private emptyWarningList(pageNumber: number, pageSize: number, traceId: string) {
    return {
      code: 0,
      message: 'ok',
      data: {
        total: 0,
        student_total: 0,
        warning_total: 0,
        violation_total: 0,
        page: pageNumber,
        page_size: pageSize,
        items: [],
      },
      trace_id: traceId,
    };
  }

  private forbidden(traceId: string) {
    return {
      code: 403,
      message: '操作失败',
      data: null,
      trace_id: traceId,
    };
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { Prisma } from '@prisma/client';
import { AuthGuard } from '../shared/auth.guard';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { RolesGuard, Roles } from '../shared/roles.guard';
import { ConfigService } from '../config/config.service';
import { PinoLogger } from 'nestjs-pino';
import { serializeForAudit } from '../shared/json.util';
import {
  DEFAULT_SEMESTER_TOTAL_WEEKS,
  formatDateOnly,
  getDefaultSemesterStartDate,
  resolveSemesterStartDate,
  resolveSemesterTotalWeeks,
} from '../shared/academic-calendar.util';
import {
  CHANGE_REQUEST_DEAN_QUEUE_STATUSES,
  CHANGE_REQUEST_STATUS,
  normalizeChangeRequestStatus,
} from '../shared/change-request-status.util';
import {
  loadImportTemplate,
  saveImportTemplate,
} from '../shared/import-template.util';

class UpdateGradeDto {
  score!: number;
}

class CreateGradeDto {
  student_id!: string;
  course_id!: string;
  term_code!: string;
  score!: number;
  pass_status?: string;
}

class UpdateStudentProfileDto {
  class_id?: string;
  major_id?: string;
  major?: string;
  enroll_year?: number;
  status?: string;
}

class UpdateGradeImportTemplateDto {
  fields!: Array<{
    key: string;
    label?: string;
    columnName: string;
    enabled?: boolean;
    required?: boolean;
  }>;
}

class ImportGradesDto {
  rows!: Array<Record<string, any>>;
}

class UpdateSemesterConfigDto {
  semester_start_date!: string;
  semester_total_weeks?: number;
}

class ReviewTeacherCourseBindingRequestDto {
  reason?: string;
}

@Controller('teaching-admin')
@UseGuards(AuthGuard, RolesGuard, PermissionGuard)
export class TeachingAdminController {
  private readonly dictionaryCacheTtlSeconds = 300;
  private readonly statsCacheTtlSeconds = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('TeachingAdminController');
  }

  private async getCachedPayload<T>(cacheKey: string, loader: () => Promise<T>, ttlSeconds: number) {
    void cacheKey;
    void ttlSeconds;
    return loader();
  }

  private async getSemesterConfig() {
    const teachingConfig = await this.configService.getSectionConfig('teaching', {});
    const semesterStartDate = resolveSemesterStartDate(
      teachingConfig?.semesterStartDate,
    );
    const semesterTotalWeeks = resolveSemesterTotalWeeks(teachingConfig?.semesterTotalWeeks);

    return {
      semesterStartDate,
      semesterTotalWeeks,
      teachingConfig,
    };
  }

  private getOperatorId(req: any) {
    return BigInt(req.user.sub);
  }

  private async getGradeImportTemplate() {
    return loadImportTemplate(this.prisma, 'grades');
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

  private async getGradeStudentUserIds(keyword?: string, classId?: string) {
    const where: any = {};

    if (keyword) {
      where.OR = [
        { student_no: { contains: keyword } },
        { users: { is: { name: { contains: keyword } } } },
      ];
    }

    if (classId) {
      where.class_id = BigInt(classId);
    }

    if (!keyword && !classId) {
      return null;
    }

    const students = await this.prisma.student_profiles.findMany({
      where,
      select: { user_id: true },
    });

    return this.uniqueBigInts(students.map((item: any) => item.user_id));
  }

  private async getGradeRelatedMaps(grades: any[]) {
    const studentIds = this.uniqueBigInts(grades.map((item: any) => item.student_id));
    const courseIds = this.uniqueBigInts(grades.map((item: any) => item.course_id));

    const [students, courses] = await Promise.all([
      studentIds.length > 0
        ? this.prisma.student_profiles.findMany({
            where: { user_id: { in: studentIds } },
            include: { users: true, classes: true },
          })
        : Promise.resolve([]),
      courseIds.length > 0
        ? this.prisma.courses.findMany({
            where: { id: { in: courseIds } },
          })
        : Promise.resolve([]),
    ]);

    return {
      studentMap: new Map(students.map((item: any) => [item.user_id.toString(), item])),
      courseMap: new Map(courses.map((item: any) => [item.id.toString(), item])),
    };
  }

  private async isSysAdmin(userId: bigint) {
    const role = await this.prisma.user_roles.findFirst({
      where: {
        user_id: userId,
        role: 'sys_admin',
      },
      select: { id: true },
    });
    return Boolean(role);
  }

  private formatDisplayValue(value: unknown) {
    const text = String(value ?? '').trim();
    return text || '-';
  }

  private formatScoreValue(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    return String(value);
  }

  private formatPassStatus(status?: string | null) {
    if (status === 'pass') {
      return '及格';
    }
    if (status === 'fail') {
      return '不及格';
    }
    return this.formatDisplayValue(status);
  }

  private formatStudentStatus(status?: string | null) {
    if (status === 'active') {
      return '在读';
    }
    if (status === 'inactive') {
      return '休学';
    }
    if (status === 'graduated') {
      return '毕业';
    }
    return this.formatDisplayValue(status);
  }

  @Get('course-binding-requests')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async listTeacherCourseBindingRequests(@Req() req: any) {
    const requests = await this.prisma.change_requests.findMany({
      where: {
        target_type: 'teacher_course_binding_change',
        status: { in: [...CHANGE_REQUEST_DEAN_QUEUE_STATUSES] },
      },
      orderBy: { created_at: 'desc' },
    });

    const teacherIds = this.uniqueBigInts(requests.map((item: any) => item.target_id));
    const teachers = teacherIds.length > 0
      ? await this.prisma.users.findMany({
          where: { id: { in: teacherIds } },
          select: { id: true, name: true, mobile: true, email: true },
        })
      : [];
    const teacherMap = new Map(teachers.map((item: any) => [item.id.toString(), item]));

    return {
      code: 0,
      message: 'ok',
      data: requests.map((item: any) => {
        const change = (item.change_json as any) || {};
        const teacher = teacherMap.get(item.target_id.toString()) as any;
        return {
          id: item.id.toString(),
          teacher_name: change.teacher_name || teacher?.name || '',
          teacher_account: teacher?.mobile || teacher?.email || '',
          current_value: change.current_value || '',
          target_value: change.target_value || '',
          reason: item.reason || '',
          status: normalizeChangeRequestStatus(item.status),
          created_at: item.created_at,
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Post('course-binding-requests/:id/approve')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async approveTeacherCourseBindingRequest(@Param('id') id: string, @Req() req: any) {
    const requestId = BigInt(id);
    const operatorId = this.getOperatorId(req);
    const changeRequest = await this.prisma.change_requests.findUnique({
      where: { id: requestId },
    });

    if (!changeRequest || changeRequest.target_type !== 'teacher_course_binding_change') {
      return {
        code: 404,
        message: '课程变更申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (![...CHANGE_REQUEST_DEAN_QUEUE_STATUSES].includes(changeRequest.status as any)) {
      return {
        code: 400,
        message: '该申请当前不可审批',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const change = (changeRequest.change_json as any) || {};
    const targetBindings = Array.isArray(change.target_bindings) ? change.target_bindings : [];
    const orgId = change.org_id ? BigInt(change.org_id) : null;
    const teacherId = changeRequest.target_id;

    const pairs = targetBindings.flatMap((item: any) =>
      (Array.isArray(item.class_ids) ? item.class_ids : []).map((classId: any) => ({
        course_id: BigInt(String(item.course_id)),
        class_id: BigInt(String(classId)),
      })),
    );

    const courseIds = this.uniqueBigInts(pairs.map((item: any) => item.course_id));
    const classIds = this.uniqueBigInts(pairs.map((item: any) => item.class_id));

    const [courses, classes] = await Promise.all([
      courseIds.length > 0
        ? this.prisma.courses.findMany({
            where: { id: { in: courseIds }, status: 'active' },
            select: { id: true },
          })
        : Promise.resolve([]),
      classIds.length > 0
        ? this.prisma.classes.findMany({
            where: { id: { in: classIds }, status: 'active' },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);

    if (courses.length !== courseIds.length || classes.length !== classIds.length) {
      return {
        code: 400,
        message: '目标课程或班级已发生变化，请教师重新提交申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.teacher_course_bindings.deleteMany({
        where: { teacher_id: teacherId },
      });

      for (const pair of pairs) {
        await tx.teacher_course_bindings.create({
          data: {
            teacher_id: teacherId,
            org_id: orgId || BigInt(0),
            course_id: pair.course_id,
            class_id: pair.class_id,
          },
        });
      }

      await tx.change_requests.update({
        where: { id: requestId },
        data: {
          status: CHANGE_REQUEST_STATUS.APPROVED,
          approver_user_id: operatorId,
          approved_at: new Date(),
        },
      });
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: operatorId,
        action: 'course_binding.approve',
        entity_type: 'change_request',
        entity_id: requestId,
        before_json: serializeForAudit(changeRequest) as any,
        after_json: serializeForAudit({ status: CHANGE_REQUEST_STATUS.APPROVED }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '课程变更申请已批准',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Post('course-binding-requests/:id/reject')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async rejectTeacherCourseBindingRequest(
    @Param('id') id: string,
    @Body() dto: ReviewTeacherCourseBindingRequestDto,
    @Req() req: any,
  ) {
    const requestId = BigInt(id);
    const reason = String(dto.reason || '').trim();
    if (!reason) {
      return {
        code: 400,
        message: '请填写驳回原因',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const changeRequest = await this.prisma.change_requests.findUnique({
      where: { id: requestId },
    });

    if (!changeRequest || changeRequest.target_type !== 'teacher_course_binding_change') {
      return {
        code: 404,
        message: '课程变更申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    await this.prisma.change_requests.update({
      where: { id: requestId },
      data: {
        status: CHANGE_REQUEST_STATUS.REJECTED,
        approver_user_id: this.getOperatorId(req),
        rejected_at: new Date(),
        reject_reason: reason,
      },
    });

    const operatorId = this.getOperatorId(req);
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: operatorId,
        action: 'course_binding.reject',
        entity_type: 'change_request',
        entity_id: requestId,
        before_json: serializeForAudit(changeRequest) as any,
        after_json: serializeForAudit({ status: CHANGE_REQUEST_STATUS.REJECTED, reject_reason: reason }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '课程变更申请已驳回',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('semester-config')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async getSemesterConfigValue(@Req() req: any) {
    const payload = await this.getCachedPayload(
      'teaching-admin:semester-config',
      async () => {
        const { semesterStartDate, semesterTotalWeeks } = await this.getSemesterConfig();
        return {
          semester_start_date: formatDateOnly(semesterStartDate),
          default_semester_start_date: formatDateOnly(getDefaultSemesterStartDate()),
          semester_total_weeks: semesterTotalWeeks,
          default_semester_total_weeks: DEFAULT_SEMESTER_TOTAL_WEEKS,
        };
      },
      this.dictionaryCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data: payload,
      trace_id: req.trace_id,
    };
  }

  @Get('orgs')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async getOrgs(@Req() req: any) {
    const data = await this.getCachedPayload(
      'teaching-admin:orgs',
      async () => {
        const orgs = await this.prisma.orgs.findMany({
          orderBy: { id: 'asc' },
        });

        return orgs.map((org: any) => ({
          id: org.id.toString(),
          org_id: org.id.toString(),
          org_name: org.name,
          org_code: org.org_kind,
          status: org.status,
        }));
      },
      this.dictionaryCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('classes')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async getClasses(
    @Query('org_id') orgId?: string,
    @Req() req?: any,
  ) {
    const cacheKey = `teaching-admin:classes:${String(orgId || 'all')}`;
    const data = await this.getCachedPayload(
      cacheKey,
      async () => {
        const where: any = {};
        if (orgId) {
          where.org_id = BigInt(orgId);
        }

        const classes = await this.prisma.classes.findMany({
          where,
          include: {
            orgs: {
              select: { name: true },
            },
          },
          orderBy: [{ enroll_year: 'desc' }, { class_name: 'asc' }],
        });

        return classes.map((item: any) => ({
          id: item.id.toString(),
          org_id: item.org_id.toString(),
          org_name: item.orgs?.name || '',
          class_name: item.class_name,
          enroll_year: item.enroll_year,
          major: item.major,
          grade_level: item.grade_level,
          status: item.status,
        }));
      },
      this.dictionaryCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req?.trace_id,
    };
  }

  @Put('semester-config')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async updateSemesterConfig(
    @Body() dto: UpdateSemesterConfigDto,
    @Req() req: any,
  ) {
    const normalizedDate = String(dto.semester_start_date || '').trim();
    const parsedDate = new Date(normalizedDate);
    const semesterTotalWeeks = resolveSemesterTotalWeeks(dto.semester_total_weeks);
    if (!normalizedDate || Number.isNaN(parsedDate.getTime())) {
      return {
        code: 400,
        message: '学期起始时间格式不正确',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentTeachingConfig = await this.configService.getSectionConfig('teaching', {});
    const nextTeachingConfig = {
      ...(currentTeachingConfig || {}),
      semesterStartDate: formatDateOnly(parsedDate),
      semesterTotalWeeks,
    };

    await this.prisma.system_settings.upsert({
      where: { setting_key: 'teaching' },
      update: {
        setting_val: JSON.stringify(nextTeachingConfig),
      },
      create: {
        setting_key: 'teaching',
        setting_val: JSON.stringify(nextTeachingConfig),
      },
    });

    this.configService.clearCache();

    const operatorId = this.getOperatorId(req);
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: operatorId,
        action: 'semester_config.update',
        entity_type: 'system_setting',
        entity_id: 0n,
        before_json: serializeForAudit(currentTeachingConfig) as any,
        after_json: serializeForAudit(nextTeachingConfig) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '学期起始时间已更新',
      data: {
        semester_start_date: nextTeachingConfig.semesterStartDate,
        semester_total_weeks: nextTeachingConfig.semesterTotalWeeks,
      },
      trace_id: req.trace_id,
    };
  }

  private formatGradeApprovalValue(input: {
    courseName?: string | null;
    termCode?: string | null;
    score?: unknown;
    passStatus?: string | null;
  }) {
    return [
      `课程：${this.formatDisplayValue(input.courseName)}`,
      `学期：${this.formatDisplayValue(input.termCode)}`,
      `成绩：${this.formatScoreValue(input.score)}`,
      `结果：${this.formatPassStatus(input.passStatus)}`,
    ].join('；');
  }

  private formatStudentProfileApprovalValue(input: {
    orgName?: string | null;
    className?: string | null;
    major?: string | null;
    enrollYear?: number | null;
    status?: string | null;
  }) {
    return [
      `学院：${this.formatDisplayValue(input.orgName)}`,
      `班级：${this.formatDisplayValue(input.className)}`,
      `专业：${this.formatDisplayValue(input.major)}`,
      `入学年份：${this.formatDisplayValue(input.enrollYear)}`,
      `状态：${this.formatStudentStatus(input.status)}`,
    ].join('；');
  }

  @Get('school-stats')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async getSchoolStats(@Req() req: any) {
    const data = await this.getCachedPayload(
      'teaching-admin:school-stats',
      async () => {
        const [
          totalStudents,
          totalTeachers,
          totalOrgs,
          totalClasses,
          totalCourses,
          warningGroups,
          activeOrgs,
          studentGroups,
        ] = await Promise.all([
          this.prisma.student_profiles.count(),
          this.prisma.users.count({ where: { user_type: 'teacher' } }),
          this.prisma.orgs.count({ where: { status: 'active' } }),
          this.prisma.classes.count({ where: { status: 'active' } }),
          this.prisma.courses.count({ where: { status: 'active' } }),
          this.prisma.warnings.groupBy({
            by: ['org_id', 'status'],
            _count: {
              id: true,
            },
          }),
          this.prisma.orgs.findMany({
            where: { status: 'active' },
            select: {
              id: true,
              name: true,
            },
          }),
          this.prisma.student_profiles.groupBy({
            by: ['org_id'],
            _count: {
              id: true,
            },
          }),
        ]);

        let totalWarnings = 0;
        let closedWarnings = 0;
        const warningCountMap = new Map<string, number>();
        warningGroups.forEach((item: any) => {
          const count = Number(item._count?.id || 0);
          const status = String(item.status || '').trim().toLowerCase();
          const orgKey = item.org_id?.toString?.() || '';

          if (status === 'closed') {
            closedWarnings += count;
            return;
          }

          totalWarnings += count;
          if (orgKey) {
            warningCountMap.set(orgKey, (warningCountMap.get(orgKey) || 0) + count);
          }
        });

        const totalWarningRecords = totalWarnings + closedWarnings;
        const warningRate = totalStudents > 0 ? `${((totalWarnings / totalStudents) * 100).toFixed(1)}%` : '0%';
        const closureRate = totalWarningRecords > 0 ? `${((closedWarnings / totalWarningRecords) * 100).toFixed(1)}%` : '0%';

        const studentCountMap = new Map<string, number>(
          studentGroups.map((item: any) => [item.org_id?.toString?.() || '', Number(item._count?.id || 0)]),
        );
        const collegeStats = activeOrgs
          .map((org: any) => {
            const orgKey = org.id.toString();
            const studentCount = studentCountMap.get(orgKey) || 0;
            const orgWarningCount = warningCountMap.get(orgKey) || 0;
            return {
              org_id: orgKey,
              org_name: org.name,
              student_count: studentCount,
              warning_count: orgWarningCount,
              warning_rate: studentCount > 0 ? `${((orgWarningCount / studentCount) * 100).toFixed(1)}%` : '0%',
            };
          })
          .sort((left, right) => right.student_count - left.student_count);

        return {
          stats: {
            totalStudents,
            totalTeachers,
            totalOrgs,
            totalClasses,
            totalCourses,
            warningRate,
            closureRate,
          },
          collegeStats,
        };
      },
      this.statsCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  @Get('grades')
  @Permissions('grade:read')
  async getGrades(
    @Query('keyword') keyword?: string,
    @Query('class_id') classId?: string,
    @Query('course_id') courseId?: string,
    @Query('term_code') termCode?: string,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Req() req?: any,
  ) {
    const where: any = {};

    const studentUserIds = await this.getGradeStudentUserIds(keyword, classId);
    if (studentUserIds && studentUserIds.length === 0) {
      return {
        code: 0,
        message: 'ok',
        data: {
          list: [],
          total: 0,
          page,
          pageSize,
        },
        trace_id: req?.trace_id,
      };
    }

    if (studentUserIds) {
      where.student_id = { in: studentUserIds };
    }

    if (courseId) {
      where.course_id = BigInt(courseId);
    }

    if (termCode) {
      where.term_code = termCode;
    }

    const [total, grades] = await Promise.all([
      this.prisma.grades.count({ where }),
      this.prisma.grades.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { created_at: 'desc' },
      }),
    ]);

    const { studentMap, courseMap } = await this.getGradeRelatedMaps(grades);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: grades.map((g: any) => {
          const student = studentMap.get(g.student_id.toString()) as any;
          const course = courseMap.get(g.course_id.toString()) as any;
          return {
            id: g.id.toString(),
            student_id: g.student_id.toString(),
            student_no: student?.student_no,
            student_name: student?.users?.name,
            class_id: student?.class_id?.toString(),
            class_name: student?.classes?.class_name,
            course_id: g.course_id.toString(),
            course_name: course?.course_name,
            score: g.score ? Number(g.score) : null,
            grade_point: g.grade_point ? Number(g.grade_point) : null,
            pass_status: g.pass_status,
            term_code: g.term_code,
            source: g.source,
            created_at: g.created_at,
          };
        }),
        total,
        page,
        pageSize,
      },
      trace_id: req?.trace_id,
    };
  }

  @Post('grades')
  @Permissions('grade:update')
  async createGrade(@Body() dto: CreateGradeDto, @Req() req: any) {
    const studentId = BigInt(dto.student_id);
    const courseId = BigInt(dto.course_id);

    const student = await this.prisma.student_profiles.findUnique({
      where: { user_id: studentId },
    });
    
    if (!student) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const course = await this.prisma.courses.findUnique({
      where: { id: courseId },
    });
    
    if (!course) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    let passStatus = dto.pass_status;
    if (!passStatus) {
      passStatus = dto.score >= 60 ? 'pass' : 'fail';
    }

    const grade = await this.prisma.grades.create({
      data: {
        student_id: studentId,
        course_id: courseId,
        term_code: dto.term_code,
        score: dto.score,
        pass_status: passStatus,
        source: 'manual',
      },
    });

    const operatorId = this.getOperatorId(req);
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: operatorId,
        action: 'grade.create',
        entity_type: 'grade',
        entity_id: grade.id,
        before_json: Prisma.JsonNull,
        after_json: serializeForAudit({
          student_id: studentId,
          course_id: courseId,
          term_code: dto.term_code,
          score: dto.score,
          pass_status: passStatus,
          source: 'manual',
        }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: 'ok',
      data: { id: grade.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Put('grades/:id')
  @Permissions('grade:update')
  async updateGrade(
    @Param('id') id: string,
    @Body() dto: UpdateGradeDto,
    @Req() req: any,
  ) {
    const gradeId = BigInt(id);
    const operatorId = this.getOperatorId(req);
    
    const existingGrade = await this.prisma.grades.findUnique({
      where: { id: gradeId },
    });

    if (!existingGrade) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    const passStatus = dto.score >= 60 ? 'pass' : 'fail';
    const isSysAdmin = await this.isSysAdmin(operatorId);

    if (isSysAdmin) {
      const grade = await this.prisma.grades.update({
        where: { id: gradeId },
        data: {
          score: dto.score,
          pass_status: passStatus,
          source: 'manual',
        },
      });

      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: operatorId,
          action: 'grade.update',
          entity_type: 'grade',
          entity_id: gradeId,
          before_json: serializeForAudit({
            score: existingGrade.score,
            pass_status: existingGrade.pass_status,
            source: existingGrade.source,
          }) as any,
          after_json: serializeForAudit({
            score: dto.score,
            pass_status: passStatus,
            source: 'manual',
          }) as any,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });

      return {
        code: 0,
        message: '成绩已更新',
        data: { id: grade.id.toString() },
        trace_id: req.trace_id,
      };
    }

    const [student, course, pendingRequest] = await Promise.all([
      this.prisma.student_profiles.findFirst({
        where: { user_id: existingGrade.student_id },
        include: { users: true },
      }),
      this.prisma.courses.findUnique({
        where: { id: existingGrade.course_id },
        select: { id: true, course_name: true },
      }),
      this.prisma.change_requests.findFirst({
        where: {
          target_type: 'grade',
          target_id: gradeId,
          status: { in: [...CHANGE_REQUEST_DEAN_QUEUE_STATUSES] },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    if (pendingRequest) {
      return {
        code: 409,
        message: '该成绩已有待处理的特殊审批，请勿重复提交',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentScore = existingGrade.score?.toString() || null;
    const targetScore = String(dto.score);
    if (currentScore === targetScore && existingGrade.pass_status === passStatus) {
      return {
        code: 400,
        message: '成绩未发生变化',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentValue = this.formatGradeApprovalValue({
      courseName: course?.course_name,
      termCode: existingGrade.term_code,
      score: currentScore,
      passStatus: existingGrade.pass_status,
    });
    const targetValue = this.formatGradeApprovalValue({
      courseName: course?.course_name,
      termCode: existingGrade.term_code,
      score: targetScore,
      passStatus,
    });

    const request = await this.prisma.change_requests.create({
      data: {
        requester_user_id: operatorId,
        target_type: 'grade',
        target_id: gradeId,
        reason: `申请修正 ${student?.users?.name || student?.student_no || '学生'} 的课程成绩`,
        status: CHANGE_REQUEST_STATUS.PENDING_DEAN,
        change_json: {
          request_type: 'grade_change',
          workflow_stage: 'vice_dean_review',
          student_name: student?.users?.name || '',
          student_no: student?.student_no || '',
          course_name: course?.course_name || '',
          term_code: existingGrade.term_code,
          current_score: currentScore,
          target_score: targetScore,
          current_pass_status: existingGrade.pass_status,
          target_pass_status: passStatus,
          current_value: currentValue,
          target_value: targetValue,
        } as any,
      },
    });

    return {
      code: 0,
      message: '已提交成绩修正审批，等待教学副院长或系统管理员处理',
      data: {
        id: request.id.toString(),
        workflow_status: normalizeChangeRequestStatus(request.status),
        approval_submitted: true,
      },
      trace_id: req.trace_id,
    };
  }

  @Delete('grades/:id')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async deleteGrade(@Param('id') id: string, @Req() req: any) {
    const gradeId = BigInt(id);
    const operatorId = this.getOperatorId(req);

    const existingGrade = await this.prisma.grades.findUnique({
      where: { id: gradeId },
    });

    if (!existingGrade) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    // ----------------------------------------------------------------
    // 删除成绩必须走审批（本轮修复）
    //
    // 与 updateGrade 保持一致：**只有系统管理员**可以直接改数据，
    // 其余角色（dean / teaching_admin）必须提交变更申请，由教学副院长审批。
    //
    // 修复前这里**没有任何角色判断**：任何拥有 dean / teaching_admin
    // 角色的账号都能用 `DELETE /teaching-admin/grades/:id` **直接物理删除**
    // 任意成绩记录 —— 绕过了 updateGrade 精心设计的审批流。
    // 换句话说，改成绩要审批，但**删成绩不用**，等于审批形同虚设。
    //
    // 这里改为：非 sys_admin 一律 403，并提示走成绩修正申请流程。
    // 不做"自动建 change_request"是对的选择 —— DELETE 语义无法表达
    // "把成绩改成 X"，应由调用方改用 PUT（其内部会创建审批单）。
    // ----------------------------------------------------------------
    if (!(await this.isSysAdmin(operatorId))) {
      return {
        code: 403,
        message:
          '删除成绩需系统管理员权限；如为成绩修正，请使用成绩修改（提交审批）而非删除',
        data: null,
        trace_id: req.trace_id,
      };
    }

    await this.prisma.grades.delete({
      where: { id: gradeId },
    });

    // 删除与审计分开处理：审计写入失败不应把整个请求打成 500。
    //
    // 实测（修复前）：删除本身成功（行确实没了），但随后的 audit_logs.create
    // 抛错，请求返回 500 —— 调用方以为失败，实际数据已被删除，
    // 这种"报错但已生效"的语义最容易造成误操作与重复删除。
    // 现在：审计失败只记日志，删除结果如实返回。
    try {
      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: operatorId,
          action: 'grade.delete',
          entity_type: 'grade',
          entity_id: gradeId,
          before_json: existingGrade ? (serializeForAudit(existingGrade) as any) : Prisma.JsonNull,
          after_json: Prisma.JsonNull,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });
    } catch (auditError: any) {
      this.logger.warn(
        `[deleteGrade] 审计日志写入失败（删除已生效） gradeId=${gradeId.toString()}: ${auditError?.message || auditError}`,
      );
    }

    return {
      code: 0,
      message: 'ok',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Get('students')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async getStudents(
    @Query('keyword') keyword?: string,
    @Query('class_id') classId?: string,
    @Query('org_id') orgId?: string,
    @Query('page') page: number | string = 1,
    @Query('pageSize') pageSize: number | string = 20,
    @Req() req?: any,
  ) {
    const where: any = {};
    const pageNumber = Math.max(parseInt(String(page || 1), 10) || 1, 1);
    const pageSizeNumber = Math.max(parseInt(String(pageSize || 20), 10) || 20, 1);
    
    if (keyword) {
      where.OR = [
        { student_no: { contains: keyword } },
        { users: { name: { contains: keyword } } },
      ];
    }
    
    if (classId) {
      where.class_id = BigInt(classId);
    }
    
    if (orgId) {
      where.org_id = BigInt(orgId);
    }

    const [total, students] = await Promise.all([
      this.prisma.student_profiles.count({ where }),
      this.prisma.student_profiles.findMany({
        where,
        include: {
          users: true,
          classes: {
            include: {
              orgs: true,
            },
          },
          majors: true,
        } as any,
        skip: (pageNumber - 1) * pageSizeNumber,
        take: pageSizeNumber,
        orderBy: { created_at: 'desc' },
      }),
    ]);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: students.map((s: any) => ({
          id: s.id.toString(),
          user_id: s.user_id.toString(),
          student_no: s.student_no,
          name: s.users?.name,
          gender: s.gender,
          class_id: s.class_id?.toString(),
          class_name: s.classes?.class_name,
          org_id: s.classes?.org_id?.toString(),
          org_name: s.classes?.orgs?.name,
          major_id: s.major_id?.toString(),
          major: s.major,
          enroll_year: s.enroll_year,
          status: s.status,
          mobile: s.mobile,
          email: s.email,
          created_at: s.created_at,
        })),
        total,
        page: pageNumber,
        pageSize: pageSizeNumber,
      },
      trace_id: req?.trace_id,
    };
  }

  @Put('students/:id')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async updateStudentProfile(
    @Param('id') id: string,
    @Body() dto: UpdateStudentProfileDto,
    @Req() req: any,
  ) {
    const profileId = BigInt(id);
    const operatorId = this.getOperatorId(req);
    
    const existingProfile = await this.prisma.student_profiles.findUnique({
      where: { id: profileId },
      include: {
        users: true,
        classes: {
          include: {
            orgs: true,
          },
        },
        majors: true,
      } as any,
    }) as any;

    if (!existingProfile) {
      return { code: 404, message: '操作失败', data: null, trace_id: req.trace_id };
    }

    let targetClass: any = existingProfile.classes || null;
    if (dto.class_id) {
      targetClass = await this.prisma.classes.findUnique({
        where: { id: BigInt(dto.class_id) },
        include: {
          orgs: true,
        },
      }) as any;
      if (!targetClass) {
        return { code: 404, message: '目标班级不存在', data: null, trace_id: req.trace_id };
      }
    }

    let targetMajorRecord: any = existingProfile.majors || null;
    if (dto.major_id) {
      targetMajorRecord = await this.prisma.majors.findUnique({
        where: { id: BigInt(dto.major_id) },
      });
    }

    const targetClassId =
      dto.class_id !== undefined ? BigInt(dto.class_id) : existingProfile.class_id;
    const targetOrgId =
      targetClass?.org_id
      || existingProfile.classes?.org_id
      || existingProfile.org_id;
    const targetMajorId =
      dto.major_id !== undefined
        ? (dto.major_id ? BigInt(dto.major_id) : null)
        : dto.class_id
          ? targetClass?.major_id || existingProfile.major_id
          : existingProfile.major_id;
    const targetMajor =
      dto.major !== undefined
        ? dto.major
        : dto.major_id !== undefined
          ? targetMajorRecord?.name || existingProfile.major
          : dto.class_id
            ? targetClass?.major || existingProfile.major
            : existingProfile.major;
    const targetEnrollYear =
      dto.enroll_year !== undefined
        ? dto.enroll_year
        : dto.class_id
          ? targetClass?.enroll_year || existingProfile.enroll_year
          : existingProfile.enroll_year;
    const targetStatus = dto.status !== undefined ? dto.status : existingProfile.status;

    const hasChanges =
      existingProfile.class_id.toString() !== targetClassId.toString()
      || String(existingProfile.org_id || '') !== String(targetOrgId || '')
      || String(existingProfile.major_id || '') !== String(targetMajorId || '')
      || String(existingProfile.major || '') !== String(targetMajor || '')
      || String(existingProfile.enroll_year || '') !== String(targetEnrollYear || '')
      || String(existingProfile.status || '') !== String(targetStatus || '');

    if (!hasChanges) {
      return {
        code: 400,
        message: '学籍信息未发生变化',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const isSysAdmin = await this.isSysAdmin(operatorId);
    if (isSysAdmin) {
      const updateData: any = {
        class_id: targetClassId,
        org_id: targetOrgId,
        major_id: targetMajorId,
        major: targetMajor,
        enroll_year: targetEnrollYear,
        status: targetStatus,
      };

      const profile = await this.prisma.student_profiles.update({
        where: { id: profileId },
        data: updateData,
      });

      await this.prisma.users.update({
        where: { id: existingProfile.user_id },
        data: {
          org_id: targetOrgId || null,
          status: targetStatus === 'active' ? 'active' : 'inactive',
        },
      });

      await this.prisma.user_roles.updateMany({
        where: {
          user_id: existingProfile.user_id,
          role: 'class_monitor',
        },
        data: {
          scope_type: 'class',
          scope_id: targetClassId,
        },
      });

      await this.prisma.warnings.updateMany({
        where: { student_id: profileId },
        data: {
          class_id: profile.class_id,
          org_id: targetOrgId || profile.org_id || BigInt(0),
        },
      });

      await this.prisma.audit_logs.create({
        data: {
          actor_user_id: operatorId,
          action: 'student_profile.update',
          entity_type: 'student_profile',
          entity_id: profileId,
          before_json: serializeForAudit({
            class_id: existingProfile.class_id,
            org_id: existingProfile.org_id,
            major_id: existingProfile.major_id,
            major: existingProfile.major,
            enroll_year: existingProfile.enroll_year,
            status: existingProfile.status,
          }) as any,
          after_json: serializeForAudit({
            class_id: targetClassId,
            org_id: targetOrgId,
            major_id: targetMajorId,
            major: targetMajor,
            enroll_year: targetEnrollYear,
            status: targetStatus,
          }) as any,
          ip: req.ip,
          user_agent: req.headers['user-agent']
            ? String(req.headers['user-agent']).slice(0, 255)
            : '',
        },
      });

      return {
        code: 0,
        message: '学籍信息已更新',
        data: { id: profile.id.toString() },
        trace_id: req.trace_id,
      };
    }

    const pendingRequest = await this.prisma.change_requests.findFirst({
      where: {
        target_type: 'student_profile',
        target_id: profileId,
        status: { in: [...CHANGE_REQUEST_DEAN_QUEUE_STATUSES] },
      },
      orderBy: { created_at: 'desc' },
    });
    if (pendingRequest) {
      return {
        code: 409,
        message: '该学生已有待处理的学籍变更审批，请勿重复提交',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const currentValue = this.formatStudentProfileApprovalValue({
      orgName: existingProfile.classes?.orgs?.name || '',
      className: existingProfile.classes?.class_name || '',
      major: existingProfile.major,
      enrollYear: existingProfile.enroll_year,
      status: existingProfile.status,
    });
    const targetValue = this.formatStudentProfileApprovalValue({
      orgName: targetClass?.orgs?.name || existingProfile.classes?.orgs?.name || '',
      className: targetClass?.class_name || existingProfile.classes?.class_name || '',
      major: targetMajor,
      enrollYear: targetEnrollYear,
      status: targetStatus,
    });

    const request = await this.prisma.change_requests.create({
      data: {
        requester_user_id: operatorId,
        target_type: 'student_profile',
        target_id: profileId,
        reason: `申请变更 ${existingProfile.users?.name || existingProfile.student_no} 的学籍信息`,
        status: CHANGE_REQUEST_STATUS.PENDING_DEAN,
        change_json: {
          request_type: 'student_profile_change',
          workflow_stage: 'vice_dean_review',
          student_name: existingProfile.users?.name || '',
          student_no: existingProfile.student_no,
          class_id: targetClassId.toString(),
          class_name: targetClass?.class_name || existingProfile.classes?.class_name || '',
          current_class_name: existingProfile.classes?.class_name || '',
          org_id: targetOrgId?.toString() || null,
          org_name: targetClass?.orgs?.name || existingProfile.classes?.orgs?.name || '',
          current_org_name: existingProfile.classes?.orgs?.name || '',
          major_id: targetMajorId?.toString() || null,
          major: targetMajor,
          current_major: existingProfile.major,
          enroll_year: targetEnrollYear,
          current_enroll_year: existingProfile.enroll_year,
          status: targetStatus,
          current_status: existingProfile.status,
          current_value: currentValue,
          target_value: targetValue,
        } as any,
      },
    });

    return {
      code: 0,
      message: '已提交学籍变更审批，等待教学副院长或系统管理员处理',
      data: {
        id: request.id.toString(),
        workflow_status: normalizeChangeRequestStatus(request.status),
        approval_submitted: true,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('courses')
  @Roles('dean', 'teaching_admin', 'sys_admin')
  async getCourses(
    @Query('keyword') keyword?: string,
    @Query('org_id') orgId?: string,
    @Req() req?: any,
  ) {
    const cacheKey = `teaching-admin:courses:${String(orgId || 'all')}:${String(keyword || '').trim() || 'all'}`;
    const data = await this.getCachedPayload(
      cacheKey,
      async () => {
        const where: any = {};
        
        if (keyword) {
          where.OR = [
            { course_code: { contains: keyword } },
            { course_name: { contains: keyword } },
          ];
        }
        
        if (orgId) {
          where.org_id = BigInt(orgId);
        }

        const courses = await this.prisma.courses.findMany({
          where,
          include: { orgs: true },
          orderBy: { created_at: 'desc' },
        });

        return courses.map((c: any) => ({
          id: c.id.toString(),
          org_id: c.org_id.toString(),
          org_name: c.orgs?.name,
          course_code: c.course_code,
          course_name: c.course_name,
          credit: c.credit ? Number(c.credit) : null,
          status: c.status,
        }));
      },
      this.dictionaryCacheTtlSeconds,
    );

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req?.trace_id,
    };
  }

  @Get('grades/stats')
  @Permissions('grade:read')
  async getGradesStats(
    @Query('class_id') classId?: string,
    @Query('course_id') courseId?: string,
    @Query('term_code') termCode?: string,
    @Req() req?: any,
  ) {
    const where: any = {};

    const studentUserIds = await this.getGradeStudentUserIds(undefined, classId);
    if (studentUserIds && studentUserIds.length === 0) {
      return {
        code: 0,
        message: 'ok',
        data: {
          totalCount: 0,
          avgScore: 0,
          maxScore: 0,
          minScore: 0,
          passCount: 0,
          passRate: '0%',
          excellentCount: 0,
          excellentRate: '0%',
          scoreDistribution: [],
        },
        trace_id: req?.trace_id,
      };
    }

    if (studentUserIds) {
      where.student_id = { in: studentUserIds };
    }

    if (courseId) {
      where.course_id = BigInt(courseId);
    }

    if (termCode) {
      where.term_code = termCode;
    }

    const grades = await this.prisma.grades.findMany({
      where,
      select: {
        score: true,
      },
    });

    if (grades.length === 0) {
      return {
        code: 0,
        message: 'ok',
        data: {
          totalCount: 0,
          avgScore: 0,
          maxScore: 0,
          minScore: 0,
          passCount: 0,
          passRate: '0%',
          excellentCount: 0,
          excellentRate: '0%',
          scoreDistribution: [],
        },
        trace_id: req?.trace_id,
      };
    }

    const scores = grades.map((g: any) => g.score ? Number(g.score) : 0).filter((s: number) => s > 0);
    const totalCount = scores.length;
    const avgScore = scores.reduce((a: number, b: number) => a + b, 0) / totalCount;
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const passCount = scores.filter((s: number) => s >= 60).length;
    const passRate = `${((passCount / totalCount) * 100).toFixed(1)}%`;
    const excellentCount = scores.filter((s: number) => s >= 90).length;
    const excellentRate = `${((excellentCount / totalCount) * 100).toFixed(1)}%`;

    const scoreDistribution = [
      { range: '0-59', count: scores.filter((s: number) => s < 60).length },
      { range: '60-69', count: scores.filter((s: number) => s >= 60 && s < 70).length },
      { range: '70-79', count: scores.filter((s: number) => s >= 70 && s < 80).length },
      { range: '80-89', count: scores.filter((s: number) => s >= 80 && s < 90).length },
      { range: '90-100', count: scores.filter((s: number) => s >= 90).length },
    ];

    return {
      code: 0,
      message: 'ok',
      data: {
        totalCount,
        avgScore: Number(avgScore.toFixed(1)),
        maxScore,
        minScore,
        passCount,
        passRate,
        excellentCount,
        excellentRate,
        scoreDistribution,
      },
      trace_id: req?.trace_id,
    };
  }

  @Get('grades/export')
  @Permissions('grade:read')
  async exportGrades(
    @Query('class_id') classId?: string,
    @Query('course_id') courseId?: string,
    @Query('term_code') termCode?: string,
    @Req() req?: any,
  ) {
    const where: any = {};

    const studentUserIds = await this.getGradeStudentUserIds(undefined, classId);
    if (studentUserIds && studentUserIds.length === 0) {
      return {
        code: 0,
        message: 'ok',
        data: [],
        trace_id: req?.trace_id,
      };
    }

    if (studentUserIds) {
      where.student_id = { in: studentUserIds };
    }

    if (courseId) {
      where.course_id = BigInt(courseId);
    }

    if (termCode) {
      where.term_code = termCode;
    }

    const grades = await this.prisma.grades.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    const { studentMap, courseMap } = await this.getGradeRelatedMaps(grades);

    const exportData = grades.map((g: any) => ({
      student_no: (studentMap.get(g.student_id.toString()) as any)?.student_no || '',
      name: (studentMap.get(g.student_id.toString()) as any)?.users?.name || '',
      class_name: (studentMap.get(g.student_id.toString()) as any)?.classes?.class_name || '',
      course_name: (courseMap.get(g.course_id.toString()) as any)?.course_name || '',
      score: g.score ? Number(g.score) : '',
      pass_status: g.pass_status === 'pass' ? 'pass' : 'fail',
      term_code: g.term_code || '',
    }));

    return {
      code: 0,
      message: 'ok',
      data: exportData,
      trace_id: req?.trace_id,
    };
  }

  @Get('grades/import-template')
  @Permissions('grade:import')
  async getGradesImportTemplate(@Req() req: any) {
    const template = await this.getGradeImportTemplate();
    return {
      code: 0,
      message: 'ok',
      data: template,
      trace_id: req?.trace_id,
    };
  }

  @Post('grades/import-template')
  @Permissions('grade:import')
  async setGradesImportTemplate(
    @Body() dto: UpdateGradeImportTemplateDto,
    @Req() req: any,
  ) {
    let template: any;
    try {
      template = await saveImportTemplate(this.prisma, 'grades', dto);
    } catch (error: any) {
      return {
        code: 400,
        message: error?.message || '导入模板配置不合法',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return {
      code: 0,
      message: '保存成功',
      data: template,
      trace_id: req.trace_id,
    };
  }

  @Post('grades/import')
  @Permissions('grade:import')
  async importGrades(@Body() dto: ImportGradesDto, @Req() req: any) {
    const rows = Array.isArray(dto?.rows) ? dto.rows : [];
    if (rows.length === 0) {
      return {
        code: 400,
        message: '导入数据不能为空',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const template = await this.getGradeImportTemplate();
    const enabledFields = template.fields.filter((field: any) => field.enabled);
    const requiredFields = enabledFields.filter((field: any) => field.required);
    const headerMap = new Map(
      enabledFields.map((field: any) => [field.key, String(field.columnName || '').trim()]),
    );

    const result = {
      success: 0,
      updated: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] || {};
      const rowNo = index + 2;

      try {
        for (const field of requiredFields) {
          const rawValue = row[headerMap.get(field.key) || ''];
          if (!String(rawValue ?? '').trim()) {
            throw new Error(`${field.label}不能为空`);
          }
        }

        const studentNo = String(row[headerMap.get('student_no') || ''] || '').trim();
        const termCode = String(row[headerMap.get('term_code') || ''] || '').trim();
        const scoreText = String(row[headerMap.get('score') || ''] || '').trim();
        const courseCode = String(row[headerMap.get('course_code') || ''] || '').trim();
        const courseName = String(row[headerMap.get('course_name') || ''] || '').trim();
        const score = Number(scoreText);

        if (!Number.isFinite(score) || score < 0 || score > 100) {
          throw new Error('成绩必须是 0-100 之间的数值');
        }

        const student = await this.prisma.student_profiles.findUnique({
          where: { student_no: studentNo },
          include: { users: true, classes: true },
        });

        if (!student) {
          throw new Error(`未找到学号为 ${studentNo} 的学生`);
        }

        let course = null as any;
        if (courseCode) {
          course = await this.prisma.courses.findFirst({
            where: {
              course_code: courseCode,
            },
          });
        }

        if (!course && courseName) {
          const courses = await this.prisma.courses.findMany({
            where: {
              course_name: courseName,
              ...(student.org_id ? { org_id: student.org_id } : {}),
            },
            take: 2,
          });

          if (courses.length > 1) {
            throw new Error(`课程 ${courseName} 存在重名，请在导入模板中启用课程代码列`);
          }

          course = courses[0] || null;
        }

        if (!course) {
          throw new Error(`未找到课程 ${courseCode || courseName || ''}`.trim());
        }

        const payload = {
          student_id: student.user_id,
          course_id: course.id,
          term_code: termCode,
          score,
          pass_status: score >= 60 ? 'pass' : 'fail',
          source: 'import',
        };

        const exists = await this.prisma.grades.findUnique({
          where: {
            student_id_course_id_term_code: {
              student_id: student.user_id,
              course_id: course.id,
              term_code: termCode,
            },
          },
          select: { id: true },
        });

        await this.prisma.grades.upsert({
          where: {
            student_id_course_id_term_code: {
              student_id: student.user_id,
              course_id: course.id,
              term_code: termCode,
            },
          },
          update: payload,
          create: payload,
        });

        if (exists) {
          result.updated += 1;
        } else {
          result.success += 1;
        }
      } catch (error: any) {
        result.failed += 1;
        result.errors.push(`第 ${rowNo} 行：${error?.message || '导入失败'}`);
      }
    }

    const operatorId = this.getOperatorId(req);
    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: operatorId,
        action: 'grade.import',
        entity_type: 'grade',
        entity_id: 0n,
        before_json: Prisma.JsonNull,
        after_json: serializeForAudit({
          total_rows: rows.length,
          success: result.success,
          updated: result.updated,
          failed: result.failed,
          errors: result.errors,
        }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: result.failed > 0 ? 1 : 0,
      message: result.failed > 0 ? '部分成绩导入失败' : '成绩导入成功',
      data: result,
      trace_id: req.trace_id,
    };
  }
}

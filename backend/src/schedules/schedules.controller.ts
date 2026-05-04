import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../shared/auth.guard';
import { PrismaService } from '../shared/prisma.service';
import { ConfigService } from '../config/config.service';
import {
  DEFAULT_SEMESTER_TOTAL_WEEKS,
  formatDateOnly,
  getDefaultSemesterStartDate,
  resolveSemesterStartDate,
  resolveSemesterTotalWeeks,
} from '../shared/academic-calendar.util';
import { getHeadTeacherClassScopeIds } from '../shared/head-teacher-scope.util';

@Controller('schedules')
@UseGuards(AuthGuard)
export class SchedulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private normalizeTermCode(value?: string) {
    return String(value || '').trim().toUpperCase();
  }

  private getCurrentTermCode(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    if (month >= 2 && month <= 7) {
      return `${year}-SPRING`;
    }
    if (month >= 8) {
      return `${year}-FALL`;
    }
    return `${year - 1}-FALL`;
  }

  private toSafeIsoString(value?: Date | string | null) {
    if (!value) {
      return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toISOString();
  }

  @Get('semester-config')
  async getSemesterConfig(@Req() req: any) {
    const teachingConfig = await this.configService.getSectionConfig('teaching', {});
    const semesterStartDate = resolveSemesterStartDate(
      teachingConfig?.semesterStartDate,
    );
    const semesterTotalWeeks = resolveSemesterTotalWeeks(teachingConfig?.semesterTotalWeeks);

    return {
      code: 0,
      message: 'ok',
      data: {
        semester_start_date: formatDateOnly(semesterStartDate),
        default_semester_start_date: formatDateOnly(getDefaultSemesterStartDate()),
        semester_total_weeks: semesterTotalWeeks,
        default_semester_total_weeks: DEFAULT_SEMESTER_TOTAL_WEEKS,
      },
      trace_id: req.trace_id,
    };
  }

  private async getUserRoleCodes(userId: bigint) {
    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { role: true },
    });
    return roles.map((item: any) => String(item.role || '').trim());
  }

  private async buildScheduleList(where: any) {
    const schedules = await this.prisma.schedules.findMany({
      where: {
        ...where,
        status: 'active',
      },
      orderBy: {
        session_start: 'asc',
      },
    });

    const courseIds = [...new Set(schedules.map((item: any) => item.course_id))] as bigint[];
    const classIds = [...new Set(schedules.map((item: any) => item.class_id))] as bigint[];
    const teacherUserIds = [...new Set(schedules.map((item: any) => item.teacher_user_id))] as bigint[];

    const [courses, classes, users] = await Promise.all([
      courseIds.length
        ? this.prisma.courses.findMany({ where: { id: { in: courseIds } } })
        : Promise.resolve([] as any[]),
      classIds.length
        ? this.prisma.classes.findMany({ where: { id: { in: classIds } } })
        : Promise.resolve([] as any[]),
      teacherUserIds.length
        ? this.prisma.users.findMany({ where: { id: { in: teacherUserIds } } })
        : Promise.resolve([] as any[]),
    ]);

    const courseMap = new Map(courses.map((item: any) => [item.id.toString(), item]));
    const classMap = new Map(classes.map((item: any) => [item.id.toString(), item]));
    const userMap = new Map(users.map((item: any) => [item.id.toString(), item]));

    return schedules.map((item: any) => {
      const course = courseMap.get(item.course_id.toString()) as any;
      const clazz = classMap.get(item.class_id.toString()) as any;
      const user = userMap.get(item.teacher_user_id.toString()) as any;

      return {
        id: item.id.toString(),
        course_id: item.course_id?.toString() || '',
        course_code: course?.course_code || '',
        course_name: course?.course_name || '未命名课程',
        class_id: item.class_id?.toString() || '',
        class_name: clazz?.class_name || '未绑定班级',
        teacher_user_id: item.teacher_user_id?.toString() || '',
        teacher_name: user?.name || '未分配教师',
        term_code: item.term_code || '',
        session_start: this.toSafeIsoString(item.session_start),
        session_end: this.toSafeIsoString(item.session_end),
        expire_minutes:
          item.session_start && item.session_end
            ? Math.max(
                1,
                Math.round(
                  (new Date(item.session_end).getTime() - new Date(item.session_start).getTime()) / 60000,
                ),
              )
            : 15,
      };
    });
  }

  @Get()
  async listSchedules(
    @Query('term_code') termCode?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();

    if (req.user?.userType !== 'student' || !req.user?.userId) {
      return {
        code: 401,
        message: '未授权访问',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const student = await this.prisma.student_profiles.findFirst({
      where: req.user?.studentId
        ? { id: BigInt(req.user.studentId) }
        : { user_id: BigInt(req.user.userId) },
      include: { classes: true },
    });

    if (!student) {
      return {
        code: 404,
        message: '学生档案不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const where: any = {
      class_id: student.class_id,
      status: 'active',
    };

    if (termCode) {
      where.term_code = termCode;
    }

    const schedules = await this.prisma.schedules.findMany({
      where,
      include: {
        courses: true,
        users: true,
      },
      orderBy: {
        session_start: 'asc',
      },
    });

    const courseIds = [...new Set(schedules.map((item: any) => item.course_id))] as bigint[];
    const teacherUserIds = [...new Set(schedules.map((item: any) => item.teacher_user_id))] as bigint[];

    const courses = await this.prisma.courses.findMany({
      where: { id: { in: courseIds } },
    });
    const users = await this.prisma.users.findMany({
      where: { id: { in: teacherUserIds } },
    });

    const courseMap = new Map(courses.map((item: any) => [item.id, item]));
    const userMap = new Map(users.map((item: any) => [item.id, item]));

    const updatedSchedules = schedules.map((item: any) => {
      const course = courseMap.get(item.course_id) as any;
      const user = userMap.get(item.teacher_user_id) as any;

      return {
        course_name: course?.course_name || '未知课程',
        teacher_name: user?.name || '未知教师',
        session_start: this.toSafeIsoString(item.session_start),
        session_end: this.toSafeIsoString(item.session_end),
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: updatedSchedules,
      trace_id: req.trace_id,
    };
  }

  @Get('view')
  async getRoleSchedulesView(
    @Query('term_code') termCode?: string,
    @Query('scope') scope?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();

    const userIdText = String(req.user?.userId || '').trim();
    if (!userIdText) {
      return {
        code: 401,
        message: 'Unauthorized',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const userId = BigInt(userIdText);
    const userType = String(req.user?.userType || req.user?.user_type || '').trim();
    const roleCodes = await this.getUserRoleCodes(userId);
    const roleSet = new Set(roleCodes);
    const normalizedTermCode = this.normalizeTermCode(termCode) || this.getCurrentTermCode();

    const isHeadTeacher = roleSet.has('head_teacher');
    const isTeacher = userType === 'teacher' || roleSet.has('teacher') || isHeadTeacher;
    const isStudentLike = userType === 'student' || roleSet.has('student') || roleSet.has('class_monitor');

    if (!isHeadTeacher && !isTeacher && !isStudentLike) {
      return {
        code: 403,
        message: '无权查看课表',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const availableScopes = isHeadTeacher
      ? ['class', 'teaching']
      : [isTeacher && !isStudentLike ? 'teaching' : 'class'];
    const activeScope = availableScopes.includes(String(scope || '').trim())
      ? String(scope).trim()
      : availableScopes[0];

    if (activeScope === 'class') {
      if (isStudentLike && !isHeadTeacher) {
        const student = await this.prisma.student_profiles.findFirst({
          where: req.user?.studentId
            ? { id: BigInt(req.user.studentId) }
            : { user_id: userId },
          include: { classes: true },
        });

        if (!student?.class_id) {
          return {
            code: 400,
            message: '学生尚未绑定班级',
            data: null,
            trace_id: req.trace_id,
          };
        }

        const list = await this.buildScheduleList({
          class_id: student.class_id,
          term_code: normalizedTermCode,
        });

        return {
          code: 0,
          message: 'ok',
          data: {
            list,
            active_scope: 'class',
            available_scopes: availableScopes,
            term_code: normalizedTermCode,
            context_label: student.classes?.class_name || '',
          },
          trace_id: req.trace_id,
        };
      }

      const headTeacherClassIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
        activeOnly: true,
      });

      if (headTeacherClassIds.length === 0) {
        return {
          code: 400,
          message: '班主任尚未绑定班级',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const boundClasses = await this.prisma.classes.findMany({
        where: { id: { in: headTeacherClassIds } },
        select: { id: true, class_name: true },
        orderBy: [{ enroll_year: 'desc' }, { id: 'asc' }],
      });

      const list = await this.buildScheduleList({
        class_id: { in: headTeacherClassIds },
        term_code: normalizedTermCode,
      });

      return {
        code: 0,
        message: 'ok',
        data: {
          list,
          active_scope: 'class',
          available_scopes: availableScopes,
          term_code: normalizedTermCode,
          context_label:
            boundClasses.length === 1
              ? boundClasses[0]?.class_name || ''
              : `负责班级 ${boundClasses.length} 个`,
        },
        trace_id: req.trace_id,
      };
    }

    const list = await this.buildScheduleList({
      teacher_user_id: userId,
      term_code: normalizedTermCode,
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        list,
        active_scope: 'teaching',
        available_scopes: availableScopes,
        term_code: normalizedTermCode,
        context_label: '本人任教',
      },
      trace_id: req.trace_id,
    };
  }
}

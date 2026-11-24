import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RolesGuard, Roles } from '../shared/roles.guard';
import { PinoLogger } from 'nestjs-pino';
import { serializeForAudit } from '../shared/json.util';
import {
  CHANGE_REQUEST_DEAN_QUEUE_STATUSES,
  CHANGE_REQUEST_STATUS,
  normalizeChangeRequestStatus,
} from '../shared/change-request-status.util';

class ReviewTeacherCourseBindingRequestDto {
  reason?: string;
}

@Controller('teaching-admin')
@UseGuards(AuthGuard, RolesGuard, PermissionGuard)
export class TeachingAdminController {
  private readonly dictionaryCacheTtlSeconds = 300;
  private readonly statsCacheTtlSeconds = 60;
  private readonly payloadCache = new Map<string, { data: any; expiresAt: number }>();
  private static readonly MAX_CACHE_SIZE = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('TeachingAdminController');
  }

  private async getCachedPayload<T>(cacheKey: string, loader: () => Promise<T>, ttlSeconds: number) {
    const now = Date.now();
    const cached = this.payloadCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }
    const data = await loader();
    if (this.payloadCache.size >= TeachingAdminController.MAX_CACHE_SIZE) {
      for (const [key, entry] of this.payloadCache) {
        if (entry.expiresAt <= now) {
          this.payloadCache.delete(key);
        }
      }
      if (this.payloadCache.size >= TeachingAdminController.MAX_CACHE_SIZE) {
        const firstKey = this.payloadCache.keys().next().value;
        if (firstKey !== undefined) {
          this.payloadCache.delete(firstKey);
        }
      }
    }
    this.payloadCache.set(cacheKey, { data, expiresAt: now + ttlSeconds * 1000 });
    return data;
  }

  private getOperatorId(req: any) {
    return BigInt(req.user.sub);
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

}

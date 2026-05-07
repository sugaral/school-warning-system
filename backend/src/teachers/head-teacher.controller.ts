import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { RolesGuard, Roles } from '../shared/roles.guard';
import { PinoLogger } from 'nestjs-pino';
import { serializeForAudit } from '../shared/json.util';
import {
  CHANGE_REQUEST_PENDING_HEAD_STATUSES,
  CHANGE_REQUEST_STATUS,
  normalizeChangeRequestStatus,
} from '../shared/change-request-status.util';
import { normalizeFileIdList } from '../shared/file.util';
import {
  getHeadTeacherClassScopeIds,
  getHeadTeacherOrgScopeIds,
} from '../shared/head-teacher-scope.util';

class BindClassDto {
  class_id!: string;
}

class ReviewClassChangeRequestDto {
  approve!: boolean;
  note?: string;
}

@Controller('head-teacher')
@UseGuards(AuthGuard, RolesGuard)
export class HeadTeacherController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('HeadTeacherController');
  }

  private deriveLeaveDisplayStatus(item: {
    status: string;
    from_date: Date;
    to_date: Date;
  }) {
    const now = Date.now();
    if (item.status === 'submitted') {
      return 'pending';
    }
    if (item.status === 'rejected') {
      return 'rejected';
    }
    if (item.status === 'approved') {
      if (new Date(item.to_date).getTime() < now) {
        return 'finished';
      }
      if (new Date(item.from_date).getTime() <= now) {
        return 'ongoing';
      }
      return 'approved';
    }
    return item.status;
  }

  private async getHeadTeacherRole(userId: bigint) {
    return this.prisma.user_roles.findFirst({
      where: {
        user_id: userId,
        role: 'head_teacher',
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
  }

  private async getAssignableOrgIds(userId: bigint): Promise<bigint[]> {
    const [user, headTeacherRole, teachingClasses, activeOrgs] = await Promise.all([
      this.prisma.users.findUnique({
        where: { id: userId },
        select: { org_id: true },
      }),
      this.getHeadTeacherRole(userId),
      this.prisma.course_classes.findMany({
        where: { teacher_user_id: userId },
        select: { class_id: true },
      }),
      this.prisma.orgs.findMany({
        where: { status: 'active' },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const scopedOrgIds = await getHeadTeacherOrgScopeIds(this.prisma, userId, {
      activeOnly: true,
    });

    if (!headTeacherRole?.scope_id && scopedOrgIds.length === 0) {
      return activeOrgs.map((item: any) => item.id);
    }

    const orgIds = new Set<string>();

    if (user?.org_id) {
      orgIds.add(user.org_id.toString());
    }

    scopedOrgIds.forEach((orgId) => orgIds.add(orgId.toString()));

    const classIds = teachingClasses.map((item: any) => item.class_id);
    if (classIds.length > 0) {
      const classes = await this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: { org_id: true },
      });
      for (const cls of classes) {
        if (cls.org_id) {
          orgIds.add(cls.org_id.toString());
        }
      }
    }

    const result = Array.from(orgIds).map((id) => BigInt(id));
    if (result.length > 0) {
      return result;
    }

    return activeOrgs.map((item: any) => item.id);
  }

  @Get('binding-status')
  @Roles('head_teacher')
  async getBindingStatus(@Req() req: any) {
    const userId = BigInt(req.user.sub);

    const classIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
      activeOnly: true,
    });
    const classes = classIds.length > 0
      ? await this.prisma.classes.findMany({
          where: { id: { in: classIds } },
          include: { orgs: true },
          orderBy: [{ enroll_year: 'desc' }, { id: 'asc' }],
        })
      : [];

    const boundClasses = classes.map((classInfo: any) => ({
      id: classInfo.id.toString(),
      class_name: classInfo.class_name,
      org_id: classInfo.org_id?.toString() || '',
      org_name: classInfo.orgs?.name || '',
      enroll_year: classInfo.enroll_year,
    }));
    const firstClass = boundClasses[0] || null;
    const boundOrgs = Array.from(
      new Map(
        boundClasses
          .filter((item) => item.org_id)
          .map((item) => [
            item.org_id,
            {
              id: item.org_id,
              name: item.org_name,
            },
          ]),
      ).values(),
    );

    return {
      code: 0,
      message: 'ok',
      data: {
        bound_class: firstClass
          ? {
              id: firstClass.id,
              class_name: firstClass.class_name,
            }
          : null,
        bound_org: firstClass?.org_id
          ? {
              id: firstClass.org_id,
              name: firstClass.org_name,
            }
          : null,
        bound_classes: boundClasses,
        bound_orgs: boundOrgs,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('stats')
  @Roles('head_teacher')
  async getStats(@Req() req: any) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.sub);

    const classIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
      activeOnly: true,
    });

    if (classIds.length === 0) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    // Batch: fetch student IDs once and reuse for all warning/leave queries
    const studentIds = (
      await this.prisma.student_profiles.findMany({
        where: { class_id: { in: classIds }, status: 'active' },
        select: { id: true },
      })
    ).map((s: any) => s.id);

    const totalStudents = studentIds.length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const warningStudentFilter = studentIds.length > 0
      ? { student_id: { in: studentIds } }
      : { student_id: { in: [BigInt(-1)] } };

    const [warningCount, redWarning, leaveCount] = await Promise.all([
      (this.prisma as any).warning_current_states.count({
        where: {
          ...warningStudentFilter,
          status: { in: ['open', 'acknowledged'] },
        },
      }),
      (this.prisma as any).warning_current_states.count({
        where: {
          ...warningStudentFilter,
          level: 'red',
          status: { in: ['open', 'acknowledged'] },
        },
      }),
      this.prisma.leave_requests.count({
        where: {
          ...warningStudentFilter,
          status: 'approved',
          from_date: { lte: tomorrow },
          to_date: { gte: today },
        },
      }),
    ]);

    return {
      code: 0,
      message: 'ok',
      data: {
        totalStudents,
        warningCount,
        redWarning,
        leaveCount,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('warnings')
  @Roles('head_teacher')
  async getWarnings(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();
    
    const userId = BigInt(req.user.sub);
    
    const classIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
      activeOnly: true,
    });

    if (classIds.length === 0) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const take = parseInt(pageSize);

    const studentIds = (
      await this.prisma.student_profiles.findMany({
        where: { class_id: { in: classIds } },
        select: { id: true },
      })
    ).map((s: any) => s.id);

    const [warnings, total] = await Promise.all([
      (this.prisma as any).warning_current_states.findMany({
        where: {
          student_id: { in: studentIds },
        },
        orderBy: { updated_at: 'desc' },
        skip,
        take,
      }),
      (this.prisma as any).warning_current_states.count({
        where: {
          student_id: { in: studentIds },
        },
      }),
    ]);

    const studentProfiles = await this.prisma.student_profiles.findMany({
      where: {
        id: { in: warnings.map((w: any) => w.student_id) },
      },
      include: {
        users: true,
      },
    });

    const studentMap = new Map(
      studentProfiles.map((sp: any) => [sp.id.toString(), sp]),
    );

    return {
      code: 0,
      message: 'ok',
      data: {
        list: warnings.map((w: any) => {
          const sp = studentMap.get(w.student_id.toString()) as any;
          return {
            id: w.id.toString(),
            student_id: w.student_id.toString(),
            student_no: sp?.student_no,
            name: sp?.users?.name,
            warning_level: w.level,
            warning_reason: w.trigger_summary,
            status: w.status,
            created_at: w.created_at,
          };
        }),
        total,
      },
      trace_id: req.trace_id,
    };
  }

  @Get('leave-requests')
  @Roles('head_teacher')
  async getLeaveRequests(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const classIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
      activeOnly: true,
    });

    if (classIds.length === 0) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const leaveRequests = await this.prisma.leave_requests.findMany({
      where: { class_id: { in: classIds } },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });

    const studentIds = Array.from(
      new Map(
        leaveRequests.map((item: any) => [item.student_id.toString(), item.student_id]),
      ).values(),
    );
    const students = studentIds.length > 0
      ? await this.prisma.student_profiles.findMany({
          where: { id: { in: studentIds } },
          include: { users: true },
        })
      : [];
    const studentMap = new Map(
      students.map((item: any) => [item.id.toString(), item]),
    );

    return {
      code: 0,
      message: 'ok',
      data: leaveRequests.map((item: any) => {
        const student = studentMap.get(item.student_id.toString()) as any;
        const displayStatus = this.deriveLeaveDisplayStatus(item);
        return {
          id: item.id.toString(),
          student_id: item.student_id.toString(),
          student_no: student?.student_no || '',
          student_name: student?.users?.name || '',
          from_date: item.from_date,
          to_date: item.to_date,
          reason: item.reason || '',
          status: item.status,
          display_status: displayStatus,
          reject_reason: item.reject_reason || '',
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Get('orgs')
  @Roles('head_teacher')
  async getOrgs(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const assignableOrgIds = await this.getAssignableOrgIds(userId);
    if (assignableOrgIds.length === 0) {
      return {
        code: 0,
        message: 'ok',
        data: [],
        trace_id: req.trace_id,
      };
    }

    const orgs = await this.prisma.orgs.findMany({
      where: {
        id: { in: assignableOrgIds },
        status: 'active',
      },
      orderBy: { id: 'asc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: orgs.map((org: any) => ({
        id: org.id.toString(),
        name: org.name,
        org_name: org.name,
      })),
      trace_id: req.trace_id,
    };
  }

  @Get('classes/:orgId')
  @Roles('head_teacher')
  async getClasses(@Param('orgId') orgId: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const targetOrgId = BigInt(orgId);
    const assignableOrgIds = await this.getAssignableOrgIds(userId);
    if (!assignableOrgIds.some((id: bigint) => id.toString() === targetOrgId.toString())) {
      return {
        code: 403,
        message: '当前无权查看该学院班级',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const classes = await this.prisma.classes.findMany({
      where: {
        org_id: targetOrgId,
        status: 'active',
      },
      orderBy: { id: 'asc' },
    });

    const counselorIds = Array.from(
      new Set(
        classes
          .map((item: any) => item.counselor_user_id)
          .filter((item: any): item is bigint => Boolean(item))
          .map((item: bigint) => item.toString()),
      ),
    ).map((item) => BigInt(item));

    const counselors = counselorIds.length > 0
      ? await this.prisma.users.findMany({
          where: { id: { in: counselorIds } },
          select: { id: true, name: true },
        })
      : [];
    const counselorMap = new Map(
      counselors.map((item: any) => [item.id.toString(), item.name || '已绑定班主任']),
    );

    return {
      code: 0,
      message: 'ok',
      data: classes.map((c: any) => ({
        id: c.id.toString(),
        class_name: c.class_name,
        major: c.major,
        grade_level: c.grade_level,
        counselor_user_id: c.counselor_user_id?.toString() || '',
        counselor_name: c.counselor_user_id
          ? counselorMap.get(c.counselor_user_id.toString()) || '已绑定班主任'
          : '',
        bindable:
          !c.counselor_user_id || c.counselor_user_id.toString() === userId.toString(),
      })),
      trace_id: req.trace_id,
    };
  }

  @Post('bind-class')
  @Roles('head_teacher')
  async bindClass(@Body() dto: BindClassDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const classId = BigInt(dto.class_id);

    const classInfo = await this.prisma.classes.findUnique({
      where: { id: classId },
    });

    if (!classInfo) {
      return {
        code: 404,
        message: '班级不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const assignableOrgIds = await this.getAssignableOrgIds(userId);
    if (!assignableOrgIds.some((id: bigint) => id.toString() === classInfo.org_id.toString())) {
      return {
        code: 403,
        message: '当前无权绑定该班级',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (classInfo.counselor_user_id && classInfo.counselor_user_id.toString() !== userId.toString()) {
      return {
        code: 409,
        message: '该班级已绑定其他班主任',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const headTeacherRoles = await this.prisma.user_roles.findMany({
      where: {
        user_id: userId,
        role: 'head_teacher',
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });

    if (headTeacherRoles.length === 0) {
      return {
        code: 400,
        message: '当前账号不是班主任',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const existingScopedRole = headTeacherRoles.find(
      (item: any) => item.scope_id && item.scope_id.toString() === classId.toString(),
    );

    const txList: any[] = [];
    if (!existingScopedRole) {
      txList.push(
        this.prisma.user_roles.create({
          data: {
            user_id: userId,
            role: 'head_teacher',
            scope_type: 'class',
            scope_id: classId,
          },
        }),
      );
    }

    txList.push(
      this.prisma.classes.update({
        where: { id: classId },
        data: {
          counselor_user_id: userId,
        },
      }),
      this.prisma.users.update({
        where: { id: userId },
        data: {
          org_id: classInfo.org_id,
        },
      }),
    );

    await this.prisma.$transaction(txList);

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: 'head_teacher.bind_class',
        entity_type: 'class',
        entity_id: classId,
        after_json: serializeForAudit({ counselor_user_id: userId, class_name: classInfo.class_name }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '绑定成功',
      data: {
        bound_class: {
          id: classInfo.id.toString(),
          class_name: classInfo.class_name,
        },
      },
      trace_id: req.trace_id,
    };
  }

  @Get('bindable-classes')
  @Roles('head_teacher')
  async getBindableClasses(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const assignableOrgIds = await this.getAssignableOrgIds(userId);
    if (assignableOrgIds.length === 0) {
      return {
        code: 0,
        message: 'ok',
        data: [],
        trace_id: req.trace_id,
      };
    }

    const classes = await this.prisma.classes.findMany({
      where: {
        org_id: { in: assignableOrgIds },
        status: 'active',
        OR: [
          { counselor_user_id: null },
          { counselor_user_id: userId },
        ],
      },
      include: {
        orgs: true,
      },
      orderBy: { id: 'asc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: classes.map((c: any) => ({
        id: c.id.toString(),
        class_name: c.class_name,
        major: c.major,
        grade_level: c.grade_level,
        org_id: c.org_id?.toString(),
        org_name: c.orgs?.name,
      })),
      trace_id: req.trace_id,
    };
  }

  @Get('class-change-requests')
  @Roles('head_teacher', 'sys_admin')
  async listClassChangeRequests(@Req() req: any) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { role: true },
    });
    const isSysAdmin = userRoles.some((item: any) => item.role === 'sys_admin');

    const requests = await this.prisma.change_requests.findMany({
      where: {
        target_type: 'student_profile_class_change',
        status: { in: [...CHANGE_REQUEST_PENDING_HEAD_STATUSES] },
      },
      orderBy: { created_at: 'desc' },
    });

    const visibleRequests = isSysAdmin
      ? requests
      : requests.filter((item: any) => {
          const change = (item.change_json as any) || {};
          return (
            String(change.requested_head_teacher_user_id || '') === userId.toString()
          );
        });

    const studentIds = Array.from(
      new Set(visibleRequests.map((item: any) => item.target_id.toString())),
    ).map((item) => BigInt(item));
    const students = studentIds.length
      ? await this.prisma.student_profiles.findMany({
          where: { id: { in: studentIds } },
          include: { users: true },
        })
      : [];
    const studentMap = new Map(
      students.map((item: any) => [item.id.toString(), item]),
    );

    return {
      code: 0,
      message: 'ok',
      data: visibleRequests.map((item: any) => {
        const change = (item.change_json as any) || {};
        const student = studentMap.get(item.target_id.toString());
        const evidenceFileIds = normalizeFileIdList(
          change.evidence_file_ids,
          change.evidence_file_id,
        );
        return {
          id: item.id.toString(),
          student_name: change.student_name || student?.users?.name || '',
          student_no: change.student_no || student?.student_no || '',
          current_class_name: change.current_class_name || '',
          target_class_name: change.target_class_name || '',
          target_org_name: change.target_org_name || '',
          requested_head_teacher_name: change.requested_head_teacher_name || '',
          reason: item.reason || '',
          evidence_file_id: evidenceFileIds[0] || '',
          evidence_file_ids: evidenceFileIds,
          status: normalizeChangeRequestStatus(item.status),
          created_at: item.created_at,
        };
      }),
      trace_id: req.trace_id,
    };
  }

  @Post('class-change-requests/:id/review')
  @Roles('head_teacher', 'sys_admin')
  async reviewClassChangeRequest(
    @Param('id') id: string,
    @Body() dto: ReviewClassChangeRequestDto,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();

    const userId = BigInt(req.user.sub);
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    });
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { role: true },
    });
    const isSysAdmin = userRoles.some((item: any) => item.role === 'sys_admin');

    const request = await this.prisma.change_requests.findUnique({
      where: { id: BigInt(id) },
    });

    if (!request || request.target_type !== 'student_profile_class_change') {
      return {
        code: 404,
        message: '申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      !CHANGE_REQUEST_PENDING_HEAD_STATUSES.some(
        (status) => status === request.status,
      )
    ) {
      return {
        code: 400,
        message: '该申请当前不可由班主任处理',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const change = (request.change_json as any) || {};
    if (
      !isSysAdmin &&
      String(change.requested_head_teacher_user_id || '') !== userId.toString()
    ) {
      return {
        code: 403,
        message: '无权处理该申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const note = String(dto.note || '').trim();
    const nextChangeJson = {
      ...change,
      head_teacher_review: {
        approved: Boolean(dto.approve),
        reviewer_user_id: user?.id?.toString() || userId.toString(),
        reviewer_name: user?.name || '',
        note,
        reviewed_at: new Date().toISOString(),
      },
      workflow_stage: dto.approve ? 'vice_dean_review' : 'head_teacher_rejected',
    } as any;

    const updated = await this.prisma.change_requests.update({
      where: { id: request.id },
      data: dto.approve
        ? {
            status: CHANGE_REQUEST_STATUS.PENDING_DEAN,
            change_json: nextChangeJson,
          }
        : {
            status: CHANGE_REQUEST_STATUS.REJECTED,
            approver_user_id: userId,
            rejected_at: new Date(),
            reject_reason: note || '班主任驳回',
            change_json: nextChangeJson,
          },
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: dto.approve ? 'change_request.head_teacher_approve' : 'change_request.head_teacher_reject',
        entity_type: 'change_request',
        entity_id: request.id,
        before_json: serializeForAudit(request) as any,
        after_json: serializeForAudit(updated) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: dto.approve ? '已转交教学副院长审批' : '已驳回该申请',
      data: { id: updated.id.toString() },
      trace_id: req.trace_id,
    };
  }
}

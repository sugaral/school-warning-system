import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../shared/auth.guard';
import { PrismaService } from '../shared/prisma.service';
import { Roles, RolesGuard } from '../shared/roles.guard';
import { PinoLogger } from 'nestjs-pino';
import { serializeForAudit } from '../shared/json.util';
import {
  CHANGE_REQUEST_DEAN_QUEUE_STATUSES,
  CHANGE_REQUEST_STATUS,
  normalizeChangeRequestStatus,
} from '../shared/change-request-status.util';
import { normalizeFileIdList } from '../shared/file.util';

@Controller('vice-dean')
@UseGuards(AuthGuard, RolesGuard)
export class ViceDeanController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('ViceDeanController');
  }

  private getOperatorId(req: any) {
    const raw = req.user?.sub || req.user?.userId;
    return BigInt(raw);
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

  private parseOrgId(value: unknown) {
    const normalized = String(value || '').trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }
    return BigInt(normalized);
  }

  private parseClassId(value: unknown) {
    const normalized = String(value || '').trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }
    return BigInt(normalized);
  }

  private async getViceDeanScopeOrgIds(userId: bigint) {
    const roles = await this.prisma.user_roles.findMany({
      where: {
        user_id: userId,
        role: 'vice_dean',
        scope_id: { not: null },
      },
      select: { scope_id: true },
    });

    const scopedOrgIds = this.uniqueBigInts(
      roles.map((item: any) => item.scope_id as bigint | null),
    );

    if (scopedOrgIds.length > 0) {
      return scopedOrgIds;
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { org_id: true },
    });

    return user?.org_id ? [user.org_id] : [];
  }

  private async resolveRequestOrgIds(request: any) {
    const change = (request.change_json as any) || {};
    const resolvedOrgIds: Array<bigint | null> = [];

    for (const candidate of [change.current_org_id, change.target_org_id, change.org_id]) {
      resolvedOrgIds.push(this.parseOrgId(candidate));
    }

    const classIds = this.uniqueBigInts(
      [
        this.parseClassId(change.class_id),
        this.parseClassId(change.current_class_id),
        this.parseClassId(change.target_class_id),
      ],
    );
    if (classIds.length > 0) {
      const classes = await this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: { org_id: true },
      });
      resolvedOrgIds.push(...classes.map((item: any) => item.org_id as bigint | null));
    }

    if (
      request.target_type === 'student_profile'
      || request.target_type === 'student_profile_class_change'
    ) {
      const profile = await this.prisma.student_profiles.findUnique({
        where: { id: request.target_id },
        select: { org_id: true, class_id: true },
      });
      resolvedOrgIds.push(profile?.org_id || null);

      if (!profile?.org_id && profile?.class_id) {
        const classInfo = await this.prisma.classes.findUnique({
          where: { id: profile.class_id },
          select: { org_id: true },
        });
        resolvedOrgIds.push(classInfo?.org_id || null);
      }

      return this.uniqueBigInts(resolvedOrgIds);
    }

    if (request.target_type === 'grade') {
      const grade = await this.prisma.grades.findUnique({
        where: { id: request.target_id },
        select: { student_id: true },
      });
      if (!grade) {
        return this.uniqueBigInts(resolvedOrgIds);
      }

      const profile = await this.prisma.student_profiles.findFirst({
        where: { user_id: grade.student_id },
        select: { org_id: true, class_id: true },
      });
      resolvedOrgIds.push(profile?.org_id || null);

      if (!profile?.org_id && profile?.class_id) {
        const classInfo = await this.prisma.classes.findUnique({
          where: { id: profile.class_id },
          select: { org_id: true },
        });
        resolvedOrgIds.push(classInfo?.org_id || null);
      }

      return this.uniqueBigInts(resolvedOrgIds);
    }

    if (request.target_type === 'teacher_org_change') {
      const teacher = await this.prisma.users.findUnique({
        where: { id: request.target_id },
        select: { org_id: true },
      });
      resolvedOrgIds.push(teacher?.org_id || null);
    }

    return this.uniqueBigInts(resolvedOrgIds);
  }

  private async canAccessRequest(req: any, request: any) {
    const operatorId = this.getOperatorId(req);
    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: operatorId },
      select: { role: true },
    });

    if (roles.some((item: any) => item.role === 'sys_admin')) {
      return true;
    }

    const scopedOrgIds = await this.getViceDeanScopeOrgIds(operatorId);
    if (scopedOrgIds.length === 0) {
      return false;
    }

    const requestOrgIds = await this.resolveRequestOrgIds(request);
    if (requestOrgIds.length === 0) {
      return false;
    }

    const scopedOrgIdSet = new Set(scopedOrgIds.map((item) => item.toString()));
    return requestOrgIds.some((item) => scopedOrgIdSet.has(item.toString()));
  }

  private async resolveStudentSummary(request: any) {
    if (
      request.target_type === 'student_profile'
      || request.target_type === 'student_profile_class_change'
    ) {
      const profile = await this.prisma.student_profiles.findUnique({
        where: { id: request.target_id },
        include: { users: true },
      });
      return {
        subject_name: profile?.users?.name || '',
        subject_no: profile?.student_no || '',
      };
    }

    if (request.target_type === 'grade') {
      const grade = await this.prisma.grades.findUnique({
        where: { id: request.target_id },
      });
      if (!grade) {
        return { subject_name: '', subject_no: '' };
      }

      const profile = await this.prisma.student_profiles.findFirst({
        where: { user_id: grade.student_id },
        include: { users: true },
      });
      return {
        subject_name: profile?.users?.name || '',
        subject_no: profile?.student_no || '',
      };
    }

    if (request.target_type === 'teacher_org_change') {
      const teacher = await this.prisma.users.findUnique({
        where: { id: request.target_id },
        select: { name: true, mobile: true, email: true },
      });
      return {
        subject_name: teacher?.name || '',
        subject_no: teacher?.mobile || teacher?.email || '',
      };
    }

    return { subject_name: '', subject_no: '' };
  }

  private getApplyType(targetType: string) {
    switch (targetType) {
      case 'grade':
        return 'grade_change';
      case 'student_profile':
        return 'status_change';
      case 'student_profile_class_change':
        return 'student_class_change';
      case 'teacher_org_change':
        return 'teacher_org_change';
      default:
        return targetType;
    }
  }

  @Get('special-approvals')
  @Roles('vice_dean', 'sys_admin')
  async listSpecialApprovals(@Req() req: any) {
    const operatorId = this.getOperatorId(req);
    void operatorId;

    const requests = await this.prisma.change_requests.findMany({
      where: {
        status: { in: [...CHANGE_REQUEST_DEAN_QUEUE_STATUSES] },
        target_type: {
          in: ['grade', 'student_profile', 'student_profile_class_change', 'teacher_org_change'],
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const visibleRequests = (
      await Promise.all(
        requests.map(async (item: any) =>
          (await this.canAccessRequest(req, item)) ? item : null,
        ),
      )
    ).filter(Boolean) as any[];

    const list = await Promise.all(
      visibleRequests.map(async (item: any) => {
        const summary = await this.resolveStudentSummary(item);
        const change = (item.change_json as any) || {};
        const headTeacherReview = change.head_teacher_review || null;
        const currentValue =
          item.target_type === 'student_profile_class_change'
            ? change.current_class_name || change.current_org_name || change.current_value || ''
            : item.target_type === 'teacher_org_change'
              ? change.current_org_name || change.current_value || ''
              : change.current_value || change.current_class_name || change.current_org_name || '';
        const targetValue =
          item.target_type === 'student_profile_class_change'
            ? change.target_class_name || change.target_org_name || change.target_value || ''
            : item.target_type === 'teacher_org_change'
              ? change.target_org_name || change.target_value || ''
              : change.target_value || change.target_class_name || change.target_org_name || '';

        return {
          id: item.id.toString(),
          apply_type: this.getApplyType(item.target_type),
          subject_name: change.teacher_name || change.student_name || summary.subject_name,
          subject_no: change.student_no || summary.subject_no,
          current_value: currentValue,
          target_value: targetValue,
          requested_head_teacher_name: change.requested_head_teacher_name || '',
          apply_reason: item.reason || '',
          apply_detail: JSON.stringify(change),
          evidence_file_id: normalizeFileIdList(
            change.evidence_file_ids,
            change.evidence_file_id,
          )[0] || '',
          evidence_file_ids: normalizeFileIdList(
            change.evidence_file_ids,
            change.evidence_file_id,
          ),
          apply_time: item.created_at,
          workflow_status: normalizeChangeRequestStatus(item.status),
          head_teacher_review: headTeacherReview,
        };
      }),
    );

    return {
      code: 0,
      message: 'ok',
      data: { list },
      trace_id: req.trace_id,
    };
  }

  @Post('approvals/:id/approve')
  @Roles('vice_dean', 'sys_admin')
  async approve(@Param('id') id: string, @Req() req: any) {
    const requestId = BigInt(id);
    const operatorId = this.getOperatorId(req);
    const changeRequest = await this.prisma.change_requests.findUnique({
      where: { id: requestId },
    });

    if (!changeRequest) {
      return {
        code: 404,
        message: '审批申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!(await this.canAccessRequest(req, changeRequest))) {
      return {
        code: 403,
        message: '无权审批该申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const changeData = (changeRequest.change_json as any) || {};

    if (changeRequest.target_type === 'grade') {
      await this.prisma.grades.update({
        where: { id: changeRequest.target_id },
        data: {
          ...(changeData.score !== undefined ? { score: changeData.score } : {}),
          ...(changeData.pass_status !== undefined
            ? { pass_status: changeData.pass_status }
            : {}),
        },
      });
    }

    if (changeRequest.target_type === 'student_profile') {
      const profile = await this.prisma.student_profiles.update({
        where: { id: changeRequest.target_id },
        data: {
          ...(changeData.class_id ? { class_id: BigInt(changeData.class_id) } : {}),
          ...(changeData.major_id ? { major_id: BigInt(changeData.major_id) } : {}),
          ...(changeData.major !== undefined ? { major: changeData.major } : {}),
          ...(changeData.enroll_year !== undefined
            ? { enroll_year: changeData.enroll_year }
            : {}),
          ...(changeData.status !== undefined ? { status: changeData.status } : {}),
          ...(changeData.org_id ? { org_id: BigInt(changeData.org_id) } : {}),
        },
      });

      if (profile.org_id || profile.class_id) {
        await Promise.all([
          this.prisma.users.update({
            where: { id: profile.user_id },
            data: {
              org_id: profile.org_id || null,
              ...(changeData.status !== undefined
                ? { status: changeData.status === 'active' ? 'active' : 'inactive' }
                : {}),
            },
          }),
          this.prisma.warnings.updateMany({
            where: { student_id: profile.id },
            data: {
              class_id: profile.class_id,
              org_id: profile.org_id || BigInt(0),
            },
          }),
        ]);
      }
    }

    if (changeRequest.target_type === 'student_profile_class_change') {
      const targetClassId = BigInt(changeData.target_class_id);
      const targetOrgId = BigInt(changeData.target_org_id);
      const targetClass = await this.prisma.classes.findUnique({
        where: { id: targetClassId },
        select: { counselor_user_id: true },
      });

      const updatedProfile = await this.prisma.student_profiles.update({
        where: { id: changeRequest.target_id },
        data: {
          class_id: targetClassId,
          org_id: targetOrgId,
          major: changeData.target_major || null,
          enroll_year: changeData.target_enroll_year || null,
          major_id: changeData.target_major_id
            ? BigInt(changeData.target_major_id)
            : null,
        },
      });

      await Promise.all([
        this.prisma.users.update({
          where: { id: updatedProfile.user_id },
          data: { org_id: targetOrgId },
        }),
        this.prisma.warnings.updateMany({
          where: { student_id: updatedProfile.id },
          data: {
            class_id: targetClassId,
            org_id: targetOrgId,
          },
        }),
        this.prisma.leave_requests.updateMany({
          where: {
            student_id: updatedProfile.id,
            status: 'submitted',
          },
          data: {
            class_id: targetClassId,
            approver_user_id: targetClass?.counselor_user_id || null,
          },
        }),
      ]);
    }

    if (changeRequest.target_type === 'teacher_org_change') {
      const targetOrgId = BigInt(changeData.target_org_id);
      await this.prisma.$transaction([
        this.prisma.users.update({
          where: { id: changeRequest.target_id },
          data: { org_id: targetOrgId },
        }),
        this.prisma.teacher_course_bindings.deleteMany({
          where: { teacher_id: changeRequest.target_id },
        }),
      ]);
    }

    await this.prisma.change_requests.update({
      where: { id: requestId },
      data: {
        status: CHANGE_REQUEST_STATUS.APPROVED,
        approver_user_id: operatorId,
        approved_at: new Date(),
      },
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: operatorId,
        action: 'change_request.approve',
        entity_type: 'change_request',
        entity_id: requestId,
        before_json: serializeForAudit(changeRequest) as any,
        after_json: serializeForAudit({ status: CHANGE_REQUEST_STATUS.APPROVED, approver_user_id: operatorId }) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: 'ok',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Post('approvals/:id/reject')
  @Roles('vice_dean', 'sys_admin')
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    const reason = String(body.reason || '').trim();
    if (!reason) {
      return {
        code: 400,
        message: '请填写驳回原因',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const requestId = BigInt(id);
    const changeRequest = await this.prisma.change_requests.findUnique({
      where: { id: requestId },
    });

    if (!changeRequest) {
      return {
        code: 404,
        message: '审批申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (!(await this.canAccessRequest(req, changeRequest))) {
      return {
        code: 403,
        message: '无权审批该申请',
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
        action: 'change_request.reject',
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
      message: 'ok',
      data: null,
      trace_id: req.trace_id,
    };
  }
}

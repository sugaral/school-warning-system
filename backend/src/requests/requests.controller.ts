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
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions } from '../rbac/permission.decorator';
import { PinoLogger } from 'nestjs-pino';
import { serializeForAudit } from '../shared/json.util';
import {
  normalizeFileIdList,
  parseOptionalFileIds,
} from '../shared/file.util';
import { WarningService } from '../warning/warning.service';
import { getHeadTeacherClassScopeIds } from '../shared/head-teacher-scope.util';

class CreateLeaveRequestDto {
  student_id!: bigint | number;
  class_id!: bigint | number;
  from_date!: string;
  to_date!: string;
  reason!: string;
  proof_file_id?: bigint | number;
  proof_file_ids?: Array<bigint | number | string>;
}

class ApproveLeaveRequestDto {
  approve!: boolean;
  reject_reason?: string;
}

class CreateMakeupRequestDto {
  student_id!: bigint | number;
  record_date!: string;
  course_id?: bigint | number;
  change_json!: object;
  reason!: string;
}

class ApproveMakeupRequestDto {
  approve!: boolean;
  reject_reason?: string;
}

class CreateAppealDto {
  student_id!: bigint | number;
  appeal_type!: string;
  related_type?: string;
  related_id?: bigint | number;
  content!: string;
  evidence_file_id?: bigint | number;
  evidence_file_ids?: Array<bigint | number | string>;
}

class HandleAppealDto {
  status!: string;
  result_note?: string;
}

@Controller()
@UseGuards(AuthGuard, PermissionGuard)
export class RequestsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly warningService: WarningService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('RequestsController');
  }

  private getCurrentUserId(req: any) {
    return BigInt(req.user.userId || req.user.sub);
  }

  private async getCurrentRoleCodes(userId: bigint) {
    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { role: true, scope_id: true },
    });

    return roles;
  }

  private async getSelfStudentProfile(userId: bigint) {
    return this.prisma.student_profiles.findUnique({
      where: { user_id: userId },
      select: { id: true, class_id: true },
    });
  }

  private uniqueBigInts(values: bigint[]) {
    return Array.from(new Map(values.map((item) => [item.toString(), item])).values());
  }

  private async getAccessibleClassIds(userId: bigint) {
    const roleScopes = await this.getCurrentRoleCodes(userId);
    const roleCodes = roleScopes.map((item: any) => item.role);

    if (roleCodes.includes('sys_admin')) {
      return null;
    }

    const classIds: bigint[] = [];
    const collegeScopeIds = roleScopes
      .filter((item: any) => item.role === 'student_admin' && item.scope_id)
      .map((item: any) => item.scope_id as bigint);

    const headTeacherClassIds = await getHeadTeacherClassScopeIds(this.prisma, userId, {
      activeOnly: true,
    });
    classIds.push(...headTeacherClassIds);

    if (collegeScopeIds.length > 0) {
      const classes = await this.prisma.classes.findMany({
        where: { org_id: { in: this.uniqueBigInts(collegeScopeIds) } },
        select: { id: true },
      });
      classes.forEach((item: any) => classIds.push(item.id));
    }

    return this.uniqueBigInts(classIds);
  }

  private async getAccessibleStudentIds(classIds: bigint[]) {
    if (!classIds.length) {
      return [];
    }

    const students = await this.prisma.student_profiles.findMany({
      where: { class_id: { in: classIds } },
      select: { id: true },
    });

    return students.map((item: any) => item.id as bigint);
  }

  private async canAccessClassRequest(userId: bigint, classId: bigint) {
    const accessibleClassIds = await this.getAccessibleClassIds(userId);
    if (accessibleClassIds === null) {
      return true;
    }
    return accessibleClassIds.some((item) => item.toString() === classId.toString());
  }

  private async canAccessStudentRequest(userId: bigint, studentId: bigint) {
    const accessibleClassIds = await this.getAccessibleClassIds(userId);
    if (accessibleClassIds === null) {
      return true;
    }
    if (accessibleClassIds.length === 0) {
      return false;
    }

    const student = await this.prisma.student_profiles.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });
    if (!student) {
      return false;
    }

    return accessibleClassIds.some((item) => item.toString() === student.class_id.toString());
  }

  private mergeParsedFileIds(value: unknown, legacyValue?: unknown) {
    return Array.from(
      new Map(
        [
          ...parseOptionalFileIds(value, '图片文件'),
          ...parseOptionalFileIds(legacyValue, '图片文件'),
        ].map((item) => [item.toString(), item]),
      ).values(),
    );
  }

  private getStoredFileIds(value: unknown, legacyValue?: unknown) {
    return normalizeFileIdList(value, legacyValue);
  }

  private parseLeaveDateTime(value: unknown, endOfDay = false) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      throw new Error('missing_leave_datetime');
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('invalid_leave_datetime');
    }

    // Backward compatibility: treat plain date input as whole-day leave.
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      if (endOfDay) {
        parsed.setHours(23, 59, 59, 999);
      } else {
        parsed.setHours(0, 0, 0, 0);
      }
    }

    return parsed;
  }

  private toRecordDate(value: Date) {
    return new Date(
      Date.UTC(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
      ),
    );
  }

  private async applyApprovedLeaveToAttendance(leaveRequest: any) {
    const studentProfile = await this.prisma.student_profiles.findUnique({
      where: { id: leaveRequest.student_id },
      select: { org_id: true },
    });
    const sessions = await this.prisma.class_sessions.findMany({
      where: {
        class_id: leaveRequest.class_id,
        session_start: {
          gte: new Date(leaveRequest.from_date),
          lte: new Date(leaveRequest.to_date),
        },
      },
      select: {
        id: true,
        course_id: true,
        class_id: true,
        session_start: true,
      },
      orderBy: { session_start: 'asc' },
    });

    if (sessions.length === 0) {
      return;
    }

    const affectedRecords = new Map<string, { recordDate: Date; courseId?: bigint }>();

    for (const session of sessions) {
      const existingRecord = await this.prisma.attendance_records.findUnique({
        where: {
          session_id_student_id: {
            session_id: session.id,
            student_id: leaveRequest.student_id,
          },
        },
      });

      if (
        existingRecord &&
        ['on_time', 'late'].includes(String(existingRecord.attendance_status || ''))
      ) {
        continue;
      }

      await this.prisma.attendance_records.upsert({
        where: {
          session_id_student_id: {
            session_id: session.id,
            student_id: leaveRequest.student_id,
          },
        },
        update: {
          attendance_status: 'leave',
          checkin_time: session.session_start,
          source: 'system',
        },
        create: {
          session_id: session.id,
          student_id: leaveRequest.student_id,
          checkin_time: session.session_start,
          attendance_status: 'leave',
          source: 'system',
        },
      });

      const recordDate = this.toRecordDate(new Date(session.session_start));
      await this.prisma.daily_records.upsert({
        where: {
          student_id_record_date_course_id: {
            student_id: leaveRequest.student_id,
            record_date: recordDate,
            course_id: session.course_id,
          },
        },
        update: {
          attendance_status: 'leave',
          approved_status: 'approved',
          approved_by: leaveRequest.approver_user_id,
          approved_at: new Date(),
          source: 'system',
        },
        create: {
          student_id: leaveRequest.student_id,
          record_date: recordDate,
          class_id: leaveRequest.class_id,
          org_id: studentProfile?.org_id || BigInt(0),
          course_id: session.course_id,
          attendance_status: 'leave',
          homework_status: 'unknown',
          source: 'system',
          approved_status: 'approved',
          approved_by: leaveRequest.approver_user_id,
          approved_at: new Date(),
        },
      });

      affectedRecords.set(
        `${recordDate.toISOString().slice(0, 10)}_${session.course_id?.toString() || ''}`,
        {
          recordDate,
          courseId: session.course_id || undefined,
        },
      );
    }

    for (const item of affectedRecords.values()) {
      await this.warningService.generateWarningForStudent(
        leaveRequest.student_id,
        item.recordDate,
        item.courseId,
      );
    }
  }

  // ========== 请假申请 ==========

  @Post('leave_requests')
  @Permissions('leave:read')
  async createLeaveRequest(@Body() dto: CreateLeaveRequestDto, @Req() req: any) {
    const userId = this.getCurrentUserId(req);
    const roleScopes = await this.getCurrentRoleCodes(userId);
    const roleCodes = roleScopes.map((item: any) => item.role);
    if (!/^\d+$/.test(String(dto.student_id || '').trim())) {
      return {
        code: 400,
        message: 'student_id 格式无效',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (roleCodes.includes('student') || roleCodes.includes('class_monitor')) {
      const selfProfile = await this.getSelfStudentProfile(userId);
      if (!selfProfile) {
        return {
          code: 403,
          message: '权限不足，无法代他人提交申请',
          data: null,
          trace_id: req.trace_id,
        };
      }
      if (
        String(dto.student_id || '') !== selfProfile.id.toString() ||
        String(dto.class_id || '') !== selfProfile.class_id.toString()
      ) {
        return {
          code: 403,
          message: '权限不足，无法代他人提交申请',
          data: null,
          trace_id: req.trace_id,
        };
      }
    } else if (!(await this.canAccessStudentRequest(userId, BigInt(dto.student_id as any)))) {
      return {
        code: 403,
        message: '权限不足，无法为该学生提交申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const proofFileIds = this.mergeParsedFileIds(
      dto.proof_file_ids,
      dto.proof_file_id,
    );
    const fromDate = this.parseLeaveDateTime(dto.from_date, false);
    const toDate = this.parseLeaveDateTime(dto.to_date, true);
    if (fromDate.getTime() > toDate.getTime()) {
      return {
        code: 400,
        message: '结束时间不能早于开始时间',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const leaveRequest = await this.prisma.leave_requests.create({
      data: {
        student_id: BigInt(dto.student_id as any),
        class_id: BigInt(dto.class_id as any),
        from_date: fromDate,
        to_date: toDate,
        reason: dto.reason,
        proof_file_id: proofFileIds[0] || null,
        proof_file_ids_json: proofFileIds.map((item) => item.toString()) as any,
        status: 'submitted',
      },
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: 'leave_request.create',
        entity_type: 'leave_request',
        entity_id: leaveRequest.id,
        after_json: serializeForAudit(leaveRequest) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '请假申请提交成功',
      data: { id: leaveRequest.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Get('leave_requests')
  @Permissions('leave:read')
  async listLeaveRequests(
    @Query('student_id') studentId: string,
    @Query('class_id') classId: string,
    @Query('status') status: string,
    @Req() req: any,
  ) {
    const userId = this.getCurrentUserId(req);
    const roleScopes = await this.getCurrentRoleCodes(userId);
    const roleCodes = roleScopes.map((item: any) => item.role);
    const where: any = {};
    if (studentId) where.student_id = BigInt(studentId);
    if (classId) where.class_id = BigInt(classId);
    if (status) where.status = status;

    if (roleCodes.includes('student') || roleCodes.includes('class_monitor')) {
      const selfProfile = await this.getSelfStudentProfile(userId);
      if (!selfProfile) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      if (
        where.student_id &&
        where.student_id.toString() !== selfProfile.id.toString()
      ) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      where.student_id = selfProfile.id;
    } else {
      const accessibleClassIds = await this.getAccessibleClassIds(userId);
      if (accessibleClassIds === null) {
        // no-op
      } else if (accessibleClassIds.length === 0) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      } else if (where.class_id) {
        const matched = accessibleClassIds.some(
          (item) => item.toString() === where.class_id.toString(),
        );
        if (!matched) {
          return {
            code: 0,
            message: 'ok',
            data: [],
            trace_id: req.trace_id,
          };
        }
      } else {
        where.class_id = { in: accessibleClassIds };
      }
    }

    const leaveRequests = await this.prisma.leave_requests.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    const studentIds = [...new Set(leaveRequests.map((item: any) => item.student_id))];

    const students = await this.prisma.student_profiles.findMany({
      where: { id: { in: studentIds } },
      include: { users: true, classes: true },
    });
    const orgIds = [...new Set(students.map((s: any) => s.classes?.org_id).filter(Boolean) as bigint[])];
    const counselorIds = [...new Set(students.map((s: any) => s.classes?.counselor_user_id).filter(Boolean) as bigint[])];
    const [orgs, counselors] = await Promise.all([
      this.prisma.orgs.findMany({ where: { id: { in: orgIds } } }),
      this.prisma.users.findMany({ where: { id: { in: counselorIds } } }),
    ]);
    const studentMap = new Map(students.map((s: any) => [s.id.toString(), s]));
    const orgMap = new Map(orgs.map((o: any) => [o.id.toString(), o]));
    const counselorMap = new Map(counselors.map((c: any) => [c.id.toString(), c]));

    const leaveRequestsWithDetails = leaveRequests.map((lr: any) => {
      const student = studentMap.get(lr.student_id.toString()) as any;
      const org = student?.classes?.org_id ? (orgMap.get(student.classes.org_id.toString()) as any) : null;
      const counselor = student?.classes?.counselor_user_id
        ? (counselorMap.get(student.classes.counselor_user_id.toString()) as any)
        : null;
      const proofFileIds = this.getStoredFileIds(
        (lr as any).proof_file_ids_json,
        lr.proof_file_id,
      );
      return {
        ...lr,
        id: lr.id.toString(),
        student_id: lr.student_id.toString(),
        class_id: lr.class_id.toString(),
        proof_file_id: proofFileIds[0] || '',
        proof_file_ids: proofFileIds,
        approver_user_id: lr.approver_user_id?.toString(),
        student_name: student?.users?.name || '',
        college_name: org?.name || '',
        major_name: student?.major || '',
        class_name: student?.classes?.class_name || '',
        head_teacher_name: counselor?.name || '',
        from_date: lr.from_date.toISOString(),
        to_date: lr.to_date.toISOString(),
        created_at: lr.created_at.toISOString(),
        updated_at: lr.updated_at.toISOString(),
        approved_at: lr.approved_at?.toISOString(),
        rejected_at: lr.rejected_at?.toISOString(),
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: leaveRequestsWithDetails,
      trace_id: req.trace_id,
    };
  }

  @Post('leave_requests/:id/approve')
  @Permissions('leave:approve')
  async approveLeaveRequest(
    @Param('id') id: string,
    @Body() dto: ApproveLeaveRequestDto,
    @Req() req: any,
  ) {
    const rejectReason = String(dto.reject_reason || '').trim();
    if (!dto.approve && !rejectReason) {
      return {
        code: 400,
        message: '请填写驳回原因',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const userId = this.getCurrentUserId(req);
    const existingRequest = await this.prisma.leave_requests.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, class_id: true, status: true },
    });
    if (!existingRequest) {
      return {
        code: 404,
        message: '申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (String(existingRequest.status || '') !== 'submitted') {
      return {
        code: 400,
        message: '该申请已处理，请勿重复操作',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const hasAccess = await this.canAccessClassRequest(userId, existingRequest.class_id);
    if (!hasAccess) {
      return {
        code: 403,
        message: '权限不足，无法处理该申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const updateData: any = {
      status: dto.approve ? 'approved' : 'rejected',
      approver_user_id: userId,
      reject_reason: rejectReason || null,
    };

    if (dto.approve) {
      updateData.approved_at = new Date();
    } else {
      updateData.rejected_at = new Date();
    }

    const leaveRequest = await this.prisma.leave_requests.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    if (dto.approve) {
      await this.applyApprovedLeaveToAttendance(leaveRequest);
    }

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: dto.approve ? 'leave_request.approve' : 'leave_request.reject',
        entity_type: 'leave_request',
        entity_id: leaveRequest.id,
        before_json: serializeForAudit(existingRequest) as any,
        after_json: serializeForAudit(leaveRequest) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: dto.approve ? '请假申请已通过' : '请假申请已驳回',
      data: { id: leaveRequest.id.toString() },
      trace_id: req.trace_id,
    };
  }

  // ========== 补录申请 ==========

  @Post('makeup_requests')
  @Permissions('leave:read')
  async createMakeupRequest(@Body() dto: CreateMakeupRequestDto, @Req() req: any) {
    const userId = this.getCurrentUserId(req);
    const roleScopes = await this.getCurrentRoleCodes(userId);
    const roleCodes = roleScopes.map((item: any) => item.role);
    if (!/^\d+$/.test(String(dto.student_id || '').trim())) {
      return {
        code: 400,
        message: 'student_id 格式无效',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (roleCodes.includes('student') || roleCodes.includes('class_monitor')) {
      const selfProfile = await this.getSelfStudentProfile(userId);
      if (!selfProfile || String(dto.student_id || '') !== selfProfile.id.toString()) {
        return {
          code: 403,
          message: '权限不足，无法代他人提交申请',
          data: null,
          trace_id: req.trace_id,
        };
      }
    } else if (!(await this.canAccessStudentRequest(userId, BigInt(dto.student_id as any)))) {
      return {
        code: 403,
        message: '权限不足，无法为该学生提交申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const makeupRequest = await this.prisma.makeup_requests.create({
      data: {
        student_id: BigInt(dto.student_id as any),
        record_date: new Date(dto.record_date),
        course_id: dto.course_id ? BigInt(dto.course_id as any) : null,
        change_json: dto.change_json as any,
        reason: dto.reason,
        status: 'submitted',
      },
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: 'makeup_request.create',
        entity_type: 'makeup_request',
        entity_id: makeupRequest.id,
        after_json: serializeForAudit(makeupRequest) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '补录申请提交成功',
      data: { id: makeupRequest.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Get('makeup_requests')
  @Permissions('leave:read')
  async listMakeupRequests(
    @Query('student_id') studentId: string,
    @Query('status') status: string,
    @Req() req: any,
  ) {
    const userId = this.getCurrentUserId(req);
    const roleScopes = await this.getCurrentRoleCodes(userId);
    const roleCodes = roleScopes.map((item: any) => item.role);
    const where: any = {};
    if (studentId) where.student_id = BigInt(studentId);
    if (status) where.status = status;

    if (roleCodes.includes('student') || roleCodes.includes('class_monitor')) {
      const selfProfile = await this.getSelfStudentProfile(userId);
      if (!selfProfile) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }

      if (where.student_id && where.student_id.toString() !== selfProfile.id.toString()) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      where.student_id = selfProfile.id;
    } else {
      const accessibleClassIds = await this.getAccessibleClassIds(userId);
      if (accessibleClassIds !== null) {
        if (accessibleClassIds.length === 0) {
          return {
            code: 0,
            message: 'ok',
            data: [],
            trace_id: req.trace_id,
          };
        }

        if (where.student_id) {
          const targetStudent = await this.prisma.student_profiles.findUnique({
            where: { id: where.student_id },
            select: { class_id: true },
          });
          const matched =
            targetStudent &&
            accessibleClassIds.some(
              (item) => item.toString() === targetStudent.class_id.toString(),
            );
          if (!matched) {
            return {
              code: 0,
              message: 'ok',
              data: [],
              trace_id: req.trace_id,
            };
          }
        } else {
          where.student = { class_id: { in: accessibleClassIds } };
        }
      }
    }

    const makeupRequests = await this.prisma.makeup_requests.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    const studentIds = [...new Set(makeupRequests.map((item: any) => item.student_id))];

    const students = await this.prisma.student_profiles.findMany({
      where: { id: { in: studentIds as any } },
      include: { users: true, classes: true },
    });
    const orgIds = [...new Set(students.map((s: any) => s.classes?.org_id).filter(Boolean) as bigint[])];
    const counselorIds = [...new Set(students.map((s: any) => s.classes?.counselor_user_id).filter(Boolean) as bigint[])];
    const [orgs, counselors] = await Promise.all([
      this.prisma.orgs.findMany({ where: { id: { in: orgIds } } }),
      this.prisma.users.findMany({ where: { id: { in: counselorIds } } }),
    ]);
    const studentMap = new Map(students.map((s: any) => [s.id.toString(), s]));
    const orgMap = new Map(orgs.map((o: any) => [o.id.toString(), o]));
    const counselorMap = new Map(counselors.map((c: any) => [c.id.toString(), c]));

    const makeupRequestsWithDetails = makeupRequests.map((mr: any) => {
      const student = studentMap.get(mr.student_id.toString()) as any;
      const org = student?.classes?.org_id ? (orgMap.get(student.classes.org_id.toString()) as any) : null;
      const counselor = student?.classes?.counselor_user_id
        ? (counselorMap.get(student.classes.counselor_user_id.toString()) as any)
        : null;
      return {
        ...mr,
        id: mr.id.toString(),
        student_id: mr.student_id.toString(),
        course_id: mr.course_id?.toString(),
        approver_user_id: mr.approver_user_id?.toString(),
        applied_daily_record_id: mr.applied_daily_record_id?.toString(),
        student_name: student?.users?.name || '',
        college_name: org?.name || '',
        major_name: student?.major || '',
        class_name: student?.classes?.class_name || '',
        head_teacher_name: counselor?.name || '',
        record_date: mr.record_date.toISOString().split('T')[0],
        created_at: mr.created_at.toISOString(),
        updated_at: mr.updated_at.toISOString(),
        approved_at: mr.approved_at?.toISOString(),
        rejected_at: mr.rejected_at?.toISOString(),
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: makeupRequestsWithDetails,
      trace_id: req.trace_id,
    };
  }

  @Post('makeup_requests/:id/approve')
  @Permissions('leave:approve')
  async approveMakeupRequest(
    @Param('id') id: string,
    @Body() dto: ApproveMakeupRequestDto,
    @Req() req: any,
  ) {
    const rejectReason = String(dto.reject_reason || '').trim();
    if (!dto.approve && !rejectReason) {
      return {
        code: 400,
        message: '请填写驳回原因',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const userId = this.getCurrentUserId(req);
    const existingRequest = await this.prisma.makeup_requests.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, student_id: true, status: true },
    });
    if (!existingRequest) {
      return {
        code: 404,
        message: '申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (String(existingRequest.status || '') !== 'submitted') {
      return {
        code: 400,
        message: '该申请已处理，请勿重复操作',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const hasAccess = await this.canAccessStudentRequest(userId, existingRequest.student_id);
    if (!hasAccess) {
      return {
        code: 403,
        message: '权限不足，无法处理该申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const updateData: any = {
      status: dto.approve ? 'approved' : 'rejected',
      approver_user_id: userId,
    };

    if (dto.approve) {
      updateData.approved_at = new Date();
      const makeupRequest = await this.prisma.makeup_requests.findUnique({
        where: { id: BigInt(id) },
      });

      if (makeupRequest) {
        const rawChangeData = (makeupRequest.change_json as any) || {};
        const allowedAttendanceStatuses = new Set([
          'on_time',
          'late',
          'absent',
          'leave',
          'early_leave',
          'unknown',
        ]);
        const allowedHomeworkStatuses = new Set([
          'submitted',
          'not_submit',
          'late_submit',
          'unknown',
        ]);
        const allowedClassBehaviors = new Set(['normal', 'disruptive']);
        const safeUpdateData: Record<string, any> = {};
        if (
          typeof rawChangeData.attendance_status === 'string' &&
          allowedAttendanceStatuses.has(rawChangeData.attendance_status)
        ) {
          safeUpdateData.attendance_status = rawChangeData.attendance_status;
        }
        if (
          typeof rawChangeData.homework_status === 'string' &&
          allowedHomeworkStatuses.has(rawChangeData.homework_status)
        ) {
          safeUpdateData.homework_status = rawChangeData.homework_status;
        }
        if (
          typeof rawChangeData.class_behavior === 'string' &&
          allowedClassBehaviors.has(rawChangeData.class_behavior)
        ) {
          safeUpdateData.class_behavior = rawChangeData.class_behavior;
        }
        if (typeof rawChangeData.remarks === 'string') {
          safeUpdateData.remarks = rawChangeData.remarks.slice(0, 500);
        }

        await this.prisma.daily_records.updateMany({
          where: {
            student_id: makeupRequest.student_id,
            record_date: makeupRequest.record_date,
            course_id: makeupRequest.course_id,
          },
          data: {
            ...safeUpdateData,
            approved_status: 'approved',
            approved_by: userId,
            approved_at: new Date(),
          },
        });

        const updatedRecord = await this.prisma.daily_records.findFirst({
          where: {
            student_id: makeupRequest.student_id,
            record_date: makeupRequest.record_date,
            course_id: makeupRequest.course_id,
          },
        });

        if (updatedRecord) {
          updateData.applied_daily_record_id = updatedRecord.id;
        }

        await this.warningService
          .generateWarningForStudent(
            makeupRequest.student_id,
            makeupRequest.record_date,
            makeupRequest.course_id || undefined,
          )
          .catch(() => undefined);
      }
    } else {
      updateData.rejected_at = new Date();
      updateData.reject_reason = rejectReason;
    }

    const makeupRequest = await this.prisma.makeup_requests.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: dto.approve ? 'makeup_request.approve' : 'makeup_request.reject',
        entity_type: 'makeup_request',
        entity_id: makeupRequest.id,
        before_json: serializeForAudit(existingRequest) as any,
        after_json: serializeForAudit(makeupRequest) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: dto.approve ? '补录申请已通过' : '补录申请已驳回',
      data: { id: makeupRequest.id.toString() },
      trace_id: req.trace_id,
    };
  }

  // ========== 申诉申请 ==========

  @Post('appeals')
  @Permissions('appeal:read')
  async createAppeal(@Body() dto: CreateAppealDto, @Req() req: any) {
    const userId = this.getCurrentUserId(req);
    const roleScopes = await this.getCurrentRoleCodes(userId);
    const roleCodes = roleScopes.map((item: any) => item.role);
    if (!/^\d+$/.test(String(dto.student_id || '').trim())) {
      return {
        code: 400,
        message: 'student_id 格式无效',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (roleCodes.includes('student') || roleCodes.includes('class_monitor')) {
      const selfProfile = await this.getSelfStudentProfile(userId);
      if (!selfProfile || String(dto.student_id || '') !== selfProfile.id.toString()) {
        return {
          code: 403,
          message: '权限不足，无法代他人提交申请',
          data: null,
          trace_id: req.trace_id,
        };
      }
    } else if (!(await this.canAccessStudentRequest(userId, BigInt(dto.student_id as any)))) {
      return {
        code: 403,
        message: '权限不足，无法为该学生提交申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const evidenceFileIds = this.mergeParsedFileIds(
      dto.evidence_file_ids,
      dto.evidence_file_id,
    );
    const appeal = await this.prisma.appeals.create({
      data: {
        student_id: BigInt(dto.student_id as any),
        appeal_type: dto.appeal_type,
        related_type: dto.related_type,
        related_id: dto.related_id ? BigInt(dto.related_id as any) : null,
        content: dto.content,
        evidence_file_id: evidenceFileIds[0] || null,
        evidence_file_ids_json: evidenceFileIds.map((item) => item.toString()) as any,
        status: 'submitted',
      },
    });

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: 'appeal.create',
        entity_type: 'appeal',
        entity_id: appeal.id,
        after_json: serializeForAudit(appeal) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '申诉申请提交成功',
      data: { id: appeal.id.toString() },
      trace_id: req.trace_id,
    };
  }

  @Get('appeals')
  @Permissions('appeal:read')
  async listAppeals(
    @Query('student_id') studentId: string,
    @Query('status') status: string,
    @Req() req: any,
  ) {
    const userId = this.getCurrentUserId(req);
    const roleScopes = await this.getCurrentRoleCodes(userId);
    const roleCodes = roleScopes.map((item: any) => item.role);
    const where: any = {};
    if (studentId) where.student_id = BigInt(studentId);
    if (status) where.status = status;

    if (roleCodes.includes('student') || roleCodes.includes('class_monitor')) {
      const selfProfile = await this.getSelfStudentProfile(userId);
      if (!selfProfile) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }

      if (where.student_id && where.student_id.toString() !== selfProfile.id.toString()) {
        return {
          code: 0,
          message: 'ok',
          data: [],
          trace_id: req.trace_id,
        };
      }
      where.student_id = selfProfile.id;
    } else {
      const accessibleClassIds = await this.getAccessibleClassIds(userId);
      if (accessibleClassIds !== null) {
        if (accessibleClassIds.length === 0) {
          return {
            code: 0,
            message: 'ok',
            data: [],
            trace_id: req.trace_id,
          };
        }

        if (where.student_id) {
          const targetStudent = await this.prisma.student_profiles.findUnique({
            where: { id: where.student_id },
            select: { class_id: true },
          });
          const matched =
            targetStudent &&
            accessibleClassIds.some(
              (item) => item.toString() === targetStudent.class_id.toString(),
            );
          if (!matched) {
            return {
              code: 0,
              message: 'ok',
              data: [],
              trace_id: req.trace_id,
            };
          }
        } else {
          where.student = { class_id: { in: accessibleClassIds } };
        }
      }
    }

    const appeals = await this.prisma.appeals.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    const studentIds = [...new Set(appeals.map((item: any) => item.student_id))];

    const students = await this.prisma.student_profiles.findMany({
      where: { id: { in: studentIds as any } },
      include: { users: true, classes: true },
    });
    const orgIds = [...new Set(students.map((s: any) => s.classes?.org_id).filter(Boolean) as bigint[])];
    const counselorIds = [...new Set(students.map((s: any) => s.classes?.counselor_user_id).filter(Boolean) as bigint[])];
    const [orgs, counselors] = await Promise.all([
      this.prisma.orgs.findMany({ where: { id: { in: orgIds } } }),
      this.prisma.users.findMany({ where: { id: { in: counselorIds } } }),
    ]);
    const studentMap = new Map(students.map((s: any) => [s.id.toString(), s]));
    const orgMap = new Map(orgs.map((o: any) => [o.id.toString(), o]));
    const counselorMap = new Map(counselors.map((c: any) => [c.id.toString(), c]));

    const appealsWithDetails = appeals.map((a: any) => {
      const student = studentMap.get(a.student_id.toString()) as any;
      const org = student?.classes?.org_id ? (orgMap.get(student.classes.org_id.toString()) as any) : null;
      const counselor = student?.classes?.counselor_user_id
        ? (counselorMap.get(student.classes.counselor_user_id.toString()) as any)
        : null;
      const evidenceFileIds = this.getStoredFileIds(
        (a as any).evidence_file_ids_json,
        a.evidence_file_id,
      );
      return {
        ...a,
        id: a.id.toString(),
        student_id: a.student_id.toString(),
        related_id: a.related_id?.toString(),
        evidence_file_id: evidenceFileIds[0] || '',
        evidence_file_ids: evidenceFileIds,
        handler_user_id: a.handler_user_id?.toString(),
        student_name: student?.users?.name || '',
        college_name: org?.name || '',
        major_name: student?.major || '',
        class_name: student?.classes?.class_name || '',
        head_teacher_name: counselor?.name || '',
        created_at: a.created_at.toISOString(),
        updated_at: a.updated_at.toISOString(),
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: appealsWithDetails,
      trace_id: req.trace_id,
    };
  }

  @Post('appeals/:id/handle')
  @Permissions('appeal:handle')
  async handleAppeal(
    @Param('id') id: string,
    @Body() dto: HandleAppealDto,
    @Req() req: any,
  ) {
    if (!['approved', 'rejected'].includes(String(dto.status || ''))) {
      return {
        code: 400,
        message: '处理状态无效',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const resultNote = String(dto.result_note || '').trim();
    if (dto.status === 'rejected' && !resultNote) {
      return {
        code: 400,
        message: '请填写驳回原因',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const userId = this.getCurrentUserId(req);
    const existingAppeal = await this.prisma.appeals.findUnique({
      where: { id: BigInt(id) },
      select: {
        id: true,
        student_id: true,
        status: true,
        related_type: true,
        related_id: true,
      },
    });
    if (!existingAppeal) {
      return {
        code: 404,
        message: '申请不存在',
        data: null,
        trace_id: req.trace_id,
      };
    }
    if (String(existingAppeal.status || '') !== 'submitted') {
      return {
        code: 400,
        message: '该申请已处理，请勿重复操作',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const hasAccess = await this.canAccessStudentRequest(userId, existingAppeal.student_id);
    if (!hasAccess) {
      return {
        code: 403,
        message: '权限不足，无法处理该申请',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const appeal = await this.prisma.appeals.update({
      where: { id: BigInt(id) },
      data: {
        status: dto.status,
        handler_user_id: userId,
        result_note: resultNote || null,
      },
    });

    if (dto.status === 'approved') {
      if (existingAppeal.related_type === 'warning' && existingAppeal.related_id) {
        const closedAt = new Date();
        await Promise.all([
          (this.prisma as any).warning_current_states.updateMany({
            where: { id: existingAppeal.related_id },
            data: { status: 'closed' },
          }),
          this.prisma.warnings.updateMany({
            where: { id: existingAppeal.related_id },
            data: {
              status: 'closed',
              closed_at: closedAt,
              closed_by: userId,
              close_note: resultNote || '申诉通过自动关闭',
            },
          }),
        ]);
      }

      await this.warningService
        .generateWarningForStudent(existingAppeal.student_id, new Date())
        .catch(() => undefined);
    }

    await this.prisma.audit_logs.create({
      data: {
        actor_user_id: userId,
        action: dto.status === 'approved' ? 'appeal.approve' : 'appeal.reject',
        entity_type: 'appeal',
        entity_id: appeal.id,
        before_json: serializeForAudit(existingAppeal) as any,
        after_json: serializeForAudit(appeal) as any,
        ip: req.ip,
        user_agent: req.headers['user-agent']
          ? String(req.headers['user-agent']).slice(0, 255)
          : '',
      },
    });

    return {
      code: 0,
      message: '申诉处理成功',
      data: { id: appeal.id.toString() },
      trace_id: req.trace_id,
    };
  }
}


import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { PermissionService } from '../rbac/permission.service';
import { hashPassword } from '../shared/password.util';
import { Prisma } from '@prisma/client';
import {
  loadRoleCatalog,
  normalizeRoleCode,
} from '../shared/role-catalog';
import {
  generateStrongPassword,
  isValidMainlandMobile,
  isWeakPassword,
  normalizeMobile,
} from '../shared/account-security.util';

class CreateUserDto {
  account?: string;
  name!: string;
  email!: string;
  mobile!: string;
  user_type!: string;
  role?: string;
  scope_type?: string;
  scope_id?: string;
  org_id?: string;
  class_id?: string;
  status?: string;
}

class UpdateUserDto {
  account?: string;
  name?: string;
  email?: string;
  mobile?: string;
  status?: string;
  user_type?: string;
  org_id?: string;
}

@Controller('admin/users')
@UseGuards(AuthGuard, PermissionGuard)
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
  ) {}

  private isPlaceholderStudentNo(value?: string | null) {
    return /^student_\d+$/i.test(String(value || '').trim());
  }

  private resolveDisplayAccount(user: {
    id?: bigint;
    user_type?: string;
    mobile?: string | null;
    email?: string | null;
    student_profile?: { student_no?: string | null } | null;
  }) {
    const mobile = String(user?.mobile || '').trim();
    const studentNo = String(user?.student_profile?.student_no || '').trim();
    const usableStudentNo =
      studentNo && !this.isPlaceholderStudentNo(studentNo) ? studentNo : '';

    if (String(user?.user_type || '').trim() === 'student' && usableStudentNo) {
      return usableStudentNo;
    }

    if (mobile) {
      return mobile;
    }

    const email = String(user?.email || '').trim();
    if (email) {
      return email;
    }

    if (usableStudentNo) {
      return usableStudentNo;
    }

    return user?.id ? `user_${user.id.toString()}` : '';
  }

  private resolveDisplayMobile(user: {
    mobile?: string | null;
    student_profile?: { mobile?: string | null } | null;
  }) {
    const studentMobile = String(user?.student_profile?.mobile || '').trim();
    const normalizedStudentMobile = normalizeMobile(studentMobile) || '';
    if (normalizedStudentMobile && isValidMainlandMobile(normalizedStudentMobile)) {
      return normalizedStudentMobile;
    }

    const mobile = String(user?.mobile || '').trim();
    const normalizedMobile = normalizeMobile(mobile) || '';
    if (normalizedMobile && isValidMainlandMobile(normalizedMobile)) {
      return normalizedMobile;
    }

    return '';
  }

  private mapUserStatusToStudentStatus(status?: string | null) {
    const normalized = String(status || '').trim();
    if (!normalized) {
      return undefined;
    }
    if (normalized === 'active') {
      return 'active';
    }
    if (normalized === 'inactive' || normalized === 'disabled') {
      return 'inactive';
    }
    return normalized;
  }

  private async buildStudentProfileSyncPayload(
    userId: bigint,
    dto: UpdateUserDto,
    normalizedMobile?: string,
  ) {
    const studentProfile = await this.prisma.student_profiles.findUnique({
      where: { user_id: userId },
      select: {
        id: true,
        mobile: true,
      },
    });

    if (!studentProfile) {
      return null;
    }

    const updateData: Record<string, any> = {};

    if (dto.email !== undefined) {
      updateData.email = dto.email || null;
    }

    if (dto.status) {
      updateData.status = this.mapUserStatusToStudentStatus(dto.status);
    }

    if (dto.org_id !== undefined) {
      updateData.org_id = dto.org_id ? BigInt(dto.org_id) : null;
    }

    if (dto.mobile !== undefined) {
      const normalizedProfileMobile = normalizeMobile(normalizedMobile) || '';
      if (!normalizedMobile) {
        updateData.mobile = null;
      } else if (
        normalizedProfileMobile
        && isValidMainlandMobile(normalizedProfileMobile)
      ) {
        updateData.mobile = normalizedProfileMobile;
      } else {
        const currentMobile = normalizeMobile(studentProfile.mobile) || '';
        if (!currentMobile || !isValidMainlandMobile(currentMobile)) {
          updateData.mobile = null;
        }
      }
    }

    return Object.keys(updateData).length > 0
      ? {
          id: studentProfile.id,
          data: updateData,
        }
      : null;
  }

  private async deleteStudentAccountRelations(tx: any, userId: bigint) {
    const studentProfile = await tx.student_profiles.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });

    if (!studentProfile) {
      return;
    }

    const studentId = studentProfile.id as bigint;
    const warningIds = (
      await tx.warnings.findMany({
        where: { student_id: studentId },
        select: { id: true },
      })
    ).map((item: any) => item.id as bigint);

    if (warningIds.length > 0) {
      const notificationJobIds = (
        await tx.notification_jobs.findMany({
          where: { warning_id: { in: warningIds } },
          select: { id: true },
        })
      ).map((item: any) => item.id as bigint);

      if (notificationJobIds.length > 0) {
        await tx.notification_logs.deleteMany({
          where: { job_id: { in: notificationJobIds } },
        });
      }

      await tx.notification_jobs.deleteMany({
        where: { warning_id: { in: warningIds } },
      });
    }

    const warningCaseIds = (
      await tx.warning_cases.findMany({
        where: { student_id: studentId },
        select: { id: true },
      })
    ).map((item: any) => item.id as bigint);

    if (warningCaseIds.length > 0) {
      await tx.warning_case_logs.deleteMany({
        where: { case_id: { in: warningCaseIds } },
      });
    }

    await tx.student_notification_reads.deleteMany({
      where: { student_id: studentId },
    });
    await tx.leave_requests.deleteMany({
      where: { student_id: studentId },
    });
    await tx.makeup_requests.deleteMany({
      where: { student_id: studentId },
    });
    await tx.appeals.deleteMany({
      where: { student_id: studentId },
    });
    await tx.attendance_records.deleteMany({
      where: { student_id: studentId },
    });
    await tx.daily_records.deleteMany({
      where: { student_id: studentId },
    });
    await tx.warning_cases.deleteMany({
      where: { student_id: studentId },
    });
    await tx.warnings.deleteMany({
      where: { student_id: studentId },
    });
    await tx.weekly_summaries.deleteMany({
      where: { student_id: studentId },
    });
    await tx.monthly_summaries.deleteMany({
      where: { student_id: studentId },
    });
    await tx.term_summaries.deleteMany({
      where: { student_id: studentId },
    });
    await tx.grades.deleteMany({
      where: { student_id: userId },
    });
    await tx.change_requests.deleteMany({
      where: {
        target_type: {
          in: ['student_profile', 'student_profile_class_change'],
        },
        target_id: studentId,
      },
    });
    await tx.student_profiles.delete({
      where: { id: studentId },
    });
  }

  private async deleteTeacherAccountRelations(tx: any, userId: bigint) {
    const classNotificationIds = (
      await tx.class_notifications.findMany({
        where: { publisher_id: userId },
        select: { id: true },
      })
    ).map((item: any) => item.id as bigint);

    if (classNotificationIds.length > 0) {
      await tx.student_notification_reads.deleteMany({
        where: {
          notification_id: { in: classNotificationIds },
        },
      });
    }

    await tx.classes.updateMany({
      where: { counselor_user_id: userId },
      data: { counselor_user_id: null },
    });
    await tx.teacher_course_bindings.deleteMany({
      where: { teacher_id: userId },
    });
    await tx.course_classes.deleteMany({
      where: { teacher_user_id: userId },
    });
    await tx.class_sessions.deleteMany({
      where: { teacher_user_id: userId },
    });
    await tx.schedules.deleteMany({
      where: { teacher_user_id: userId },
    });
    await tx.class_notifications.deleteMany({
      where: { publisher_id: userId },
    });
    await tx.change_requests.deleteMany({
      where: {
        target_type: 'teacher_org_change',
        OR: [{ target_id: userId }, { requester_user_id: userId }],
      },
    });
  }

  private async clearGeneralUserRelations(tx: any, userId: bigint) {
    await tx.auth_challenges.deleteMany({
      where: { user_id: userId },
    });
    await tx.security_events.updateMany({
      where: { user_id: userId },
      data: { user_id: null },
    });
    await tx.notification.deleteMany({
      where: { user_id: userId },
    });
    await tx.idempotency_keys.deleteMany({
      where: { user_id: userId },
    });
    await tx.notification_jobs.updateMany({
      where: { sender_user_id: userId },
      data: { sender_user_id: null },
    });
    await tx.notification_logs.updateMany({
      where: { acknowledged_by: userId },
      data: { acknowledged_by: null },
    });
    await tx.leave_requests.updateMany({
      where: { approver_user_id: userId },
      data: { approver_user_id: null },
    });
    await tx.makeup_requests.updateMany({
      where: { approver_user_id: userId },
      data: { approver_user_id: null },
    });
    await tx.appeals.updateMany({
      where: { handler_user_id: userId },
      data: { handler_user_id: null },
    });
    await tx.warnings.updateMany({
      where: { acknowledged_by: userId },
      data: { acknowledged_by: null },
    });
    await tx.warnings.updateMany({
      where: { closed_by: userId },
      data: { closed_by: null },
    });
    await tx.warning_cases.updateMany({
      where: { handler_user_id: userId },
      data: { handler_user_id: null },
    });
    await tx.warning_cases.updateMany({
      where: { assigned_by: userId },
      data: { assigned_by: null },
    });
    await tx.warning_case_logs.updateMany({
      where: { actor_user_id: userId },
      data: { actor_user_id: null },
    });
    await tx.change_requests.updateMany({
      where: { approver_user_id: userId },
      data: { approver_user_id: null },
    });
    await tx.user_roles.deleteMany({
      where: { user_id: userId },
    });
  }

  private getForeignKeyFieldName(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return '';
    }

    const fieldName = (error.meta as any)?.field_name;
    return typeof fieldName === 'string' ? fieldName : '';
  }

  private async isMobileInUse(
    mobile: string,
    excludeUserId?: bigint,
    excludeStudentUserId?: bigint,
  ): Promise<boolean> {
    const [existingUser, existingStudent] = await Promise.all([
      this.prisma.users.findFirst({
        where: {
          mobile,
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.student_profiles.findFirst({
        where: {
          mobile,
          ...(excludeStudentUserId
            ? {
                user_id: { not: excludeStudentUserId },
              }
            : {}),
        },
        select: { id: true },
      }),
    ]);

    return !!existingUser || !!existingStudent;
  }

  private isValidEmail(value?: string | null) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  private isValidNumericAccount(value?: string | null) {
    return /^\d{6,20}$/.test(String(value || '').trim());
  }

  private isValidUsernameAccount(value?: string | null) {
    return /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(
      String(value || '').trim(),
    );
  }

  private normalizeLoginAccount(value?: string | null) {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }

    if (isValidMainlandMobile(normalized)) {
      return normalizeMobile(normalized) || '';
    }

    if (this.isValidNumericAccount(normalized) || this.isValidUsernameAccount(normalized)) {
      return normalized;
    }

    return '';
  }

  private async buildOrgContextForUsers(users: any[], userRolesMap: Map<string, any[]>) {
    const roleScopedOrgIds: bigint[] = [];
    const roleScopedClassIds: bigint[] = [];

    for (const user of users) {
      const roles = userRolesMap.get(user.id.toString()) || [];
      for (const role of roles) {
        if (
          ['student_admin', 'vice_dean'].includes(String(role.role || ''))
          && role.scope_id
        ) {
          roleScopedOrgIds.push(role.scope_id);
        }
        if (String(role.scope_type || '') === 'class' && role.scope_id) {
          roleScopedClassIds.push(role.scope_id);
        }
      }
    }

    const uniqueClassIds = Array.from(
      new Map(roleScopedClassIds.map((item) => [item.toString(), item])).values(),
    );
    const classes = uniqueClassIds.length
      ? await this.prisma.classes.findMany({
          where: { id: { in: uniqueClassIds } },
          select: { id: true, org_id: true },
        })
      : [];
    const classOrgMap = new Map(
      classes.map((item: any) => [item.id.toString(), item.org_id?.toString() || '']),
    );

    const orgIds = Array.from(
      new Map(
        [
          ...users
            .map((item: any) => item.org_id)
            .filter(Boolean)
            .map((item: bigint) => [item.toString(), item] as [string, bigint]),
          ...roleScopedOrgIds.map((item) => [item.toString(), item] as [string, bigint]),
          ...classes
            .map((item: any) => item.org_id)
            .filter(Boolean)
            .map((item: bigint) => [item.toString(), item] as [string, bigint]),
        ],
      ).values(),
    );

    const orgs = orgIds.length
      ? await this.prisma.orgs.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgNameMap = new Map(orgs.map((item: any) => [item.id.toString(), item.name]));

    const derivedOrgIdMap = new Map<string, string>();
    for (const user of users) {
      if (user.org_id) {
        derivedOrgIdMap.set(user.id.toString(), user.org_id.toString());
        continue;
      }

      const roles = userRolesMap.get(user.id.toString()) || [];
      const orgScopedRole = roles.find(
        (item: any) =>
          ['student_admin', 'vice_dean'].includes(String(item.role || '')) && item.scope_id,
      );
      if (orgScopedRole?.scope_id) {
        derivedOrgIdMap.set(user.id.toString(), orgScopedRole.scope_id.toString());
        continue;
      }

      const classScopedRole = roles.find(
        (item: any) => String(item.scope_type || '') === 'class' && item.scope_id,
      );
      if (classScopedRole?.scope_id) {
        const classOrgId = classOrgMap.get(classScopedRole.scope_id.toString());
        if (classOrgId) {
          derivedOrgIdMap.set(user.id.toString(), classOrgId);
        }
      }
    }

    return {
      derivedOrgIdMap,
      orgNameMap,
    };
  }

  // 获取所有用户列表（分页）
  @Get()
  @Permissions('user:manage')
  async getUsers(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 10,
    @Query('role') role?: string,
    @Query('search') search?: string,
    @Query('user_type') user_type?: string,
    @Query('status') status?: string,
  ) {
    let where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { mobile: { contains: search } },
        {
          student_profile: {
            is: {
              student_no: { contains: search },
            },
          },
        },
      ];
    }

    if (user_type) {
      where.user_type = user_type;
    }

    if (status) {
      where.status = status;
    }

    // 计算偏移量
    const skip = (page - 1) * pageSize;

    let users: any[];
    let total: number;

    if (role) {
      // 如果按角色筛选，先查询 user_roles 表找到符合条件的用户ID
      const userRoles = await this.prisma.user_roles.findMany({
        where: { role },
        select: { user_id: true },
      });
      const userIds = userRoles.map((ur: any) => ur.user_id);
      
      // 合并其他筛选条件
      if (Object.keys(where).length > 0) {
        where = { ...where, id: { in: userIds } };
      } else {
        where = { id: { in: userIds } };
      }
      
      total = await this.prisma.users.count({ where });
      
      users = await this.prisma.users.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: {
          student_profile: true,
          orgs: true,
        },
      });
    } else {
      // 查询用户总数
      total = await this.prisma.users.count({ where });

      // 查询用户列表
      users = await this.prisma.users.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: {
          student_profile: true,
          orgs: true,
        },
      });
    }

    const userIds = users.map((item: any) => item.id);
    const roles = userIds.length
      ? await this.prisma.user_roles.findMany({
          where: { user_id: { in: userIds } },
          orderBy: [{ user_id: 'asc' }, { created_at: 'asc' }],
        })
      : [];
    const userRolesMap = new Map<string, any[]>();
    for (const roleItem of roles) {
      const key = roleItem.user_id.toString();
      if (!userRolesMap.has(key)) {
        userRolesMap.set(key, []);
      }
      userRolesMap.get(key)!.push(roleItem);
    }

    const { derivedOrgIdMap, orgNameMap } = await this.buildOrgContextForUsers(
      users,
      userRolesMap,
    );

    const usersWithRoles = users.map((user: any) => {
      const userRoles = userRolesMap.get(user.id.toString()) || [];
      const derivedOrgId = derivedOrgIdMap.get(user.id.toString()) || '';
      const orgIdText = user.org_id?.toString() || derivedOrgId || '';
      const orgName = orgIdText
        ? user.orgs?.name || orgNameMap.get(orgIdText) || ''
        : '';

      return {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        mobile: this.resolveDisplayMobile(user),
        account: this.resolveDisplayAccount(user),
        user_type: user.user_type,
        status: user.status,
        org_id: orgIdText,
        org_name: orgName,
        roles: userRoles.map((ur: any) => ({
          id: ur.id.toString(),
          role: normalizeRoleCode(ur.role),
          scope_type: ur.scope_type,
          scope_id: ur.scope_id?.toString(),
        })),
        student_info: user.student_profile ? {
          id: user.student_profile.id.toString(),
          student_no: user.student_profile.student_no,
          class_id: user.student_profile.class_id.toString(),
        } : null,
        created_at: user.created_at,
        updated_at: user.updated_at,
      };
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        list: usersWithRoles,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    };
  }

  // 创建用户
  @Post()
  @Permissions('user:manage')
  async createUser(@Body() dto: CreateUserDto) {
    const accountInput = String(dto.account || dto.mobile || '').trim();
    const normalizedAccount = this.normalizeLoginAccount(accountInput);
    if (!normalizedAccount) {
      return {
        code: 400,
        message: '账号格式不正确，请使用手机号、工号或英文账号',
        data: null,
      };
    }

    const normalizedEmail = String(dto.email || '').trim() || null;

    // 检查邮箱或手机号是否已存在
    const existingUser = await this.prisma.users.findFirst({
      where: {
        OR: [
          ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
          { mobile: normalizedAccount },
        ],
      },
    });

    if (existingUser) {
      return {
        code: 400,
        message: '邮箱或手机号已存在',
        data: null,
      };
    }

    if (await this.isMobileInUse(normalizedAccount)) {
      return {
        code: 400,
        message: '账号或邮箱已存在',
        data: null,
      };
    }

    // 获取默认密码配置
    let defaultPassword = '';
    const normalizedRole = normalizeRoleCode(String(dto.role || '').trim());
    let roleAssignment:
      | {
          role: string;
          scope_type: string;
          scope_id: bigint | null;
          user_type: string;
        }
      | null = null;

    if (normalizedRole) {
      const roleCatalog = await loadRoleCatalog(this.prisma);
      const roleConfig = roleCatalog.find((item) => item.code === normalizedRole);
      if (!roleConfig) {
        return {
          code: 400,
          message: '角色不存在',
          data: null,
        };
      }

      const requestedScopeType =
        String(dto.scope_type || '').trim() ||
        roleConfig.register_scope ||
        roleConfig.default_scope ||
        'self';
      const normalizedScopeType =
        requestedScopeType === 'college' ? 'org' : requestedScopeType;
      const resolvedScopeId =
        normalizedScopeType === 'class'
          ? dto.class_id
            ? BigInt(dto.class_id)
            : dto.scope_id
              ? BigInt(dto.scope_id)
              : null
          : normalizedScopeType === 'org'
            ? dto.org_id
              ? BigInt(dto.org_id)
              : dto.scope_id
                ? BigInt(dto.scope_id)
                : null
            : null;

      roleAssignment = {
        role: normalizedRole,
        scope_type: normalizedScopeType,
        scope_id: resolvedScopeId,
        user_type: roleConfig.user_type,
      };
    }

    try {
      const passwordConfig = await this.prisma.system_settings.findUnique({
        where: { setting_key: 'account.defaultPassword' },
      });
      if (passwordConfig?.setting_val) {
        defaultPassword = String(passwordConfig.setting_val || '').trim();
      }
    } catch (e) {
      // Ignore config read failure and fall back to generated password below.
    }

    if (!defaultPassword || isWeakPassword(defaultPassword)) {
      defaultPassword = generateStrongPassword(12);
    }

    // 加密密码
    const passwordHash = await hashPassword(defaultPassword);
    const initialOrgId =
      roleAssignment && ['student_admin', 'vice_dean'].includes(roleAssignment.role)
        ? roleAssignment.scope_id
        : !roleAssignment && dto.org_id
          ? BigInt(dto.org_id)
          : null;

    // 创建用户
    const user = await this.prisma.users.create({
      data: {
        name: dto.name,
        email: normalizedEmail,
        mobile: normalizedAccount,
        user_type: roleAssignment?.user_type || dto.user_type,
        org_id: initialOrgId,
        status: dto.status || 'active',
        password_hash: passwordHash,
      },
    });

    if (roleAssignment) {
      await this.prisma.user_roles.create({
        data: {
          user_id: user.id,
          role: roleAssignment.role,
          scope_type: roleAssignment.scope_type,
          scope_id: roleAssignment.scope_id,
        },
      });

      if (roleAssignment.role === 'head_teacher' && roleAssignment.scope_id) {
        const classInfo = await this.prisma.classes.findUnique({
          where: { id: roleAssignment.scope_id },
          select: { id: true, org_id: true },
        });
        if (classInfo) {
          await this.prisma.$transaction([
            this.prisma.classes.update({
              where: { id: classInfo.id },
              data: { counselor_user_id: user.id },
            }),
            this.prisma.users.update({
              where: { id: user.id },
              data: { org_id: classInfo.org_id },
            }),
          ]);
        }
      }

      if (roleAssignment.role === 'head_teacher') {
        const teacherRole = await this.prisma.user_roles.findFirst({
          where: {
            user_id: user.id,
            role: 'teacher',
          },
          select: { id: true },
        });

        if (!teacherRole) {
          await this.prisma.user_roles.create({
            data: {
              user_id: user.id,
              role: 'teacher',
              scope_type: 'self',
              scope_id: null,
            },
          });
        }
      }

      if (
        ['student_admin', 'vice_dean'].includes(roleAssignment.role)
        && roleAssignment.scope_id
      ) {
        await this.prisma.users.update({
          where: { id: user.id },
          data: { org_id: roleAssignment.scope_id },
        });
      }
    }

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        mobile: this.resolveDisplayMobile({
          ...user,
          student_profile: await this.prisma.student_profiles.findUnique({
            where: { user_id: user.id },
            select: { student_no: true, mobile: true },
          }),
        }),
        account: this.resolveDisplayAccount({
          ...user,
          student_profile: await this.prisma.student_profiles.findUnique({
            where: { user_id: user.id },
            select: { student_no: true },
          }),
        }),
        user_type: user.user_type,
        role: roleAssignment?.role || null,
        status: user.status,
        initial_password: defaultPassword,
        created_at: user.created_at,
      },
    };
  }

  // 更新用户
  @Put(':id')
  @Permissions('user:manage')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    const userId = BigInt(id);
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return {
        code: 404,
        message: '用户不存在',
        data: null,
      };
    }

    if (dto.account !== undefined) {
      const normalizedAccount = this.normalizeLoginAccount(dto.account);
      if (!normalizedAccount) {
        return {
          code: 400,
          message: '账号格式不正确，请使用手机号、工号或英文账号',
          data: null,
        };
      }

      const duplicatedAccount = await this.prisma.users.findFirst({
        where: {
          id: { not: userId },
          mobile: normalizedAccount,
        },
        select: { id: true },
      });
      if (duplicatedAccount) {
        return {
          code: 400,
          message: '账号已存在',
          data: null,
        };
      }

      if (await this.isMobileInUse(normalizedAccount, userId, userId)) {
        return {
          code: 400,
          message: '账号已存在',
          data: null,
        };
      }

      dto.mobile = normalizedAccount;
    }

    const [studentProfile, existingRoles] = await Promise.all([
      this.prisma.student_profiles.findUnique({
        where: { user_id: userId },
        select: { id: true, mobile: true },
      }),
      this.prisma.user_roles.findMany({
        where: { user_id: userId },
        select: { id: true, role: true, scope_type: true, scope_id: true },
      }),
    ]);

    if (
      dto.user_type !== undefined
      && String(dto.user_type || '').trim()
      && String(dto.user_type) !== String(user.user_type)
      && (studentProfile || existingRoles.length > 0)
    ) {
      return {
        code: 400,
        message: '该用户已有关联档案或角色，请通过专用流程调整用户类型',
        data: null,
      };
    }

    if (
      dto.org_id !== undefined
      && existingRoles.some((item: any) => item.role === 'head_teacher')
    ) {
      return {
        code: 400,
        message: '班主任所属学院由班级绑定决定，请通过班主任绑定流程调整',
        data: null,
      };
    }

    const normalizedMobile = dto.mobile !== undefined ? String(dto.mobile).trim() : undefined;

    if (dto.email || normalizedMobile !== undefined) {
      const duplicatedUser = await this.prisma.users.findFirst({
        where: {
          id: { not: userId },
          OR: [
            ...(dto.email ? [{ email: dto.email }] : []),
            ...(normalizedMobile ? [{ mobile: normalizedMobile }] : []),
          ],
        },
      });

      if (duplicatedUser) {
        return {
          code: 400,
          message: '账号或邮箱已存在',
          data: null,
        };
      }

      if (
        normalizedMobile &&
        (await this.isMobileInUse(normalizedMobile, userId, userId))
      ) {
        return {
          code: 400,
          message: '账号或邮箱已存在',
          data: null,
        };
      }
    }

    const updateData: any = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.email !== undefined) updateData.email = dto.email || null;
    if (dto.mobile !== undefined) updateData.mobile = normalizedMobile;
    if (dto.status) updateData.status = dto.status;
    if (dto.user_type) updateData.user_type = dto.user_type;
    if (dto.org_id) updateData.org_id = BigInt(dto.org_id);
    else if (dto.org_id === null || dto.org_id === '') updateData.org_id = null;

    const studentProfileSync = studentProfile
      ? await this.buildStudentProfileSyncPayload(
          userId,
          dto,
          normalizedMobile,
        )
      : null;

    const operations: any[] = [
      this.prisma.users.update({
        where: { id: userId },
        data: updateData,
      }),
    ];
    if (studentProfileSync) {
      operations.push(
        this.prisma.student_profiles.update({
          where: { id: studentProfileSync.id },
          data: studentProfileSync.data,
        }),
      );
    }
    if (dto.org_id !== undefined) {
      const nextScopeId = dto.org_id ? BigInt(dto.org_id) : null;
      const scopedRoleIds = existingRoles
        .filter((item: any) => ['student_admin', 'vice_dean'].includes(String(item.role || '')))
        .map((item: any) => item.id as bigint);
      if (scopedRoleIds.length > 0) {
        operations.push(
          this.prisma.user_roles.updateMany({
            where: { id: { in: scopedRoleIds } },
            data: { scope_id: nextScopeId },
          }),
        );
      }
    }

    const [updatedUser] = await this.prisma.$transaction(operations);

    return {
      code: 0,
      message: '更新成功',
      data: {
        id: updatedUser.id.toString(),
        name: updatedUser.name,
        email: updatedUser.email,
        mobile: this.resolveDisplayMobile({
          ...updatedUser,
          student_profile: await this.prisma.student_profiles.findUnique({
            where: { user_id: updatedUser.id },
            select: { student_no: true, mobile: true },
          }),
        }),
        account: this.resolveDisplayAccount({
          ...updatedUser,
          student_profile: await this.prisma.student_profiles.findUnique({
            where: { user_id: updatedUser.id },
            select: { student_no: true },
          }),
        }),
        user_type: updatedUser.user_type,
        status: updatedUser.status,
        updated_at: updatedUser.updated_at,
      },
    };
  }

  // 获取用户详情
  @Get(':id')
  @Permissions('user:manage')
  async getUser(@Param('id') id: string) {
    const user = await this.prisma.users.findUnique({
      where: { id: BigInt(id) },
      include: {
        student_profile: {
          include: {
            classes: true,
          },
        },
        orgs: true,
      },
    });

    if (!user) {
      return { code: 404, message: '用户不存在', data: null };
    }

    // 获取用户角色
    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: user.id },
    });
    const userRolesMap = new Map([[user.id.toString(), roles]]);
    const { derivedOrgIdMap, orgNameMap } = await this.buildOrgContextForUsers(
      [user],
      userRolesMap,
    );
    const orgIdText =
      user.org_id?.toString() || derivedOrgIdMap.get(user.id.toString()) || '';
    const orgName = orgIdText ? user.orgs?.name || orgNameMap.get(orgIdText) || '' : '';

    return {
      code: 0,
      message: 'ok',
      data: {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        mobile: this.resolveDisplayMobile(user),
        account: this.resolveDisplayAccount(user),
        user_type: user.user_type,
        status: user.status,
        org_id: orgIdText,
        org_name: orgName,
        roles: roles.map((ur: any) => ({
          id: ur.id.toString(),
          role: normalizeRoleCode(ur.role),
          scope_type: ur.scope_type,
          scope_id: ur.scope_id?.toString(),
        })),
        student_info: user.student_profile ? {
          id: user.student_profile.id.toString(),
          student_no: user.student_profile.student_no,
          class_id: user.student_profile.class_id.toString(),
          class_name: user.student_profile.classes?.class_name,
        } : null,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    };
  }

  // 禁用用户
  @Put(':id/disable')
  @Permissions('user:manage')
  async disableUser(@Param('id') id: string) {
    const userId = BigInt(id);
    const studentProfile = await this.prisma.student_profiles.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });

    const operations: any[] = [
      this.prisma.users.update({
        where: { id: userId },
        data: { status: 'inactive' },
      }),
    ];
    if (studentProfile) {
      operations.push(
        this.prisma.student_profiles.update({
          where: { id: studentProfile.id },
          data: { status: 'inactive' },
        }),
      );
    }

    const [user] = await this.prisma.$transaction(operations);

    return {
      code: 0,
      message: '禁用成功',
      data: {
        id: user.id.toString(),
        status: user.status,
      },
    };
  }

  // 启用用户
  @Put(':id/enable')
  @Permissions('user:manage')
  async enableUser(@Param('id') id: string) {
    const userId = BigInt(id);
    const studentProfile = await this.prisma.student_profiles.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });

    const operations: any[] = [
      this.prisma.users.update({
        where: { id: userId },
        data: { status: 'active' },
      }),
    ];
    if (studentProfile) {
      operations.push(
        this.prisma.student_profiles.update({
          where: { id: studentProfile.id },
          data: { status: 'active' },
        }),
      );
    }

    const [user] = await this.prisma.$transaction(operations);

    return {
      code: 0,
      message: '启用成功',
      data: {
        id: user.id.toString(),
        status: user.status,
      },
    };
  }

  // 重置密码
  @Put(':id/password')
  @Permissions('user:manage')
  async resetPassword(
    @Param('id') id: string,
    @Body() body: { newPassword?: string; new_password?: string },
  ) {
    const user = await this.prisma.users.findUnique({
      where: { id: BigInt(id) },
    });

    if (!user) {
      return {
        code: 404,
        message: '用户不存在',
        data: null,
      };
    }

    const newPassword = String(body.newPassword || body.new_password || '').trim();
    if (isWeakPassword(newPassword)) {
      return {
        code: 400,
        message: '新密码过于简单，请使用至少8位且包含两类字符的密码',
        data: null,
      };
    }

    // 更新密码
    const operations: any[] = [
      this.prisma.users.update({
        where: { id: BigInt(id) },
        data: { password_hash: await hashPassword(newPassword) },
      }),
    ];

    if (user.user_type === 'student') {
      operations.push(
        this.prisma.student_profiles.updateMany({
          where: { user_id: user.id },
          data: { initial_password: null },
        }),
      );
    }

    await this.prisma.$transaction(operations);

    return {
      code: 0,
      message: '密码重置成功',
      data: null,
    };
  }

  // 删除用户
  @Delete(':id')
  @Permissions('user:manage')
  async deleteUser(@Param('id') id: string) {
    const userId = BigInt(id);
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        user_type: true,
        name: true,
      },
    });

    if (!user) {
      return {
        code: 404,
        message: '用户不存在',
        data: null,
      };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.deleteStudentAccountRelations(tx, userId);
        await this.deleteTeacherAccountRelations(tx, userId);
        await this.clearGeneralUserRelations(tx, userId);

        await tx.users.delete({
          where: { id: userId },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        const fieldName = this.getForeignKeyFieldName(error);
        return {
          code: 409,
          message: fieldName
            ? `该用户仍有关联数据（${fieldName}），请先清理相关业务记录后再删除`
            : '该用户仍有关联业务数据，请先清理相关记录后再删除',
          data: null,
        };
      }

      throw error;
    }

    return {
      code: 0,
      message: '删除成功',
      data: null,
    };
  }

  // 获取用户的角色
  @Get(':id/roles')
  @Permissions('user:manage')
  async getUserRoles(@Param('id') id: string) {
    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: BigInt(id) },
    });

    return {
      code: 0,
      message: 'ok',
      data: roles.map((r: any) => ({
        id: r.id.toString(),
        role: r.role,
        scope_type: r.scope_type,
        scope_id: r.scope_id?.toString(),
        created_at: r.created_at,
      })),
    };
  }

  /**
   * 权限分配弹窗数据源：角色默认 + 自定义覆盖 + 真实生效 + 全量权限清单
   */
  @Get(':id/permissions')
  @Permissions('user:manage')
  async getUserPermissions(@Param('id') id: string) {
    const detail = await this.permissionService.getUserPermissionDetail(BigInt(id));
    return {
      code: 0,
      message: 'ok',
      data: detail,
    };
  }

  /**
   * 保存该用户的自定义权限（整体覆盖），保存后立刻清缓存 → 立即生效。
   * body: { permission_ids: string[] }
   */
  @Put(':id/permissions')
  @Permissions('user:manage')
  async updateUserPermissions(
    @Param('id') id: string,
    @Body() dto: { permission_ids?: Array<string | number> },
    @Req() req: any,
  ) {
    const rawIds = Array.isArray(dto?.permission_ids) ? dto.permission_ids : [];
    const permissionIds: bigint[] = [];
    for (const raw of rawIds) {
      const text = String(raw ?? '').trim();
      if (!/^\d+$/.test(text)) {
        return { code: 400, message: '权限项格式不正确', data: null, trace_id: req?.trace_id };
      }
      permissionIds.push(BigInt(text));
    }

    const grantedBy = Number(req?.user?.sub || 0) > 0 ? BigInt(req.user.sub) : undefined;
    const result = await this.permissionService.setUserPermissions(
      BigInt(id),
      permissionIds,
      grantedBy,
    );

    if (!result.ok) {
      return { code: 403, message: result.message, data: null, trace_id: req?.trace_id };
    }

    const detail = await this.permissionService.getUserPermissionDetail(BigInt(id));
    return {
      code: 0,
      message: `已同步 ${result.count ?? permissionIds.length} 项权限，立即生效`,
      data: detail,
      trace_id: req?.trace_id,
    };
  }

  /** 恢复角色默认（删除该用户的自定义覆盖） */
  @Delete(':id/permissions')
  @Permissions('user:manage')
  async resetUserPermissions(@Param('id') id: string, @Req() req: any) {
    const result = await this.permissionService.resetUserPermissions(BigInt(id));
    if (!result.ok) {
      return { code: 403, message: result.message, data: null, trace_id: req?.trace_id };
    }
    const detail = await this.permissionService.getUserPermissionDetail(BigInt(id));
    return {
      code: 0,
      message: '已恢复角色默认权限',
      data: detail,
      trace_id: req?.trace_id,
    };
  }
}

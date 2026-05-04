import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions, DataScope } from '../rbac/permission.decorator';
import {
  generateStrongPassword,
  isValidMainlandMobile,
  isWeakPassword,
  normalizeMobile,
} from '../shared/account-security.util';
import { hashPassword } from '../shared/password.util';

class CreateTeacherDto {
  name!: string;
  mobile?: string;
  email?: string;
  teacher_position!: string;
  org_id?: string;
  status?: string;
}

class UpdateTeacherDto {
  name?: string;
  mobile?: string;
  email?: string;
  teacher_position?: string;
  org_id?: string;
  status?: string;
}

@Controller('admin/teachers')
@UseGuards(AuthGuard, PermissionGuard)
export class TeachersAdminController {
  constructor(private readonly prisma: PrismaService) {}

  private async isMobileInUse(
    mobile: string,
    excludeUserId?: bigint,
    excludeStudentId?: bigint,
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
          ...(excludeStudentId ? { id: { not: excludeStudentId } } : {}),
        },
        select: { id: true },
      }),
    ]);

    return !!existingUser || !!existingStudent;
  }

  private async isLoginAccountInUse(
    account: string,
    excludeUserId?: bigint,
  ): Promise<boolean> {
    const normalizedAccount = String(account || '').trim();
    if (!normalizedAccount) {
      return false;
    }

    const [existingUser, existingStudent] = await Promise.all([
      this.prisma.users.findFirst({
        where: {
          OR: [
            { mobile: normalizedAccount },
            { email: normalizedAccount },
          ],
          ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        },
        select: { id: true },
      }),
      this.prisma.student_profiles.findFirst({
        where: {
          OR: [
            { student_no: normalizedAccount },
            { mobile: normalizedAccount },
            { email: normalizedAccount },
          ],
        },
        select: { id: true },
      }),
    ]);

    return !!existingUser || !!existingStudent;
  }

  private async generateNextTeacherAccount() {
    const teacherAccounts = await this.prisma.users.findMany({
      where: { user_type: 'teacher' },
      select: { mobile: true },
    });

    let maxNumericAccount = 10000;
    for (const teacher of teacherAccounts) {
      const account = String(teacher.mobile || '').trim();
      if (!/^\d+$/.test(account)) {
        continue;
      }
      const numericValue = Number(account);
      if (Number.isFinite(numericValue) && numericValue > maxNumericAccount) {
        maxNumericAccount = numericValue;
      }
    }

    let nextAccount = String(maxNumericAccount + 1);
    while (await this.isLoginAccountInUse(nextAccount)) {
      nextAccount = String(Number(nextAccount) + 1);
    }

    return nextAccount;
  }

  @Get()
  @Permissions('teacher:read', 'class:read', 'course:read', 'schedule:read')
  async listTeachers(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Query('org_id') orgId?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();
    
    const currentPage = parseInt(page);
    const take = parseInt(pageSize);
    const skip = (currentPage - 1) * take;

    const teacherWhere: any = {
      user_type: 'teacher',
    };
    if (keyword) {
      teacherWhere.OR = [
        { name: { contains: keyword } },
        { mobile: { contains: keyword } },
        { email: { contains: keyword } },
      ];
    }

    const [teacherUsers, headTeacherRolesByKeyword] = await Promise.all([
      this.prisma.users.findMany({
        where: teacherWhere,
        orderBy: { id: 'asc' },
        include: {
          orgs: true,
        },
      }),
      this.prisma.user_roles.findMany({
        where: { role: 'head_teacher' },
        select: {
          user_id: true,
          role: true,
          scope_type: true,
          scope_id: true,
        },
      }),
    ]);

    const headTeacherUserIds = Array.from(
      new Map(headTeacherRolesByKeyword.map((item: any) => [item.user_id.toString(), item.user_id])).values(),
    );
    const teacherUserIdSet = new Set(teacherUsers.map((item: any) => item.id.toString()));
    const extraHeadTeacherUsers = headTeacherUserIds.length > 0
      ? await this.prisma.users.findMany({
          where: {
            id: { in: headTeacherUserIds.filter((item: bigint) => !teacherUserIdSet.has(item.toString())) },
            ...(keyword
              ? {
                  OR: [
                    { name: { contains: keyword } },
                    { mobile: { contains: keyword } },
                    { email: { contains: keyword } },
                  ],
                }
              : {}),
          },
          orderBy: { id: 'asc' },
          include: {
            orgs: true,
          },
        })
      : [];

    const teachers = [...teacherUsers, ...extraHeadTeacherUsers];

    const teacherIds = teachers.map((item: any) => item.id);
    const headTeacherRoles = teacherIds.length > 0
      ? await this.prisma.user_roles.findMany({
          where: {
            user_id: { in: teacherIds },
            role: 'head_teacher',
          },
          select: {
            user_id: true,
            role: true,
            scope_type: true,
            scope_id: true,
          },
        })
      : [];
    const rolesByUserId = new Map<string, any[]>();
    headTeacherRoles.forEach((item: any) => {
      const key = item.user_id.toString();
      const list = rolesByUserId.get(key) || [];
      list.push(item);
      rolesByUserId.set(key, list);
    });

    const scopedClassIds = Array.from(
      new Map(
        headTeacherRoles
          .filter((item: any) => item.scope_type === 'class' && item.scope_id)
          .map((item: any) => [item.scope_id.toString(), item.scope_id]),
      ).values(),
    );
    const scopedClasses = scopedClassIds.length > 0
      ? await this.prisma.classes.findMany({
          where: { id: { in: scopedClassIds } },
          select: { id: true, org_id: true },
        })
      : [];
    const classOrgMap = new Map(
      scopedClasses.map((item: any) => [item.id.toString(), item.org_id?.toString() || '']),
    );
    const orgIds = Array.from(
      new Map(
        [
          ...teachers
            .map((teacher: any) => teacher.org_id)
            .filter(Boolean)
            .map((value: bigint) => [value.toString(), value] as [string, bigint]),
          ...scopedClasses
            .map((item: any) => item.org_id)
            .filter(Boolean)
            .map((value: bigint) => [value.toString(), value] as [string, bigint]),
        ],
      ).values(),
    );
    const orgs = orgIds.length > 0
      ? await this.prisma.orgs.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true },
        })
      : [];
    const orgNameMap = new Map(orgs.map((item: any) => [item.id.toString(), item.name]));

    const normalizedOrgId = String(orgId || '').trim();
    const teacherItems = teachers
      .map((teacher: any) => {
        const headTeacherRole = (rolesByUserId.get(teacher.id.toString()) || []).find(
          (item: any) => item.scope_type === 'class' && item.scope_id,
        );
        const derivedOrgId =
          teacher.org_id?.toString() ||
          (headTeacherRole?.scope_id
            ? classOrgMap.get(headTeacherRole.scope_id.toString()) || ''
            : '');

        return {
          id: teacher.id.toString(),
          name: teacher.name,
          mobile: teacher.mobile,
          email: teacher.email,
          teacher_position: teacher.teacher_position,
          org_id: derivedOrgId,
          org_name: teacher.orgs?.name || orgNameMap.get(derivedOrgId) || '',
          status: teacher.status,
          created_at: teacher.created_at,
        };
      })
      .filter((teacher: any) => !normalizedOrgId || teacher.org_id === normalizedOrgId);

    const total = teacherItems.length;
    const pagedTeachers = teacherItems.slice(skip, skip + take);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: pagedTeachers,
        total,
        page: currentPage,
        pageSize: take,
      },
      trace_id: req.trace_id,
    };
  }

  @Get(':id')
  @Permissions('teacher:read')
  async getTeacher(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const teacher = await this.prisma.users.findUnique({
      where: { id: BigInt(id) },
      include: {
        orgs: true,
      },
    });

    if (!teacher) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        id: teacher.id.toString(),
        name: teacher.name,
        mobile: teacher.mobile,
        email: teacher.email,
        teacher_position: teacher.teacher_position,
        org_id: teacher.org_id ? teacher.org_id.toString() : '',
        org_name: teacher.orgs?.name || '',
        status: teacher.status,
        created_at: teacher.created_at,
      },
      trace_id: req.trace_id,
    };
  }

  @Post()
  @Permissions('teacher:create')
  async createTeacher(@Body() dto: CreateTeacherDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    const normalizedMobile = normalizeMobile(dto.mobile);
    if (normalizedMobile && !isValidMainlandMobile(normalizedMobile)) {
      return {
        code: 400,
        message: '手机号格式不正确',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (normalizedMobile && (await this.isMobileInUse(normalizedMobile))) {
      return {
        code: 400,
        message: '该手机号已被其他账号使用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    let defaultPassword = '';
    try {
      const passwordConfig = await this.prisma.system_settings.findUnique({
        where: { setting_key: 'account.defaultPassword' },
        select: { setting_val: true },
      });
      if (passwordConfig?.setting_val) {
        defaultPassword = String(passwordConfig.setting_val || '').trim();
      }
    } catch {
      defaultPassword = '';
    }

    if (!defaultPassword || isWeakPassword(defaultPassword)) {
      defaultPassword = generateStrongPassword(12);
    }

    const account = normalizedMobile || (await this.generateNextTeacherAccount());
    if (await this.isLoginAccountInUse(account)) {
      return {
        code: 400,
        message: '该账号已存在，请更换手机号或稍后重试',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const passwordHash = await hashPassword(defaultPassword);

    const teacher = await this.prisma.$transaction(async (tx) => {
      const createdTeacher = await tx.users.create({
        data: {
          name: dto.name,
          mobile: account,
          email: dto.email,
          teacher_position: dto.teacher_position,
          org_id: dto.org_id ? BigInt(dto.org_id) : null,
          user_type: 'teacher',
          status: dto.status || 'active',
          password_hash: passwordHash,
        },
      });

      await tx.user_roles.create({
        data: {
          user_id: createdTeacher.id,
          role: 'teacher',
          scope_type: 'self',
          scope_id: null,
        },
      });

      return createdTeacher;
    });

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: teacher.id.toString(),
        account,
        initial_password: defaultPassword,
      },
      trace_id: req.trace_id,
    };
  }

  @Put(':id')
  @Permissions('teacher:update')
  async updateTeacher(
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();
    const teacherId = BigInt(id);
    const teacher = await this.prisma.users.findUnique({
      where: { id: teacherId },
    });

    if (!teacher) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const normalizedMobile =
      dto.mobile !== undefined ? normalizeMobile(dto.mobile) : undefined;
    if (normalizedMobile && !isValidMainlandMobile(normalizedMobile)) {
      return {
        code: 400,
        message: '手机号格式不正确',
        data: null,
        trace_id: req.trace_id,
      };
    }

    if (
      normalizedMobile &&
      (await this.isMobileInUse(normalizedMobile, teacherId, teacherId))
    ) {
      return {
        code: 400,
        message: '该手机号已被其他账号使用',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const updateData: any = {};
    if (dto.name) updateData.name = dto.name;
    if (dto.mobile !== undefined) updateData.mobile = normalizedMobile;
    if (dto.email) updateData.email = dto.email;
    if (dto.teacher_position) updateData.teacher_position = dto.teacher_position;
    if (dto.org_id !== undefined) updateData.org_id = dto.org_id ? BigInt(dto.org_id) : null;
    if (dto.status) updateData.status = dto.status;

    await this.prisma.users.update({
      where: { id: teacherId },
      data: updateData,
    });

    return {
      code: 0,
      message: '更新成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  @Delete(':id')
  @Permissions('teacher:delete')
  async deleteTeacher(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const teacher = await this.prisma.users.findUnique({
      where: { id: BigInt(id) },
    });

    if (!teacher) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const userId = BigInt(id);

    // 将所有班级里的班主任引用置空
    await this.prisma.classes.updateMany({
      where: { counselor_user_id: userId },
      data: { counselor_user_id: null },
    });

    // 删除相关的课程与开课班关联
    await this.prisma.course_classes.deleteMany({
      where: { teacher_user_id: userId },
    });

    // 删除相关的签到课次
    await this.prisma.class_sessions.deleteMany({
      where: { teacher_user_id: userId },
    });

    // 删除相关的课表安排
    await this.prisma.schedules.deleteMany({
      where: { teacher_user_id: userId },
    });

    // 删除用户角色
    await this.prisma.user_roles.deleteMany({
      where: { user_id: userId },
    });

    // 删除用户
    await this.prisma.users.delete({
      where: { id: userId },
    });

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }
}


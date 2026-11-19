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
  Res,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { AuthGuard } from '../shared/auth.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { Permissions, DataScope } from '../rbac/permission.decorator';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Response } from 'express';
import {
  generateStrongPassword,
  isValidMainlandMobile,
  isWeakPassword,
  normalizeMobile,
} from '../shared/account-security.util';
import {
  getClassMonitorPositionOptions,
  loadRoleCatalog,
  normalizeRoleCode,
} from '../shared/role-catalog';

class CreateStudentDto {
  student_no!: string;
  name!: string;
  gender?: string;
  class_id!: string;
  mobile?: string;
  email?: string;
  emergency_contact_name?: string;
  emergency_contact_mobile?: string;
  student_position?: string;
  status?: string;
  password?: string;
}

class UpdateStudentDto {
  student_no?: string;
  name?: string;
  gender?: string;
  class_id?: string;
  mobile?: string;
  email?: string;
  emergency_contact_name?: string;
  emergency_contact_mobile?: string;
  student_position?: string;
  status?: string;
}

@Controller('admin/students')
@UseGuards(AuthGuard, PermissionGuard)
export class StudentsAdminController {
  constructor(private readonly prisma: PrismaService) {}

  private isPlaceholderStudentNo(value?: string | null) {
    return /^student_\d+$/i.test(String(value || '').trim());
  }

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

  private buildStudentScopeWhere(dataScope: any) {
    if (!dataScope || dataScope.type === 'all') {
      return {};
    }

    if (dataScope.type === 'self') {
      return {
        id: { in: dataScope.studentIds?.length ? dataScope.studentIds : [BigInt(-1)] },
      };
    }

    if (dataScope.type === 'class') {
      return {
        class_id: { in: dataScope.classIds?.length ? dataScope.classIds : [BigInt(-1)] },
      };
    }

    if (dataScope.type === 'college') {
      return {
        org_id: {
          in: dataScope.collegeIds?.length ? dataScope.collegeIds : [BigInt(-1)],
        },
      };
    }

    return {
      id: { in: [BigInt(-1)] },
    };
  }

  private generatePasswordByRules(type: string, length: number) {
    const digits = '0123456789';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const safeLength = Math.max(1, Number(length) || 1);
    let chars = '';
    let password = '';

    switch (String(type || '').trim()) {
      case 'letters':
        chars = lower + upper;
        break;
      case 'mixed':
      case 'mixed_random':
        chars = digits + lower + upper;
        break;
      case 'digits':
      default:
        chars = digits;
        break;
    }

    for (let index = 0; index < safeLength; index += 1) {
      const randomIndex = crypto.randomInt(chars.length);
      password += chars[randomIndex];
    }

    return password;
  }

  private generateConfiguredStudentPassword(accountConfig: any) {
    const configuredLength = Number(accountConfig?.defaultPasswordLength) || 8;
    const configuredType = String(accountConfig?.defaultPasswordType || 'digits');
    let password = this.generatePasswordByRules(configuredType, configuredLength);

    if (isWeakPassword(password)) {
      password = generateStrongPassword(Math.max(10, configuredLength));
    }

    return password;
  }

  private resolveStudentAccount(
    user: { id?: bigint; mobile?: string | null; email?: string | null } | null | undefined,
    studentNo?: string | null,
  ) {
    const normalizedStudentNo = String(studentNo || '').trim();
    if (normalizedStudentNo && !this.isPlaceholderStudentNo(normalizedStudentNo)) {
      return normalizedStudentNo;
    }

    const mobile = String(user?.mobile || '').trim();
    if (mobile) {
      return mobile;
    }

    const email = String(user?.email || '').trim();
    if (email) {
      return email;
    }

    return user?.id ? `user_${user.id.toString()}` : '';
  }

  private resolveDisplayMobile(
    value?: string | null,
    fallbackValue?: string | null,
  ) {
    const primary = normalizeMobile(value) || '';
    if (primary && isValidMainlandMobile(primary)) {
      return primary;
    }

    const fallback = normalizeMobile(fallbackValue) || '';
    if (fallback && isValidMainlandMobile(fallback)) {
      return fallback;
    }

    return '';
  }

  private resolveStudentDisplayPosition(
    rawPosition: string | null | undefined,
    hasClassMonitorRole: boolean,
    defaultClassMonitorPosition: string,
    classMonitorPositionOptions: string[],
  ) {
    const normalized = String(rawPosition || '').trim();
    if (hasClassMonitorRole) {
      return normalized || defaultClassMonitorPosition;
    }

    if (normalized && !classMonitorPositionOptions.includes(normalized)) {
      return normalized;
    }

    return '';
  }

  private async syncStudentMonitorRole(
    userId: bigint,
    classId: bigint | null,
    studentPosition: string | null | undefined,
  ) {
    const roleCatalog = await loadRoleCatalog(this.prisma);
    const positionOptions = getClassMonitorPositionOptions(roleCatalog);
    const normalizedPosition = String(studentPosition || '').trim();
    const shouldHaveMonitorRole =
      !!normalizedPosition && positionOptions.includes(normalizedPosition);

    const existingRole = await this.prisma.user_roles.findFirst({
      where: {
        user_id: userId,
        role: 'class_monitor',
      },
      select: {
        id: true,
        scope_type: true,
        scope_id: true,
      },
    });

    if (!shouldHaveMonitorRole || !classId) {
      if (existingRole) {
        await this.prisma.user_roles.delete({
          where: { id: existingRole.id },
        });
      }
      return;
    }

    if (existingRole) {
      if (
        existingRole.scope_type !== 'class'
        || String(existingRole.scope_id || '') !== classId.toString()
      ) {
        await this.prisma.user_roles.update({
          where: { id: existingRole.id },
          data: {
            scope_type: 'class',
            scope_id: classId,
          },
        });
      }
      return;
    }

    await this.prisma.user_roles.create({
      data: {
        user_id: userId,
        role: 'class_monitor',
        scope_type: 'class',
        scope_id: classId,
      },
    });
  }

  // 获取学生列表
  @Get()
  @Permissions('student:read')
  @DataScope({ entity: 'student', field: 'student_id' })
  async listStudents(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('keyword') keyword?: string,
    @Query('class_id') class_id?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();
    
    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const take = parseInt(pageSize);

    const where: any = {};
    
    // 应用数据范围过滤
    const dataScope = req?.dataScope;
    if (dataScope) {
      if (dataScope.type === 'self' && dataScope.studentIds) {
        where.id = { in: dataScope.studentIds.map((id: bigint) => id) };
      } else if (dataScope.type === 'class' && dataScope.classIds) {
        where.class_id = { in: dataScope.classIds.map((id: bigint) => id) };
      } else if (dataScope.type === 'college' && dataScope.collegeIds) {
        where.org_id = { in: dataScope.collegeIds.map((id: bigint) => id) };
      }
      // type === 'all' 时不追加任何过滤条件
    }
    
    if (keyword) {
      where.OR = [
        { student_no: { contains: keyword } },
        { users: { name: { contains: keyword } } },
      ];
    }
    if (class_id) {
      where.class_id = BigInt(class_id);
    }

    const roleCatalog = await loadRoleCatalog(this.prisma);
    const classMonitorPositionOptions = getClassMonitorPositionOptions(roleCatalog);
    const defaultClassMonitorPosition =
      classMonitorPositionOptions[0] || '班干';
    const canIncludeRegisteredOnlyUsers = !class_id && (!dataScope || dataScope.type === 'all');

    const [students, registeredOnlyUsers] = await Promise.all([
      this.prisma.student_profiles.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: {
          users: true,
          classes: true,
        },
      }),
      canIncludeRegisteredOnlyUsers
        ? this.prisma.users.findMany({
            where: {
              user_type: 'student',
              student_profile: {
                is: null,
              },
              ...(keyword
                ? {
                    OR: [
                      { name: { contains: keyword } },
                      { email: { contains: keyword } },
                      { mobile: { contains: keyword } },
                    ],
                  }
                : {}),
            },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    const allStudentUserIds = [
      ...students.map((item: any) => item.user_id),
      ...registeredOnlyUsers.map((item: any) => item.id),
    ];
    const allStudentRoles = allStudentUserIds.length
      ? await this.prisma.user_roles.findMany({
          where: { user_id: { in: allStudentUserIds } },
          orderBy: { created_at: 'asc' },
        })
      : [];
    const registeredRoleMap = new Map<string, any[]>();
    for (const role of allStudentRoles) {
      const key = role.user_id.toString();
      if (!registeredRoleMap.has(key)) {
        registeredRoleMap.set(key, []);
      }
      registeredRoleMap.get(key)!.push(role);
    }

    const mergedList = [
      ...students.map((s: any) => {
        const roles = registeredRoleMap.get(s.user_id.toString()) || [];
        const hasClassMonitorRole = roles.some(
          (role: any) => normalizeRoleCode(role.role) === 'class_monitor',
        );
        return {
        id: s.id.toString(),
        profile_id: s.id.toString(),
        user_id: s.user_id.toString(),
        student_no: s.student_no,
        account: this.resolveStudentAccount(s.users, s.student_no),
        name: s.users.name,
        gender: s.gender,
        class_id: s.class_id.toString(),
        org_id: s.org_id?.toString() || s.classes?.org_id?.toString() || '',
        class_name: s.classes?.class_name || '未绑定班级',
        mobile: this.resolveDisplayMobile(s.mobile, s.users?.mobile),
        email: s.email,
        emergency_contact_name: s.emergency_contact_name,
        emergency_contact_mobile: s.emergency_contact_mobile,
        student_position: this.resolveStudentDisplayPosition(
          s.student_position,
          hasClassMonitorRole,
          defaultClassMonitorPosition,
          classMonitorPositionOptions,
        ),
        wx_openid: s.wx_openid || s.users?.wx_openid || null,
        status: s.status,
        created_at: s.created_at,
        is_registered_only: false,
        };
      }),
      ...registeredOnlyUsers.map((user: any) => {
        const roles = registeredRoleMap.get(user.id.toString()) || [];
        const hasClassMonitorRole = roles.some(
          (role: any) => normalizeRoleCode(role.role) === 'class_monitor',
        );
        return {
          id: `user_${user.id.toString()}`,
          profile_id: '',
          user_id: user.id.toString(),
          student_no: '',
          account: this.resolveStudentAccount(user, ''),
          name: user.name,
          gender: '',
          class_id: '',
          org_id: user.org_id?.toString() || '',
          class_name: '未绑定班级',
          mobile: this.resolveDisplayMobile(user.mobile),
          email: user.email,
          emergency_contact_name: '',
          emergency_contact_mobile: '',
          student_position: this.resolveStudentDisplayPosition(
            '',
            hasClassMonitorRole,
            defaultClassMonitorPosition,
            classMonitorPositionOptions,
          ),
          wx_openid: user.wx_openid,
          status: user.status,
          created_at: user.created_at,
          is_registered_only: true,
        };
      }),
    ]
      .sort(
        (left: any, right: any) =>
          new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime(),
      );

    const total = mergedList.length;
    const pagedList = mergedList.slice(skip, skip + take);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: pagedList,
        total,
        page: parseInt(page),
        pageSize: take,
      },
      trace_id: req.trace_id,
    };
  }

  // 导出学生账号密码
  @Get('export-accounts')
  @Permissions('student:export')
  @DataScope({ entity: 'class', field: 'class_id' })
  async exportStudentAccounts(
    @Query('class_id') classId?: string,
    @Req() req?: any,
  ) {
    await this.prisma.ensureConnected();

    const conditions: any[] = [];
    const scopedWhere = this.buildStudentScopeWhere(req?.dataScope);
    if (Object.keys(scopedWhere).length > 0) {
      conditions.push(scopedWhere);
    }
    if (classId) {
      conditions.push({ class_id: BigInt(classId) });
    }

    const where =
      conditions.length === 0
        ? {}
        : conditions.length === 1
          ? conditions[0]
          : { AND: conditions };

    const students = await this.prisma.student_profiles.findMany({
      where,
      orderBy: [{ org_id: 'asc' }, { class_id: 'asc' }, { student_no: 'asc' }],
      include: {
        users: {
          select: {
            name: true,
          },
        },
        classes: {
          include: {
            orgs: true,
          },
        },
      },
    });

    const exportData = students.map((s: any) => ({
      org_name: s.classes?.orgs?.name || '',
      class_name: s.classes?.class_name || '',
      student_no: s.student_no,
      name: s.users?.name || '',
      account: s.student_no,
      initial_password: s.initial_password || '',
      password_status: s.initial_password
        ? '可直接发放初始密码'
        : '密码已修改或已清空，请重置后发放',
    }));

    return {
      code: 0,
      message: 'ok',
      data: exportData,
      trace_id: req.trace_id,
    };
  }

  // 获取单个学生
  @Get(':id')
  @Permissions('student:read')
  @DataScope({ entity: 'student', field: 'student_id' })
  async getStudent(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(id) },
      include: {
        users: true,
        classes: true,
      },
    });

    if (!student) {
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
        id: student.id.toString(),
        user_id: student.user_id.toString(),
        student_no: student.student_no,
        name: student.users.name,
        gender: student.gender,
        class_id: student.class_id.toString(),
        class_name: student.classes?.class_name || '未知班级',
        mobile: this.resolveDisplayMobile(student.mobile, student.users?.mobile),
        email: student.email,
        emergency_contact_name: student.emergency_contact_name,
        emergency_contact_mobile: student.emergency_contact_mobile,
        student_position: student.student_position,
        wx_openid: student.wx_openid || student.users?.wx_openid || null,
        status: student.status,
        created_at: student.created_at,
      },
      trace_id: req.trace_id,
    };
  }

  // 创建学生
  @Post()
  @Permissions('student:create')
  async createStudent(@Body() dto: CreateStudentDto, @Req() req: any) {
    await this.prisma.ensureConnected();

    try {
      const studentNo = String(dto.student_no || '').trim();
      const name = String(dto.name || '').trim();
      const classIdText = String(dto.class_id || '').trim();
      const normalizedEmail = String(dto.email || '').trim() || null;
      const emergencyContactName =
        String(dto.emergency_contact_name || '').trim() || null;
      const emergencyContactMobile =
        String(dto.emergency_contact_mobile || '').trim() || null;
      const studentPosition = String(dto.student_position || '').trim() || null;
      const status = String(dto.status || 'active').trim() || 'active';

      if (!studentNo) {
        return {
          code: 400,
          message: '学号不能为空',
          data: null,
          trace_id: req.trace_id,
        };
      }

      if (!name) {
        return {
          code: 400,
          message: '姓名不能为空',
          data: null,
          trace_id: req.trace_id,
        };
      }

      if (!/^\d+$/.test(classIdText)) {
        return {
          code: 400,
          message: '请选择有效的班级',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const existing = await this.prisma.student_profiles.findUnique({
        where: { student_no: studentNo },
      });
      if (existing) {
        return {
          code: 400,
          message: '该学号已存在',
          data: null,
          trace_id: req.trace_id,
        };
      }

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

      const settings = await this.prisma.system_settings.findUnique({
        where: { setting_key: 'account' },
      });
      let accountConfig: any = {};
      if (settings?.setting_val) {
        try {
          accountConfig = JSON.parse(settings.setting_val);
        } catch {
          accountConfig = {};
        }
      }

      const useDefault = accountConfig.enableDefaultPassword === true;
      const defaultPwd = String(accountConfig.defaultPassword || '').trim();
      let passwordToUse = '';

      if (useDefault) {
        if (defaultPwd && isWeakPassword(defaultPwd)) {
          return {
            code: 400,
            message: '当前系统默认密码配置过于简单，请先在系统配置中调整账号默认密码',
            data: null,
            trace_id: req.trace_id,
          };
        }
        passwordToUse = defaultPwd || this.generateConfiguredStudentPassword(accountConfig);
      } else {
        const candidatePassword = String(dto.password || '').trim();
        if (candidatePassword) {
          if (isWeakPassword(candidatePassword)) {
            return {
              code: 400,
              message: '学生初始密码过于简单，请使用至少8位且包含两类字符的密码',
              data: null,
              trace_id: req.trace_id,
            };
          }
          passwordToUse = candidatePassword;
        } else {
          passwordToUse = this.generateConfiguredStudentPassword(accountConfig);
        }
      }
      const passwordHash = await bcrypt.hash(passwordToUse, 10);

      const classInfo = await this.prisma.classes.findUnique({
        where: { id: BigInt(classIdText) },
      });
      if (!classInfo) {
        return {
          code: 400,
          message: '所选班级不存在',
          data: null,
          trace_id: req.trace_id,
        };
      }

      const student = await this.prisma.$transaction(async (tx) => {
        const user = await tx.users.create({
          data: {
            name,
            user_type: 'student',
            status,
            org_id: classInfo.org_id,
            mobile: normalizedMobile,
            email: normalizedEmail,
            password_hash: passwordHash,
          },
        });

        const createdStudent = await tx.student_profiles.create({
          data: {
            user_id: user.id,
            student_no: studentNo,
            initial_password: passwordToUse,
            gender: dto.gender || null,
            class_id: BigInt(classIdText),
            org_id: classInfo.org_id,
            major: classInfo.major,
            major_id: classInfo.major_id,
            enroll_year: classInfo.enroll_year,
            mobile: normalizedMobile,
            email: normalizedEmail,
            emergency_contact_name: emergencyContactName,
            emergency_contact_mobile: emergencyContactMobile,
            student_position: studentPosition,
            status,
          },
        });

        await tx.user_roles.create({
          data: {
            user_id: user.id,
            role: 'student',
            scope_type: 'class',
            scope_id: BigInt(classIdText),
          },
        });

        return createdStudent;
      });

      await this.syncStudentMonitorRole(
        student.user_id,
        BigInt(classIdText),
        studentPosition,
      );

      return {
        code: 0,
        message: '创建成功',
        data: {
          id: student.id.toString(),
          student_no: student.student_no,
          initial_password: passwordToUse,
        },
        trace_id: req.trace_id,
      };
    } catch (error: any) {
      return {
        code: 500,
        message: error?.message || '添加学生失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
  }

  // 更新学生
  @Put(':id')
  @Permissions('student:update')
  @DataScope({ entity: 'student', field: 'student_id' })
  async updateStudent(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
    @Req() req: any,
  ) {
    await this.prisma.ensureConnected();
    
    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(id) },
    });

    if (!student) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const dataScope = req?.dataScope;

    if (dataScope && dataScope.type !== 'all') {
      const hasPermission = await this.checkStudentDataScope(student, dataScope);
      if (!hasPermission) {
        return {
          code: 403,
          message: '权限不足，无法操作该学生数据',
          data: null,
          trace_id: req.trace_id,
        };
      }
    }

    // 更新用户信息
    const updateUserData: any = {};
    if (dto.name) {
      updateUserData.name = dto.name;
    }

    // 更新学生档案
    const updateData: any = {};
    if (dto.student_no) updateData.student_no = dto.student_no;
    if (dto.gender) updateData.gender = dto.gender;
    let targetClassInfo: any = null;
    if (dto.class_id) {
      targetClassInfo = await this.prisma.classes.findUnique({
        where: { id: BigInt(dto.class_id) },
        select: { id: true, org_id: true, major: true, major_id: true, enroll_year: true },
      });
      if (!targetClassInfo) {
        return {
          code: 404,
          message: '目标班级不存在',
          data: null,
          trace_id: req.trace_id,
        };
      }
      updateData.class_id = BigInt(dto.class_id);
      updateData.org_id = targetClassInfo.org_id;
      updateData.major = targetClassInfo.major || null;
      updateData.major_id = targetClassInfo.major_id || null;
      updateData.enroll_year = targetClassInfo.enroll_year || null;
      updateUserData.org_id = targetClassInfo.org_id;
    }
    if (dto.email !== undefined) {
      updateData.email = dto.email || null;
      updateUserData.email = dto.email || null;
    }
    if (dto.emergency_contact_name)
      updateData.emergency_contact_name = dto.emergency_contact_name;
    if (dto.emergency_contact_mobile)
      updateData.emergency_contact_mobile = dto.emergency_contact_mobile;
    if (dto.student_position !== undefined) {
      updateData.student_position = dto.student_position || null;
    }
    if (dto.status) {
      updateData.status = dto.status;
      updateUserData.status = dto.status === 'active' ? 'active' : 'inactive';
    }

    if (dto.mobile !== undefined) {
      const normalizedMobile = normalizeMobile(dto.mobile);
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
        (await this.isMobileInUse(normalizedMobile, student.user_id, student.id))
      ) {
        return {
          code: 400,
          message: '该手机号已被其他账号使用',
          data: null,
          trace_id: req.trace_id,
        };
      }
      updateData.mobile = normalizedMobile;
      updateUserData.mobile = normalizedMobile;
    }

    const txList: any[] = [
      this.prisma.student_profiles.update({
        where: { id: BigInt(id) },
        data: updateData,
      }),
    ];
    if (Object.keys(updateUserData).length > 0) {
      txList.push(
        this.prisma.users.update({
          where: { id: student.user_id },
          data: updateUserData,
        }),
      );
    }
    await this.prisma.$transaction(txList);

    const nextClassId =
      dto.class_id !== undefined && String(dto.class_id).trim()
        ? BigInt(dto.class_id)
        : student.class_id;
    const nextStudentPosition =
      dto.student_position !== undefined ? dto.student_position || null : student.student_position;
    await this.syncStudentMonitorRole(
      student.user_id,
      nextClassId,
      nextStudentPosition,
    );

    return {
      code: 0,
      message: '更新成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  // 删除学生
  @Delete(':id')
  @Permissions('student:delete')
  async deleteStudent(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(id) },
    });

    if (!student) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    const dataScope = req?.dataScope;

    if (dataScope && dataScope.type !== 'all') {
      const hasPermission = await this.checkStudentDataScope(student, dataScope);
      if (!hasPermission) {
        return {
          code: 403,
          message: '权限不足，无法删除该学生数据',
          data: null,
          trace_id: req.trace_id,
        };
      }
    }

    // 删除学生档案
    await this.prisma.student_profiles.delete({
      where: { id: BigInt(id) },
    });

    // 删除用户
    await this.prisma.users.delete({
      where: { id: student.user_id },
    });

    return {
      code: 0,
      message: '删除成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  // 批量删除学生
  @Post('batch-delete')
  @Permissions('student:delete')
  async batchDeleteStudents(@Body() dto: { student_ids: string[] }, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const studentIds = dto.student_ids.map((id: any) => BigInt(id));
    const results: {
      success: number;
      failed: number;
      errors: string[];
      students: Array<{ student_no: string; name: string; password: string }>;
    } = {
      success: 0,
      failed: 0,
      errors: [],
      students: [],
    };

    for (const studentId of studentIds) {
      try {
        const student = await this.prisma.student_profiles.findUnique({
          where: { id: studentId },
        });

        if (!student) {
          results.failed++;
          results.errors.push(`ID: ${studentId} 学生不存在`);
          continue;
        }

        const dataScope = req?.dataScope;
        if (dataScope && dataScope.type !== 'all') {
          const hasPermission = await this.checkStudentDataScope(student, dataScope);
          if (!hasPermission) {
            results.failed++;
            results.errors.push(`ID: ${studentId} 权限不足`);
            continue;
          }
        }

        const userId = student.user_id;
        await this.prisma.warnings.deleteMany({ where: { student_id: studentId } });

        // 删除所有相关的请假申请
        await this.prisma.leave_requests.deleteMany({
          where: { student_id: studentId },
        });

        await this.prisma.makeup_requests.deleteMany({
          where: { student_id: studentId },
        });

        // 删除所有相关的申诉
        await this.prisma.appeals.deleteMany({
          where: { student_id: studentId },
        });

        // 删除所有相关的签到记录
        await this.prisma.attendance_records.deleteMany({
          where: { student_id: studentId },
        });

        await this.prisma.daily_records.deleteMany({
          where: { student_id: studentId },
        });

        await this.prisma.warning_cases.deleteMany({
          where: { student_id: studentId },
        });

        await this.prisma.monthly_summaries.deleteMany({
          where: { student_id: studentId },
        });

        await this.prisma.term_summaries.deleteMany({
          where: { student_id: studentId },
        });

        // 删除所有相关的成绩
        await this.prisma.grades.deleteMany({
          where: { student_id: studentId },
        });

        const existingProfile = await this.prisma.student_profiles.findUnique({
          where: { id: studentId },
        });

        if (!existingProfile) {
          results.failed++;
          results.errors.push(`ID: ${studentId} 学生档案不存在，可能已被删除`);
          continue;
        }

        // 删除学生档案
        await this.prisma.student_profiles.delete({
          where: { id: studentId },
        });

        // 删除用户角色
        await this.prisma.user_roles.deleteMany({
          where: { user_id: userId },
        });

        // 删除用户
        await this.prisma.users.delete({
          where: { id: userId },
        });

        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(`ID: ${studentId} 删除失败 - ${error.message}`);
      }
    }

    return {
      code: 0,
      message: `删除完成：成功 ${results.success} 个，失败 ${results.failed} 个`,
      data: results,
      trace_id: req.trace_id,
    };
  }

  // 解绑微信
  @Post(':id/unbind-wechat')
  @Permissions('student:update')
  @DataScope({ entity: 'student', field: 'student_id' })
  async unbindWechat(@Param('id') id: string, @Req() req: any) {
    await this.prisma.ensureConnected();
    
    const student = await this.prisma.student_profiles.findUnique({
      where: { id: BigInt(id) },
    });

    if (!student) {
      return {
        code: 404,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }

    await Promise.all([
      this.prisma.student_profiles.update({
        where: { id: BigInt(id) },
        data: {
          wx_openid: null,
        },
      }),
      this.prisma.users.update({
        where: { id: student.user_id },
        data: {
          wx_openid: null,
        },
      }),
    ]);

    return {
      code: 0,
      message: '微信解绑成功',
      data: null,
      trace_id: req.trace_id,
    };
  }

  // 获取班级列表，用于下拉选择
  @Get('classes/list')
  @Permissions('class:read')
  @DataScope({ entity: 'class', field: 'class_id' })
  async listClasses(@Query('org_id') orgId: string, @Req() req: any) {
    await this.prisma.ensureConnected();

    const andConditions: any[] = [{ status: 'active' }];
    if (orgId) {
      andConditions.push({ org_id: BigInt(orgId) });
    }

    const dataScope = req?.dataScope;
    if (dataScope && dataScope.type !== 'all') {
      if (dataScope.type === 'class' && dataScope.classIds?.length) {
        andConditions.push({ id: { in: dataScope.classIds.map((id: bigint) => id) } });
      } else if (dataScope.type === 'college' && dataScope.collegeIds?.length) {
        andConditions.push({ org_id: { in: dataScope.collegeIds.map((id: bigint) => id) } });
      } else if (dataScope.type === 'self' && dataScope.studentIds?.length) {
        const students = await this.prisma.student_profiles.findMany({
          where: { id: { in: dataScope.studentIds.map((id: bigint) => id) } },
          select: { class_id: true },
        });
        const classIds = Array.from(new Set(students.map((item: any) => item.class_id.toString()))).map((id) =>
          BigInt(id),
        );
        andConditions.push({ id: { in: classIds } });
      }
    }

    const where = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

    const classes = await this.prisma.classes.findMany({
      where,
      orderBy: { class_name: 'asc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: classes.map((c: any) => ({
        id: c.id.toString(),
        class_name: c.class_name,
        enroll_year: c.enroll_year,
        org_id: c.org_id.toString(),
        major: c.major,
      })),
      trace_id: req.trace_id,
    };
  }

  // 批量导入学生
  @Post('import')
  @Permissions('student:import')
  async importStudents(@Body() dto: { students: any[] }, @Req() req: any) {
    await this.prisma.ensureConnected();

    // 获取系统配置
    const settings = await this.prisma.system_settings.findUnique({
      where: { setting_key: 'account' },
    });
    let accountConfig: any = {};
    if (settings && settings.setting_val) {
      try {
        accountConfig = JSON.parse(settings.setting_val);
      } catch {}
    }
    const useDefault = accountConfig.enableDefaultPassword === true;
    const defaultPwd = String(accountConfig.defaultPassword || '').trim();
    
    const students = dto.students;
    const results: {
      success: number;
      failed: number;
      errors: string[];
      students: Array<{ student_no: string; name: string; password: string }>;
    } = {
      success: 0,
      failed: 0,
      errors: [],
      students: [],
    };
    if (useDefault && defaultPwd && isWeakPassword(defaultPwd)) {
      return {
        code: 400,
        message: '操作失败',
        data: null,
        trace_id: req.trace_id,
      };
    }
    const importedMobiles = new Set<string>();

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      try {
        // 查找班级
        const classInfo = await this.prisma.classes.findFirst({
          where: { class_name: student.class_name }
        });

        if (!classInfo) {
          results.failed++;
          results.errors.push(`第${i + 1}行：班级 ${student.class_name} 不存在`);
          continue;
        }

        // 检查学号和姓名是否已存在，两者都相同才视为重复
        const existing = await this.prisma.student_profiles.findFirst({
          where: {
            student_no: student.student_no,
            users: {
              name: student.name
            }
          },
          include: {
            users: true
          }
        });

        if (existing) {
          results.failed++;
          results.errors.push(`第${i + 1}行：学生 ${student.name}（学号：${student.student_no}）已存在`);
          continue;
        }

        // 创建用户
        const normalizedMobile = normalizeMobile(student.mobile);
        if (normalizedMobile && !isValidMainlandMobile(normalizedMobile)) {
          results.failed++;
          results.errors.push(`第${i + 1}行：手机号格式不正确`);
          continue;
        }
        if (normalizedMobile) {
          if (importedMobiles.has(normalizedMobile)) {
            results.failed++;
            results.errors.push(`第${i + 1}行：手机号重复`);
            continue;
          }
          if (await this.isMobileInUse(normalizedMobile)) {
            results.failed++;
            results.errors.push(`第${i + 1}行：手机号已被其他账号使用`);
            continue;
          }
        }

        let passwordToUse;
        if (useDefault) {
          passwordToUse =
            defaultPwd || this.generateConfiguredStudentPassword(accountConfig);
        } else {
          const candidatePassword = String(student.password || '').trim();
          if (candidatePassword) {
            if (isWeakPassword(candidatePassword)) {
              results.failed++;
              results.errors.push(`第${i + 1}行：初始密码过于简单`);
              continue;
            }
            passwordToUse = candidatePassword;
          } else {
            passwordToUse = this.generateConfiguredStudentPassword(accountConfig);
          }
        }
        const passwordHash = await bcrypt.hash(passwordToUse, 10);
        
        const user = await this.prisma.users.create({
          data: {
            name: student.name,
            user_type: 'student',
            status: 'active',
            org_id: classInfo.org_id,
            mobile: normalizedMobile,
            password_hash: passwordHash,
          }
        });

        // 创建学生档案
        await this.prisma.student_profiles.create({
          data: {
            user_id: user.id,
            student_no: student.student_no,
            initial_password: passwordToUse,
            gender: student.gender,
            class_id: classInfo.id,
            org_id: classInfo.org_id,
            major: classInfo.major,
            major_id: classInfo.major_id,
            enroll_year: classInfo.enroll_year,
            mobile: normalizedMobile,
            email: student.email,
            emergency_contact_name: student.emergency_contact_name,
            emergency_contact_mobile: student.emergency_contact_mobile,
            student_position: student.student_position || '学生',
            status: 'active',
          }
        });

        // 添加学生角色
        await this.prisma.user_roles.create({
          data: {
            user_id: user.id,
            role: 'student',
            scope_type: 'class',
            scope_id: classInfo.id
          }
        });

        await this.syncStudentMonitorRole(
          user.id,
          classInfo.id,
          student.student_position || null,
        );

        results.success++;
        results.students.push({
          student_no: student.student_no,
          name: student.name,
          password: passwordToUse,
        });
        if (normalizedMobile) {
          importedMobiles.add(normalizedMobile);
        }
      } catch (error: any) {
        results.failed++;
        results.errors.push(`第${i + 1}行：导入失败 - ${error.message}`);
      }
    }

    return {
      code: 0,
      message: '导入完成',
      data: results,
      trace_id: req.trace_id
    };
  }

  // 批量创建学生，使用 SSE 推送进度
  @Post('batch-create')
  @Permissions('student:create')
  async batchCreateStudents(@Body() dto: {
    class_id: string;
    count: number;
    password_type: string;
    password_length: number;
    name_prefix?: string;
    enroll_year?: number;
  }, @Req() req: any, @Res() res: Response) {
    await this.prisma.ensureConnected();

    const { class_id, count, password_type, password_length, name_prefix, enroll_year } = dto;

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendProgress = (progress: number, message: string, data?: any) => {
      res.write(`data: ${JSON.stringify({ progress, message, data })}\n\n`);
    };

    const sendDone = (results: any) => {
      res.write(`data: ${JSON.stringify({ progress: 100, message: '完成', data: results })}\n\n`);
      res.end();
    };

    const sendError = (error: string) => {
      res.write(`data: ${JSON.stringify({ progress: -1, message: error })}\n\n`);
      res.end();
    };

    const classInfo = await this.prisma.classes.findUnique({
      where: { id: BigInt(class_id) },
    });

    if (!classInfo) {
      sendError('班级不存在');
      return;
    }

    const currentYear = new Date().getFullYear();
    const enrollYear = Number(enroll_year) || classInfo.enroll_year || currentYear;
    const orgIdStr = classInfo.org_id.toString().padStart(3, '0');
    const classIdStr = classInfo.id.toString().padStart(3, '0');

    const existingCount = await this.prisma.student_profiles.count({
      where: { class_id: BigInt(class_id) },
    });

    const results: {
      success: number;
      failed: number;
      students: Array<{ student_no: string; name: string; password: string }>;
      errors: string[];
    } = {
      success: 0,
      failed: 0,
      students: [],
      errors: [],
    };

    const settings = await this.prisma.system_settings.findUnique({
      where: { setting_key: 'account' },
    });
    let accountConfig: any = {};
    if (settings && settings.setting_val) {
      try {
        accountConfig = JSON.parse(settings.setting_val);
      } catch {}
    }
    const useDefault = accountConfig.enableDefaultPassword === true;
    const defaultPwd = String(accountConfig.defaultPassword || '').trim();
    if (useDefault && defaultPwd && isWeakPassword(defaultPwd)) {
      sendError('默认密码配置过于简单，请先在系统配置中设置强密码');
      return;
    }

    for (let i = 0; i < count; i += 1) {
      try {
        const studentIndex = existingCount + i + 1;
        const studentNo = `${currentYear}${orgIdStr}${classIdStr}${studentIndex.toString().padStart(2, '0')}`;
        const name = name_prefix ? `${name_prefix}${studentIndex}` : `学生${studentIndex}`;

        let password = '';
        if (useDefault) {
          password = defaultPwd || this.generateConfiguredStudentPassword(accountConfig);
        } else {
          password = this.generatePasswordByRules(password_type, password_length);
          if (isWeakPassword(password)) {
            password = generateStrongPassword(Math.max(10, Number(password_length) || 10));
          }
        }

        const existing = await this.prisma.student_profiles.findUnique({
          where: { student_no: studentNo },
        });
        if (existing) {
          results.failed += 1;
          results.errors.push(`第${i + 1}个：学号 ${studentNo} 已存在`);
        } else {
          const user = await this.prisma.users.create({
            data: {
              name,
              user_type: 'student',
              status: 'active',
              org_id: classInfo.org_id,
              password_hash: await bcrypt.hash(password, 10),
            },
          });

          await this.prisma.student_profiles.create({
            data: {
              user_id: user.id,
              student_no: studentNo,
              initial_password: password,
              gender: 'male',
              class_id: BigInt(class_id),
              org_id: classInfo.org_id,
              major: classInfo.major,
              major_id: classInfo.major_id,
              enroll_year: enrollYear,
              status: 'active',
            },
          });

          await this.prisma.user_roles.create({
            data: {
              user_id: user.id,
              role: 'student',
              scope_type: 'class',
              scope_id: BigInt(class_id),
            },
          });

          await this.syncStudentMonitorRole(
            user.id,
            BigInt(class_id),
            null,
          );

          results.success += 1;
          results.students.push({ student_no: studentNo, name, password });
        }
      } catch (error: any) {
        results.failed += 1;
        results.errors.push(`第${i + 1}个：创建失败 - ${error.message}`);
      }

      const progress = Math.round(((i + 1) / count) * 100);
      sendProgress(progress, `已创建 ${i + 1}/${count}`, { current: i + 1, total: count });
    }

    sendDone(results);
    return;
  }

  private async checkStudentDataScope(student: any, dataScope: any): Promise<boolean> {
    if (!dataScope || dataScope.type === 'all') {
      return true;
    }

    if (dataScope.type === 'self' && dataScope.studentIds) {
      return dataScope.studentIds.some((id: bigint) => id.toString() === student.id.toString());
    }

    if (dataScope.type === 'class' && dataScope.classIds) {
      return dataScope.classIds.some((id: bigint) => id.toString() === student.class_id.toString());
    }

    if (dataScope.type === 'college' && dataScope.collegeIds) {
      const classInfo = await this.prisma.classes.findUnique({
        where: { id: student.class_id },
        select: { org_id: true },
      });
      if (classInfo) {
        return dataScope.collegeIds.some(
          (id: bigint) => id.toString() === classInfo.org_id.toString(),
        );
      }
    }

    return false;
  }
}



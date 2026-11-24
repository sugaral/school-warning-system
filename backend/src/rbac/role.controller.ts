import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../shared/auth.guard';
import { PrismaService } from '../shared/prisma.service';
import {
  loadRoleCatalog,
  normalizeRoleCode,
  saveRoleCatalog,
} from '../shared/role-catalog';
import { PermissionGuard } from './permission.guard';
import { Permissions } from './permission.decorator';
import { PermissionService } from './permission.service';

class AssignRoleDto {
  user_id!: string;
  role!: string;
  scope_type?: string;
  scope_id?: string;
  org_id?: string;
  class_id?: string;
}

class UpdateUserRoleDto {
  scope_id?: string;
}

class AssignPermissionDto {
  permission_id!: string;
}

class UpdateRoleDto {
  name!: string;
  description!: string;
}

@Controller('admin/roles')
@UseGuards(AuthGuard, PermissionGuard)
export class RoleController {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly prisma: PrismaService,
  ) {}

  private toRoleResponse(role: any) {
    return {
      code: role.code,
      name: role.name,
      description: role.description,
      default_scope: role.default_scope,
      user_type: role.user_type,
      register_scope: role.register_scope,
      registerable: role.registerable !== false,
    };
  }

  private async ensureTeacherCompanionRole(userId: bigint) {
    const existingTeacherRole = await this.prisma.user_roles.findFirst({
      where: {
        user_id: userId,
        role: 'teacher',
      },
      select: { id: true },
    });

    if (existingTeacherRole) {
      return;
    }

    await this.prisma.user_roles.create({
      data: {
        user_id: userId,
        role: 'teacher',
        scope_type: 'self',
        scope_id: null,
      },
    });
  }

  @Get()
  @Permissions('role:manage')
  async getAllRoles() {
    const roles = await loadRoleCatalog(this.prisma);

    return {
      code: 0,
      message: 'ok',
      data: roles.map((role: any) => this.toRoleResponse(role)),
    };
  }

  @Put(':code')
  @Permissions('role:manage')
  async updateRole(
    @Param('code') code: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const normalizedCode = normalizeRoleCode(code);
    const roles = await loadRoleCatalog(this.prisma);
    const roleIndex = roles.findIndex((item: any) => item.code === normalizedCode);
    if (roleIndex === -1) {
      return {
        code: 404,
        message: 'Role not found',
        data: null,
      };
    }

    roles[roleIndex] = {
      ...roles[roleIndex],
      name: dto.name,
      description: dto.description,
    };
    const savedRoles = await saveRoleCatalog(this.prisma, roles);
    const updatedRole = savedRoles.find((item: any) => item.code === normalizedCode);

    return {
      code: 0,
      message: 'Role updated successfully',
      data: {
        code: updatedRole?.code || normalizedCode,
        name: updatedRole?.name || roles[roleIndex].name,
        description: updatedRole?.description || roles[roleIndex].description,
        default_scope: updatedRole?.default_scope,
      },
    };
  }

  @Delete(':code')
  @Permissions('role:manage')
  async deleteRole(@Param('code') code: string) {
    const normalizedCode = normalizeRoleCode(code);
    if (normalizedCode === 'sys_admin') {
      return {
        code: 400,
        message: 'The system administrator role cannot be removed',
        data: null,
      };
    }

    const roles = await loadRoleCatalog(this.prisma);
    const roleIndex = roles.findIndex((item: any) => item.code === normalizedCode);
    if (roleIndex === -1) {
      return {
        code: 404,
        message: 'Role not found',
        data: null,
      };
    }

    roles.splice(roleIndex, 1);
    await saveRoleCatalog(this.prisma, roles);

    return {
      code: 0,
      message: 'Role deleted successfully',
      data: null,
    };
  }

  @Get(':role/permissions')
  @Permissions('role:manage')
  async getRolePermissions(@Param('role') role: string) {
    const rolePermissions = await this.permissionService.getRolePermissions(role);
    return {
      code: 0,
      message: 'ok',
      data: rolePermissions.map((item: any) => ({
        id: item.permission.id.toString(),
        code: item.permission.code,
        name: item.permission.name,
        resource: item.permission.resource,
        action: item.permission.action,
      })),
    };
  }

  @Post(':role/permissions')
  @Permissions('role:manage')
  async assignPermissionToRole(
    @Param('role') role: string,
    @Body() dto: AssignPermissionDto,
  ) {
    await this.permissionService.assignPermissionToRole(
      role,
      BigInt(dto.permission_id),
    );
    return {
      code: 0,
      message: 'Permission assigned successfully',
      data: null,
    };
  }

  @Delete(':role/permissions/:permissionId')
  @Permissions('role:manage')
  async removePermissionFromRole(
    @Param('role') role: string,
    @Param('permissionId') permissionId: string,
  ) {
    await this.permissionService.removePermissionFromRole(
      role,
      BigInt(permissionId),
    );
    return {
      code: 0,
      message: 'Permission removed successfully',
      data: null,
    };
  }

  @Post('assign')
  @Permissions('role:manage')
  async assignRoleToUser(@Body() dto: AssignRoleDto) {
    const normalizedRole = normalizeRoleCode(dto.role);
    const roles = await loadRoleCatalog(this.prisma);
    const roleConfig = roles.find((item: any) => item.code === normalizedRole);
    if (!roleConfig) {
      return {
        code: 4001,
        message: 'Role not found',
        data: null,
      };
    }

    const scopeType = dto.scope_type || roleConfig.default_scope || 'self';
    let actualScopeId = dto.scope_id;

    if (normalizedRole === 'head_teacher' && dto.class_id) {
      actualScopeId = dto.class_id;
    }
    if (normalizedRole === 'student_admin' && dto.org_id) {
      actualScopeId = dto.org_id;
    }

    const existing = await this.prisma.user_roles.findFirst({
      where: {
        user_id: BigInt(dto.user_id),
        role: normalizedRole,
        scope_type: scopeType,
        scope_id: actualScopeId ? BigInt(actualScopeId) : null,
      },
    });
    if (existing) {
      return {
        code: 400,
        message: 'The user already has this role assignment',
        data: null,
      };
    }

    if (normalizedRole === 'head_teacher') {
      if (!actualScopeId) {
        return {
          code: 4001,
          message: 'Head teacher must bind a class',
          data: null,
        };
      }

      const classInfo = await this.prisma.classes.findUnique({
        where: { id: BigInt(actualScopeId) },
      });
      if (!classInfo) {
        return {
          code: 4002,
          message: 'Class not found',
          data: null,
        };
      }

      const existingRoleForUser = await this.prisma.user_roles.findFirst({
        where: {
          user_id: BigInt(dto.user_id),
          role: normalizedRole,
          scope_id: BigInt(actualScopeId),
        },
        orderBy: { created_at: 'asc' },
      });

      if (existingRoleForUser) {
        const updatedRole = await this.prisma.user_roles.update({
          where: { id: existingRoleForUser.id },
          data: {
            scope_type: 'class',
            scope_id: BigInt(actualScopeId),
          },
        });

        await this.prisma.classes.update({
          where: { id: BigInt(actualScopeId) },
          data: { counselor_user_id: BigInt(dto.user_id) },
        });

        await this.prisma.users.update({
          where: { id: BigInt(dto.user_id) },
          data: {
            org_id: classInfo.org_id,
            ...(roleConfig.user_type ? { user_type: roleConfig.user_type } : {}),
          },
        });

        await this.ensureTeacherCompanionRole(BigInt(dto.user_id));

        return {
          code: 0,
          message: 'Role assigned successfully',
          data: {
            id: updatedRole.id.toString(),
            user_id: updatedRole.user_id.toString(),
            role: normalizeRoleCode(updatedRole.role),
            scope_type: updatedRole.scope_type,
            scope_id: updatedRole.scope_id?.toString(),
          },
        };
      }
    }

    const userRole = await this.prisma.user_roles.create({
      data: {
        user_id: BigInt(dto.user_id),
        role: normalizedRole,
        scope_type: scopeType,
        scope_id: actualScopeId ? BigInt(actualScopeId) : null,
      },
    });

    const userUpdateData: Record<string, any> = {};
    if (roleConfig.user_type) {
      userUpdateData.user_type = roleConfig.user_type;
    }

    if (normalizedRole === 'head_teacher' && actualScopeId) {
      const classInfo = await this.prisma.classes.findUnique({
        where: { id: BigInt(actualScopeId) },
        select: { org_id: true },
      });
      await this.prisma.classes.update({
        where: { id: BigInt(actualScopeId) },
        data: { counselor_user_id: BigInt(dto.user_id) },
      });
      if (classInfo?.org_id || dto.org_id) {
        userUpdateData.org_id = classInfo?.org_id || BigInt(dto.org_id!);
      }
    }

    if (
      ['student_admin', 'vice_dean'].includes(normalizedRole)
      && (dto.org_id || (scopeType === 'org' && actualScopeId))
    ) {
      userUpdateData.org_id = BigInt(dto.org_id || actualScopeId!);
    }

    if (Object.keys(userUpdateData).length > 0) {
      await this.prisma.users.update({
        where: { id: BigInt(dto.user_id) },
        data: userUpdateData,
      });
    }

    if (normalizedRole === 'head_teacher') {
      await this.ensureTeacherCompanionRole(BigInt(dto.user_id));
    }

    return {
      code: 0,
      message: 'Role assigned successfully',
      data: {
        id: userRole.id.toString(),
        user_id: userRole.user_id.toString(),
        role: userRole.role,
        scope_type: userRole.scope_type,
        scope_id: userRole.scope_id?.toString(),
      },
    };
  }

  @Delete('assign/:userRoleId')
  @Permissions('role:manage')
  async removeRoleFromUser(@Param('userRoleId') userRoleId: string) {
    const existing = await this.prisma.user_roles.findUnique({
      where: { id: BigInt(userRoleId) },
      select: {
        user_id: true,
        role: true,
        scope_id: true,
      },
    });

    if (existing?.role === 'head_teacher' && existing.scope_id) {
      await this.prisma.classes.updateMany({
        where: {
          id: existing.scope_id,
          counselor_user_id: existing.user_id,
        },
        data: {
          counselor_user_id: null,
        },
      });
    }

    await this.prisma.user_roles.delete({
      where: { id: BigInt(userRoleId) },
    });

    return {
      code: 0,
      message: 'Role removed successfully',
      data: null,
    };
  }

  @Put('assign/:userRoleId')
  @Permissions('role:manage')
  async updateUserRole(
    @Param('userRoleId') userRoleId: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    const existing = await this.prisma.user_roles.findUnique({
      where: { id: BigInt(userRoleId) },
      select: {
        id: true,
        user_id: true,
        role: true,
        scope_type: true,
        scope_id: true,
      },
    });

    if (!existing) {
      return {
        code: 404,
        message: 'Role assignment not found',
        data: null,
      };
    }

    const nextScopeId = dto.scope_id ? BigInt(dto.scope_id) : null;
    const operations: any[] = [
      this.prisma.user_roles.update({
        where: { id: existing.id },
        data: {
          scope_id: nextScopeId,
        },
      }),
    ];

    if (existing.role === 'head_teacher') {
      if (existing.scope_id) {
        operations.push(
          this.prisma.classes.updateMany({
            where: {
              id: existing.scope_id,
              counselor_user_id: existing.user_id,
            },
            data: { counselor_user_id: null },
          }),
        );
      }

      if (nextScopeId) {
        const classInfo = await this.prisma.classes.findUnique({
          where: { id: nextScopeId },
          select: { id: true, org_id: true },
        });
        if (!classInfo) {
          return {
            code: 404,
            message: 'Class not found',
            data: null,
          };
        }

        operations.push(
          this.prisma.classes.update({
            where: { id: nextScopeId },
            data: { counselor_user_id: existing.user_id },
          }),
          this.prisma.users.update({
            where: { id: existing.user_id },
            data: { org_id: classInfo.org_id },
          }),
        );
      }
    }

    if (['student_admin', 'vice_dean'].includes(existing.role)) {
      operations.push(
        this.prisma.users.update({
          where: { id: existing.user_id },
          data: { org_id: nextScopeId },
        }),
      );
    }

    const [userRole] = await this.prisma.$transaction(operations);

    return {
      code: 0,
      message: 'Role assignment updated successfully',
      data: {
        id: userRole.id.toString(),
        user_id: userRole.user_id.toString(),
        role: normalizeRoleCode(userRole.role),
        scope_type: userRole.scope_type,
        scope_id: userRole.scope_id?.toString(),
      },
    };
  }

  @Get('user/:userId')
  @Permissions('role:manage')
  async getUserRoles(@Param('userId') userId: string) {
    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: BigInt(userId) },
      orderBy: { created_at: 'asc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: roles.map((item: any) => ({
        id: item.id.toString(),
        role: normalizeRoleCode(item.role),
        scope_type: item.scope_type,
        scope_id: item.scope_id?.toString(),
        created_at: item.created_at,
      })),
    };
  }

  @Get('my')
  async getMyRoles(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) {
      return { code: 401, message: 'Unauthorized', data: null };
    }

    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: BigInt(userId) },
      orderBy: { created_at: 'asc' },
    });

    return {
      code: 0,
      message: 'ok',
      data: roles.map((item: any) => ({
        id: item.id.toString(),
        role: normalizeRoleCode(item.role),
        scope_type: item.scope_type,
        scope_id: item.scope_id?.toString(),
      })),
    };
  }
}


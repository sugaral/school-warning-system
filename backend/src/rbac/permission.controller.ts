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
import { PermissionService } from './permission.service';
import { PrismaService } from '../shared/prisma.service';
import { loadRoleCatalog } from '../shared/role-catalog';
import { AuthGuard } from '../shared/auth.guard';
import { Permissions } from './permission.decorator';
import { PermissionGuard } from './permission.guard';

class CreatePermissionDto {
  code!: string;
  name!: string;
  description?: string;
  resource!: string;
  action!: string;
}

class UpdatePermissionDto {
  name?: string;
  description?: string;
  resource?: string;
  action?: string;
}

@Controller('admin/permissions')
@UseGuards(AuthGuard, PermissionGuard)
export class PermissionController {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly prisma: PrismaService,
  ) {}

  // 获取所有权限列表
  @Get()
  @Permissions('permission:manage')
  async getAllPermissions(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
  ) {
    let permissions = await this.permissionService.getAllPermissions();

    // 获取每个权限关联的角色数
    const permissionIds = permissions.map(p => p.id);
    const rolePermissions = await this.prisma.role_permissions.findMany({
      where: { permission_id: { in: permissionIds } },
    });

    const roleCountMap = new Map<bigint, number>();
    rolePermissions.forEach(rp => {
      roleCountMap.set(rp.permission_id, (roleCountMap.get(rp.permission_id) || 0) + 1);
    });

    // 应用筛选
    if (search) {
      const searchLower = search.toLowerCase();
      permissions = permissions.filter(p => 
        p.name.toLowerCase().includes(searchLower) || 
        p.code.toLowerCase().includes(searchLower)
      );
    }

    if (resource) {
      permissions = permissions.filter(p => p.resource === resource);
    }

    if (action) {
      permissions = permissions.filter(p => p.action === action);
    }

    // 分页
    const pageNum = parseInt(page || '1');
    const size = parseInt(pageSize || '10');
    const start = (pageNum - 1) * size;
    const end = start + size;
    const paginatedPermissions = permissions.slice(start, end);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: paginatedPermissions.map((p) => ({
          id: p.id.toString(),
          code: p.code,
          name: p.name,
          description: p.description,
          resource: p.resource,
          action: p.action,
          role_count: roleCountMap.get(p.id) || 0,
          created_at: p.created_at,
        })),
        pagination: {
          total: permissions.length,
          page: pageNum,
          pageSize: size,
        },
      },
    };
  }

  // 获取当前用户的权限
  @Get('my')
  async getMyPermissions(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) {
      return { code: 401, message: '操作失败', data: null };
    }

    const permissions = await this.permissionService.getUserPermissions(BigInt(userId));
    return {
      code: 0,
      message: 'ok',
      data: permissions,
    };
  }

  // 创建权限
  @Post()
  @Permissions('permission:manage')
  async createPermission(@Body() dto: CreatePermissionDto) {
    const permission = await this.permissionService.createPermission(dto);
    return {
      code: 0,
      message: '创建成功',
      data: {
        id: permission.id.toString(),
        code: permission.code,
        name: permission.name,
      },
    };
  }

  // 更新权限
  @Put(':id')
  @Permissions('permission:manage')
  async updatePermission(
    @Param('id') id: string,
    @Body() dto: UpdatePermissionDto,
  ) {
    const permission = await this.permissionService.updatePermission(BigInt(id), dto);
    return {
      code: 0,
      message: '更新成功',
      data: {
        id: permission.id.toString(),
        code: permission.code,
        name: permission.name,
      },
    };
  }

  // 获取权限关联的角色
  @Get(':id/roles')
  @Permissions('permission:manage')
  async getPermissionRoles(@Param('id') id: string) {
    const rolePermissions = await this.prisma.role_permissions.findMany({
      where: { permission_id: BigInt(id) },
    });

    const PREDEFINED_ROLES = [
      { code: 'student', name: '学生' },
      { code: 'head_teacher', name: '班主任' },
      { code: 'student_admin', name: '学工管理员' },
      { code: 'teaching_admin', name: '教务管理员' },
      { code: 'vice_dean', name: '教学副院长' },
      { code: 'sys_admin', name: '系统管理员' },
    ];

    const roleCatalog = await loadRoleCatalog(this.prisma);
    const roleMap = new Map(roleCatalog.map((r: any) => [r.code, r]));

    return {
      code: 0,
      message: 'ok',
      data: rolePermissions.map(rp => {
        const role = roleMap.get(rp.role);
        return {
          id: rp.role,
          role: rp.role,
          name: role?.name || rp.role,
        };
      }),
    };
  }

  // 删除权限
  @Delete(':id')
  @Permissions('permission:manage')
  async deletePermission(@Param('id') id: string) {
    await this.permissionService.deletePermission(BigInt(id));
    return {
      code: 0,
      message: '删除成功',
      data: null,
    };
  }

  // 按资源分组获取权限
  @Get('by-resource')
  @Permissions('permission:manage')
  async getPermissionsByResource() {
    const permissions = await this.permissionService.getAllPermissions();
    
    // 按资源分组
    const grouped = permissions.reduce((acc, p) => {
      if (!acc[p.resource]) {
        acc[p.resource] = [];
      }
      acc[p.resource].push({
        id: p.id.toString(),
        code: p.code,
        name: p.name,
        action: p.action,
      });
      return acc;
    }, {} as Record<string, any[]>);

    return {
      code: 0,
      message: 'ok',
      data: grouped,
    };
  }
}


import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
const L1_CACHE_TTL_MS = 30_000;

const CLASS_MONITOR_TITLE_PERMISSION = {
  code: 'role:manage_monitor_titles',
  name: '管理班干名称',
  description: '配置班干职位名称选项',
  resource: 'role',
  action: 'manage_monitor_titles',
} as const;

const CLASS_MONITOR_TITLE_PERMISSION_ROLES = ['sys_admin'] as const;


@Injectable()
export class PermissionService implements OnModuleInit {
  private readonly logger = new Logger(PermissionService.name);
  private builtInPermissionsReady = false;
  private builtInPermissionsPromise: Promise<void> | null = null;
  private readonly permissionsL1Cache = new Map<string, { value: string[]; expiresAt: number }>();
  private readonly rolesL1Cache = new Map<string, { value: any[]; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    try {
      await this.ensureBuiltInRolePermissions();
    } catch (error: any) {
      this.logger.error(
        `[permission] failed to initialize built-in permissions: ${error?.message || String(error)}`,
        error?.stack,
      );
    }
  }

  private async ensureBuiltInRolePermissions() {
    if (this.builtInPermissionsReady) {
      return;
    }

    if (this.builtInPermissionsPromise) {
      return this.builtInPermissionsPromise;
    }

    this.builtInPermissionsPromise = (async () => {
    const permission = await this.prisma.permissions.upsert({
      where: { code: CLASS_MONITOR_TITLE_PERMISSION.code },
      update: {
        name: CLASS_MONITOR_TITLE_PERMISSION.name,
        description: CLASS_MONITOR_TITLE_PERMISSION.description,
        resource: CLASS_MONITOR_TITLE_PERMISSION.resource,
        action: CLASS_MONITOR_TITLE_PERMISSION.action,
        updated_at: new Date(),
      },
      create: {
        code: CLASS_MONITOR_TITLE_PERMISSION.code,
        name: CLASS_MONITOR_TITLE_PERMISSION.name,
        description: CLASS_MONITOR_TITLE_PERMISSION.description,
        resource: CLASS_MONITOR_TITLE_PERMISSION.resource,
        action: CLASS_MONITOR_TITLE_PERMISSION.action,
      },
    });

    for (const role of CLASS_MONITOR_TITLE_PERMISSION_ROLES) {
      const existing = await this.prisma.role_permissions.findFirst({
        where: {
          role,
          permission_id: permission.id,
        },
        select: { permission_id: true },
      });

      if (!existing) {
        await this.prisma.role_permissions.create({
          data: {
            role,
            permission_id: permission.id,
          },
        });
      }
    }

    await this.prisma.role_permissions.deleteMany({
      where: {
        permission_id: permission.id,
        role: {
          notIn: [...CLASS_MONITOR_TITLE_PERMISSION_ROLES],
        },
      },
    });
      this.builtInPermissionsReady = true;
    })();

    try {
      await this.builtInPermissionsPromise;
    } finally {
      this.builtInPermissionsPromise = null;
    }
  }

  private maskUserId(userId: bigint) {
    const raw = userId.toString();
    if (raw.length <= 4) {
      return `***${raw}`;
    }
    return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  }

  private dedupePermissions(values: Array<string | null | undefined>) {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
  }

  private getL1CacheValue<T>(
    cache: Map<string, { value: T; expiresAt: number }>,
    key: string,
  ): T | null {
    const cached = cache.get(key);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }

    return cached.value;
  }

  private setL1CacheValue<T>(
    cache: Map<string, { value: T; expiresAt: number }>,
    key: string,
    value: T,
  ): T {
    cache.set(key, {
      value,
      expiresAt: Date.now() + L1_CACHE_TTL_MS,
    });
    return value;
  }

  async getUserPermissions(userId: bigint): Promise<string[]> {
    const cacheKey = `user:permissions:${userId.toString()}`;
    const l1Cached = this.getL1CacheValue(this.permissionsL1Cache, cacheKey);
    if (Array.isArray(l1Cached)) {
      return l1Cached;
    }

    await this.ensureBuiltInRolePermissions();

    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { role: true },
    });

    if (userRoles.length === 0) {
      this.logger.debug(`用户 ${this.maskUserId(userId)} 未分配任何角色`);
      return this.setL1CacheValue(this.permissionsL1Cache, cacheKey, []);
    }

    const roles = userRoles.map((item: any) => item.role);

    if (roles.includes('sys_admin')) {
      const allPermissions = await this.prisma.permissions.findMany({
        select: { code: true },
      });
      const permissionCodes = this.dedupePermissions(
        allPermissions.map((item: any) => item.code),
      );
      this.logger.debug(
        `已解析用户 ${this.maskUserId(userId)} 的权限：角色 ${roles.length} 个，权限 ${permissionCodes.length} 个`,
      );
      const cachedPermissions = this.setL1CacheValue(
        this.permissionsL1Cache,
        cacheKey,
        permissionCodes,
      );
      return cachedPermissions;
    }

    const rolePermissions = await this.prisma.role_permissions.findMany({
      where: {
        role: {
          in: roles,
        },
      },
      select: {
        permission: {
          select: {
            code: true,
          },
        },
      },
    });

    const permissionCodes = this.dedupePermissions(
      rolePermissions.map((item: any) => item.permission?.code),
    );

    this.logger.debug(
      `已解析用户 ${this.maskUserId(userId)} 的权限：角色 ${roles.length} 个，权限 ${permissionCodes.length} 个`,
    );

    const cachedPermissions = this.setL1CacheValue(
      this.permissionsL1Cache,
      cacheKey,
      permissionCodes,
    );
    return cachedPermissions;
  }

  async hasPermission(userId: bigint, permissionCode: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permissionCode);
  }

  async hasAnyPermission(userId: bigint, permissionCodes: string[]): Promise<boolean> {
    if (!permissionCodes || permissionCodes.length === 0) {
      this.logger.warn(
        `权限校验失败（任一权限通过）：用户 ${this.maskUserId(userId)}，传入了空权限列表，已按拒绝处理`,
      );
      return false;
    }

    const permissions = await this.getUserPermissions(userId);
    const result = permissionCodes.some((code: string) => permissions.includes(code));
    if (!result) {
      this.logger.warn(
        `权限校验失败（任一权限通过）：用户 ${this.maskUserId(userId)}，要求 ${permissionCodes.length} 个，已拥有 ${permissions.length} 个`,
      );
    }
    return result;
  }

  async hasAllPermissions(userId: bigint, permissionCodes: string[]): Promise<boolean> {
    if (!permissionCodes || permissionCodes.length === 0) {
      this.logger.warn(
        `权限校验失败（全部权限通过）：用户 ${this.maskUserId(userId)}，传入了空权限列表，已按拒绝处理`,
      );
      return false;
    }

    const permissions = await this.getUserPermissions(userId);
    const result = permissionCodes.every((code: string) => permissions.includes(code));
    if (!result) {
      this.logger.warn(
        `权限校验失败（全部权限通过）：用户 ${this.maskUserId(userId)}，要求 ${permissionCodes.length} 个，已拥有 ${permissions.length} 个`,
      );
    }
    return result;
  }

  async getUserRolesAndScopes(userId: bigint) {
    const cacheKey = `user:roles:${userId.toString()}`;
    const l1Cached = this.getL1CacheValue(this.rolesL1Cache, cacheKey);
    if (Array.isArray(l1Cached)) {
      return l1Cached;
    }

    const roles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
    });

    return this.setL1CacheValue(this.rolesL1Cache, cacheKey, roles);
  }

  /** 用户角色变更后清除缓存（用户管理/角色管理时调用） */
  async invalidateUserRolesCache(userId: bigint) {
    const cacheKey = `user:roles:${userId.toString()}`;
    const permissionsCacheKey = `user:permissions:${userId.toString()}`;
    this.rolesL1Cache.delete(cacheKey);
    this.permissionsL1Cache.delete(permissionsCacheKey);
  }

  async getUserMaxScope(userId: bigint): Promise<{ scopeType: string; scopeId?: bigint }> {
    const roles = await this.getUserRolesAndScopes(userId);

    if (roles.length === 0) {
      return { scopeType: 'self' };
    }

    const scopePriority = ['system', 'school', 'org', 'college', 'class', 'self'];

    for (const scope of scopePriority) {
      const role = roles.find((item: any) => item.scope_type === scope);
      if (role) {
        return {
          scopeType: role.scope_type === 'org' ? 'college' : role.scope_type,
          scopeId: role.scope_id || undefined,
        };
      }
    }

    return { scopeType: 'self' };
  }

  async getAllPermissions() {
    await this.ensureBuiltInRolePermissions();

    return this.prisma.permissions.findMany({
      orderBy: { resource: 'asc' },
    });
  }

  async getRolePermissions(role: string) {
    await this.ensureBuiltInRolePermissions();

    return this.prisma.role_permissions.findMany({
      where: { role },
      include: {
        permission: true,
      },
    });
  }

  async createPermission(data: {
    code: string;
    name: string;
    description?: string;
    resource: string;
    action: string;
  }) {
    return this.prisma.permissions.create({
      data: {
        ...data,
        updated_at: new Date(),
      },
    });
  }

  async updatePermission(
    id: bigint,
    data: Partial<{
      name: string;
      description: string;
      resource: string;
      action: string;
    }>,
  ) {
    return this.prisma.permissions.update({
      where: { id },
      data: {
        ...data,
        updated_at: new Date(),
      },
    });
  }

  async deletePermission(id: bigint) {
    return this.prisma.permissions.delete({
      where: { id },
    });
  }

  async assignPermissionToRole(role: string, permissionId: bigint) {
    return this.prisma.role_permissions.create({
      data: {
        role,
        permission_id: permissionId,
      },
    });
  }

  async removePermissionFromRole(role: string, permissionId: bigint) {
    return this.prisma.role_permissions.deleteMany({
      where: {
        role,
        permission_id: permissionId,
      },
    });
  }
}

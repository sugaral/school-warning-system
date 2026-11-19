import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';
import { PERMISSION_CATALOG, ROLE_PERMISSIONS } from './permission-catalog';
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
      // ============================================================
      // P2-1 修复：运行期补齐「完整权限目录」+「角色-权限映射」
      // ------------------------------------------------------------
      // 原实现只 upsert 了 1 个权限码，导致全新部署（seed + migrate）后
      // permissions 表仅 1 行，sys_admin 的权限集合为空，
      // /admin/users、/admin/classes、/admin/students 等核心后台接口
      // 对 sys_admin 也返回 403。
      //
      // 现在改为幂等地同步 permission-catalog.ts 中的全部权限（60 项）
      // 与 7 个内置角色的映射关系。全部操作为 upsert / insert-only，
      // 不删除任何数据，可安全地在每次启动时执行。
      // ============================================================

      // 1) 同步权限目录（含历史遗漏的 audit:delete / file:download）
      const codeToId = new Map<string, bigint>();
      for (const perm of PERMISSION_CATALOG) {
        const row = await this.prisma.permissions.upsert({
          where: { code: perm.code },
          update: {
            name: perm.name,
            description: perm.description,
            resource: perm.resource,
            action: perm.action,
            updated_at: new Date(),
          },
          create: {
            code: perm.code,
            name: perm.name,
            description: perm.description,
            resource: perm.resource,
            action: perm.action,
          },
          select: { id: true },
        });
        codeToId.set(perm.code, row.id);
      }

      // 2) 同步角色-权限映射（只补不删，保留运维手工追加的授权）
      for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
        const wantedIds = codes
          .map((code) => codeToId.get(code))
          .filter((id): id is bigint => id !== undefined);

        if (wantedIds.length === 0) continue;

        const existing = await this.prisma.role_permissions.findMany({
          where: { role, permission_id: { in: wantedIds } },
          select: { permission_id: true },
        });
        const existingIds = new Set(existing.map((item) => item.permission_id.toString()));
        const missing = wantedIds.filter((id) => !existingIds.has(id.toString()));

        if (missing.length > 0) {
          await this.prisma.role_permissions.createMany({
            data: missing.map((permissionId) => ({ role, permission_id: permissionId })),
          });
        }
      }

      // 3) 保证 role:manage_monitor_titles 仅授予 sys_admin
      //    （沿用原有收敛逻辑，避免该权限被越权分配）
      const monitorTitleId = codeToId.get(CLASS_MONITOR_TITLE_PERMISSION.code);
      if (monitorTitleId !== undefined) {
        await this.prisma.role_permissions.deleteMany({
          where: {
            permission_id: monitorTitleId,
            role: { notIn: [...CLASS_MONITOR_TITLE_PERMISSION_ROLES] },
          },
        });
      }

      this.logger.log(
        `[permission] 权限目录已同步：权限 ${PERMISSION_CATALOG.length} 项，角色映射 ${Object.keys(ROLE_PERMISSIONS).length} 个`,
      );

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

    // ============================================================
    // 用户级自定义权限（覆盖角色默认）
    // ------------------------------------------------------------
    // 语义：只要 user_permissions 里存在该用户的行，就以这份集合作为**最终权限**，
    // 不再叠加角色权限 —— 这样管理端「取消勾选」才真的能生效。
    // 想恢复角色默认：清空该用户的 user_permissions 行（见 resetUserPermissions）。
    // sys_admin 在上面已提前返回全量权限，不受此处影响（避免把自己锁死）。
    // ============================================================
    const customRows = await (this.prisma as any).user_permissions.findMany({
      where: { user_id: userId },
      select: { permission: { select: { code: true } } },
    });

    if (customRows.length > 0) {
      const customCodes = this.dedupePermissions(
        customRows.map((item: any) => item.permission?.code),
      );
      this.logger.debug(
        `已解析用户 ${this.maskUserId(userId)} 的权限：自定义覆盖 ${customCodes.length} 个`,
      );
      return this.setL1CacheValue(this.permissionsL1Cache, cacheKey, customCodes);
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

  // ==========================================================================
  // 用户级权限分配（每个用户单独设置）
  // ==========================================================================

  /** 该用户是否拥有 sys_admin 角色（超管不可被削减权限，避免把自己锁死） */
  private async isSysAdmin(userId: bigint): Promise<boolean> {
    const rows = await this.prisma.user_roles.findMany({
      where: { user_id: userId, role: 'sys_admin' },
      select: { id: true },
      take: 1,
    });
    return rows.length > 0;
  }

  /** 角色默认带来的权限码（不受用户覆盖影响） */
  private async getRolePermissionCodes(userId: bigint): Promise<string[]> {
    const userRoles = await this.prisma.user_roles.findMany({
      where: { user_id: userId },
      select: { role: true },
    });
    const roles = userRoles.map((item: any) => item.role);
    if (roles.length === 0) {
      return [];
    }

    const rows = await this.prisma.role_permissions.findMany({
      where: { role: { in: roles } },
      select: { permission: { select: { code: true } } },
    });

    return this.dedupePermissions(rows.map((item: any) => item.permission?.code));
  }

  /** 用户自定义（覆盖）权限码；为空表示「沿用角色默认」 */
  private async getCustomPermissionCodes(userId: bigint): Promise<string[]> {
    const rows = await (this.prisma as any).user_permissions.findMany({
      where: { user_id: userId },
      select: { permission: { select: { code: true } } },
    });
    return this.dedupePermissions(rows.map((item: any) => item.permission?.code));
  }

  /**
   * 权限分配弹窗所需的完整数据：
   * - mode: role（沿用角色默认）| custom（已被单独覆盖）
   * - role_codes: 角色默认权限码
   * - custom_codes: 自定义集合（mode=role 时为空）
   * - effective_codes: 当前真实生效的权限码（与 PermissionGuard 判定一致）
   * - permissions: 全量权限清单（按 resource 分组用）
   */
  async getUserPermissionDetail(userId: bigint) {
    await this.ensureBuiltInRolePermissions();

    const [roleCodes, customCodes, permissions, sysAdmin] = await Promise.all([
      this.getRolePermissionCodes(userId),
      this.getCustomPermissionCodes(userId),
      this.prisma.permissions.findMany({
        select: { id: true, code: true, name: true, description: true, resource: true, action: true },
        orderBy: [{ resource: 'asc' }, { action: 'asc' }],
      }),
      this.isSysAdmin(userId),
    ]);

    const effectiveCodes = sysAdmin
      ? permissions.map((item: any) => item.code)
      : customCodes.length > 0
        ? customCodes
        : roleCodes;

    return {
      user_id: userId.toString(),
      is_sys_admin: sysAdmin,
      mode: customCodes.length > 0 ? 'custom' : 'role',
      role_codes: roleCodes,
      custom_codes: customCodes,
      effective_codes: effectiveCodes,
      permissions: permissions.map((item: any) => ({
        id: item.id.toString(),
        code: item.code,
        name: item.name,
        description: item.description || '',
        resource: item.resource,
        action: item.action,
      })),
    };
  }

  /**
   * 用给定权限 id 列表**整体覆盖**该用户的自定义权限，并立刻清缓存。
   * 传空数组等价于「该用户没有任何权限」（仍然覆盖角色默认，不是恢复默认）。
   */
  async setUserPermissions(userId: bigint, permissionIds: bigint[], grantedBy?: bigint) {
    if (await this.isSysAdmin(userId)) {
      return {
        ok: false,
        message: '超级管理员拥有全部权限，不支持单独分配',
      };
    }

    const uniqueIds = [
      ...new Set(permissionIds.filter((id) => typeof id === 'bigint' || typeof id === 'number')),
    ].map((id) => BigInt(id));

    // 校验权限 id 是否存在，避免写入脏数据
    if (uniqueIds.length > 0) {
      const exist = await this.prisma.permissions.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      if (exist.length !== uniqueIds.length) {
        return { ok: false, message: '存在无效的权限项，请刷新后重试' };
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await (tx as any).user_permissions.deleteMany({ where: { user_id: userId } });
      if (uniqueIds.length > 0) {
        await (tx as any).user_permissions.createMany({
          data: uniqueIds.map((permissionId) => ({
            user_id: userId,
            permission_id: permissionId,
            granted_by: grantedBy ?? null,
          })),
        });
      }
    });

    // 立刻失效 L1 缓存（30s TTL），保证「点确定即生效」
    await this.invalidateUserRolesCache(userId);

    this.logger.log(
      `[permission] 用户 ${this.maskUserId(userId)} 自定义权限已更新：${uniqueIds.length} 项`,
    );

    return { ok: true, message: 'ok', count: uniqueIds.length };
  }

  /** 恢复角色默认（清空覆盖集合） */
  async resetUserPermissions(userId: bigint) {
    await (this.prisma as any).user_permissions.deleteMany({ where: { user_id: userId } });
    await this.invalidateUserRolesCache(userId);
    this.logger.log(`[permission] 用户 ${this.maskUserId(userId)} 已恢复角色默认权限`);
    return { ok: true, message: 'ok' };
  }
}

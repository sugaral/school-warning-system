import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from '../rbac/permission.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

const ROLE_ALIAS_MAP: Record<string, string> = {
  monitor: 'class_monitor',
  dean: 'teaching_admin',
  admin: 'sys_admin',
};

function normalizeRoleCode(role: string): string {
  return ROLE_ALIAS_MAP[role] || role;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException('未登录或登录已失效');
    }

    // 🔍 性能诊断：记录 RolesGuard 耗时
    const rgStart = Date.now();

    const userRoles = await this.permissionService.getUserRolesAndScopes(BigInt(user.userId));

    const rgDuration = Date.now() - rgStart;
    if (rgDuration > 500) {
      console.warn(`[RolesGuard] ⚠️ 慢查询 ${rgDuration}ms, userId=${user.userId}`);
    }

    const userRoleNames = userRoles.map((ur: { role: string }) => normalizeRoleCode(ur.role));

    const normalizedRequiredRoles = requiredRoles.map((role) => normalizeRoleCode(role));
    const hasRole = normalizedRequiredRoles.some((role) => userRoleNames.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('权限不足');
    }

    request.userRoles = userRoles;
    request.user = {
      ...user,
      roles: userRoleNames,
    };

    return true;
  }
}

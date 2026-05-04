import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permission.decorator';
import { PermissionService } from './permission.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;

    if (!userId) {
      throw new ForbiddenException('未登录或登录已失效');
    }

    // 🔍 性能诊断：记录 PermissionGuard 耗时
    const pgStart = Date.now();

    const hasPermission = await this.permissionService.hasAnyPermission(
      BigInt(userId),
      requiredPermissions,
    );

    // 🔍 性能诊断：输出 PermissionGuard 耗时
    const pgDuration = Date.now() - pgStart;
    if (pgDuration > 500) {
      console.warn(`[PermissionGuard] ⚠️ 慢查询 ${pgDuration}ms, userId=${userId}, permissions=${requiredPermissions.join(',')}`);
    }

    if (!hasPermission) {
      throw new ForbiddenException('权限不足');
    }

    return true;
  }
}

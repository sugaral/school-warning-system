import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  // PermissionService 构造函数只接收 PrismaService 一个依赖。
  // 原测试多传了一个参数（TS2554），导致整个 spec 无法编译 —— 既有缺陷，此处修正。
  const service = new PermissionService({} as any);
  const userId = 1n;

  it('rejects empty permission list for hasAnyPermission', async () => {
    await expect(service.hasAnyPermission(userId, [])).resolves.toBe(false);
  });

  it('rejects empty permission list for hasAllPermissions', async () => {
    await expect(service.hasAllPermissions(userId, [])).resolves.toBe(false);
  });
});

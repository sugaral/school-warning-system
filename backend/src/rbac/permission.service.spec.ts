import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  const service = new PermissionService({} as any, {} as any);
  const userId = 1n;

  it('rejects empty permission list for hasAnyPermission', async () => {
    await expect(service.hasAnyPermission(userId, [])).resolves.toBe(false);
  });

  it('rejects empty permission list for hasAllPermissions', async () => {
    await expect(service.hasAllPermissions(userId, [])).resolves.toBe(false);
  });
});

import { NotificationCenterService } from './notification-center.service';

/**
 * 站内消息中心（复活僵尸表 `notification`）
 *
 * 这些测试锁死的是"这张表真的会被写入且能被读回"，因为原工程里
 * `prisma.notification.create` 全仓库 0 命中 —— 表只被删、从没被写过。
 */
describe('NotificationCenterService', () => {
  const createPrismaMock = () => ({
    notification: {
      create: jest.fn().mockResolvedValue({ id: 1n }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  });

  describe('typeForWarningLevel', () => {
    it('把 4 个级别映射成 warning_{level}', () => {
      expect(NotificationCenterService.typeForWarningLevel('yellow')).toBe('warning_yellow');
      expect(NotificationCenterService.typeForWarningLevel('orange')).toBe('warning_orange');
      expect(NotificationCenterService.typeForWarningLevel('red')).toBe('warning_red');
      expect(NotificationCenterService.typeForWarningLevel('severe')).toBe('warning_severe');
    });

    it('大小写与空白容错', () => {
      expect(NotificationCenterService.typeForWarningLevel('  RED ')).toBe('warning_red');
    });

    it('未知级别降级为 system，不产生非法 type', () => {
      expect(NotificationCenterService.typeForWarningLevel('purple')).toBe('system');
      expect(NotificationCenterService.typeForWarningLevel('')).toBe('system');
      expect(NotificationCenterService.typeForWarningLevel(null as any)).toBe('system');
    });
  });

  describe('createForUser', () => {
    it('写入时 status=unread 且 user_id 转成 bigint', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      const ok = await service.createForUser('42', 'warning_red', '红色预警：缺勤过多');

      expect(ok).toBe(true);
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
      const arg = prisma.notification.create.mock.calls[0][0];
      expect(arg.data.user_id).toBe(42n);
      expect(arg.data.type).toBe('warning_red');
      expect(arg.data.status).toBe('unread');
      expect(arg.data.content).toBe('红色预警：缺勤过多');
    });

    it('userId 为空直接跳过，不写库', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      expect(await service.createForUser(null, 'system', 'x')).toBe(false);
      expect(await service.createForUser(undefined, 'system', 'x')).toBe(false);
      expect(await service.createForUser('', 'system', 'x')).toBe(false);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('内容为空跳过，避免写空消息', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      expect(await service.createForUser(1, 'system', '   ')).toBe(false);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('数据库报错时返回 false 而不抛异常（站内消息是旁路）', async () => {
      const prisma = createPrismaMock();
      prisma.notification.create.mockRejectedValue(new Error('db down'));
      const service = new NotificationCenterService(prisma as any);

      await expect(service.createForUser(1, 'system', 'x')).resolves.toBe(false);
    });

    it('type 超过 32 字符会被截断（列是 VarChar(32)）', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      await service.createForUser(1, 'a'.repeat(50), 'x');
      const arg = prisma.notification.create.mock.calls[0][0];
      expect(arg.data.type.length).toBe(32);
    });

    it('传入事务客户端时使用事务客户端而非 this.prisma', async () => {
      const prisma = createPrismaMock();
      const tx = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      await service.createForUser(1, 'system', 'x', tx);

      expect(tx.notification.create).toHaveBeenCalledTimes(1);
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  describe('createManyForUsers', () => {
    it('去重后一次 createMany', async () => {
      const prisma = createPrismaMock();
      prisma.notification.createMany.mockResolvedValue({ count: 2 });
      const service = new NotificationCenterService(prisma as any);

      const n = await service.createManyForUsers([1, '1', 2, 2, null as any], 'class_notice', '公告');

      expect(n).toBe(2);
      const arg = prisma.notification.createMany.mock.calls[0][0];
      expect(arg.data).toHaveLength(2);
      expect(arg.data.map((d: any) => d.user_id)).toEqual([1n, 2n]);
    });

    it('空列表不发查询', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      expect(await service.createManyForUsers([], 'class_notice', 'x')).toBe(0);
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('createMany 失败时降级逐条写入', async () => {
      const prisma = createPrismaMock();
      prisma.notification.createMany.mockRejectedValue(new Error('bulk failed'));
      const service = new NotificationCenterService(prisma as any);

      const n = await service.createManyForUsers([1, 2], 'class_notice', '公告');

      expect(n).toBe(2);
      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('listForUser', () => {
    it('返回 type_label 且把 bigint id 转成字符串（JSON 可序列化）', async () => {
      const prisma = createPrismaMock();
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 7n,
          type: 'warning_red',
          content: '红色预警',
          status: 'unread',
          created_at: new Date('2026-09-12T00:00:00Z'),
        },
      ]);
      prisma.notification.count.mockResolvedValue(3);
      const service = new NotificationCenterService(prisma as any);

      const result = await service.listForUser(1, { page: 1, pageSize: 20 });

      expect(result.list[0].id).toBe('7');
      expect(result.list[0].type_label).toBe('红色预警');
      expect(result.list[0].is_read).toBe(false);
      expect(result.unread).toBe(3);
    });

    it('status=unread 时下推到 where，避免把已读也捞回来', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      await service.listForUser(1, { status: 'unread' });

      const arg = prisma.notification.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ user_id: 1n, status: 'unread' });
    });

    it('非法 status 忽略而不是报错', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      await service.listForUser(1, { status: 'hacked' });

      const arg = prisma.notification.findMany.mock.calls[0][0];
      expect(arg.where.status).toBeUndefined();
    });

    it('pageSize 上限 100，防止一次拉爆', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      const result = await service.listForUser(1, { page: 1, pageSize: 99999 });

      expect(result.pageSize).toBe(100);
      expect(prisma.notification.findMany.mock.calls[0][0].take).toBe(100);
    });

    it('page < 1 时归一到 1，skip 不为负', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      const result = await service.listForUser(1, { page: -5 });

      expect(result.page).toBe(1);
      expect(prisma.notification.findMany.mock.calls[0][0].skip).toBe(0);
    });
  });

  describe('markRead / markAllRead', () => {
    it('markRead 带上 user_id 条件，防止改到别人的消息', async () => {
      const prisma = createPrismaMock();
      const service = new NotificationCenterService(prisma as any);

      await service.markRead('9', '123');

      const arg = prisma.notification.updateMany.mock.calls[0][0];
      // status: 'unread' 是幂等语义的关键：只有真正发生 unread→read
      // 迁移的那一次才算成功，重复调用返回 false
      expect(arg.where).toEqual({ id: 123n, user_id: 9n, status: 'unread' });
      expect(arg.data.status).toBe('read');
    });

    it('markRead 未命中返回 false', async () => {
      const prisma = createPrismaMock();
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      const service = new NotificationCenterService(prisma as any);

      expect(await service.markRead(9, 123)).toBe(false);
    });

    it('已经是已读的消息再标记返回 false（幂等，不是"重复成功"）', async () => {
      // 并发自测发现的缺陷：where 不带 status 时，Prisma 会把
      // "把 read 再写成 read" 也算作命中，导致并发 10 次全部报成功。
      const prisma = createPrismaMock();
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      const service = new NotificationCenterService(prisma as any);

      expect(await service.markRead(9, 123)).toBe(false);
      const arg = prisma.notification.updateMany.mock.calls[0][0];
      expect(arg.where.status).toBe('unread');
    });

    it('markAllRead 只改当前用户的未读', async () => {
      const prisma = createPrismaMock();
      prisma.notification.updateMany.mockResolvedValue({ count: 5 });
      const service = new NotificationCenterService(prisma as any);

      const n = await service.markAllRead(9);

      expect(n).toBe(5);
      const arg = prisma.notification.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ user_id: 9n, status: 'unread' });
    });
  });

  describe('cleanupOldNotifications', () => {
    it('只删「已读且超期」的消息，绝不删未读', async () => {
      const prisma = createPrismaMock();
      prisma.notification.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
      prisma.notification.deleteMany.mockResolvedValue({ count: 2 });
      const service = new NotificationCenterService(prisma as any);

      await service.cleanupOldNotifications();

      const findArg = prisma.notification.findMany.mock.calls[0][0];
      expect(findArg.where.status).toBe('read');
      expect(findArg.where.created_at.lt).toBeInstanceOf(Date);
      // 未读不在筛选条件里 —— 学生没看到就删等于没通知
      expect(findArg.where.status).not.toBe('unread');
    });

    it('没有超期消息时不执行删除', async () => {
      const prisma = createPrismaMock();
      prisma.notification.findMany.mockResolvedValue([]);
      const service = new NotificationCenterService(prisma as any);

      await service.cleanupOldNotifications();

      expect(prisma.notification.deleteMany).not.toHaveBeenCalled();
    });
  });
});

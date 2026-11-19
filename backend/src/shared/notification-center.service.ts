import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../shared/prisma.service';

/**
 * 站内消息中心（复活僵尸表 `notification`）
 *
 * ─────────────────────────────────────────────────────────────
 * 背景：`notification` 表在原工程里是**纯僵尸表** ——
 *   全仓库搜索 `prisma.notification.create` 命中 0 次，
 *   唯一一处引用是 users.controller.ts:334 注销用户时的
 *   `notification.deleteMany()`。也就是说这张表只会被删、从没被写过，
 *   而前端 `pages/student/MyNotifications.vue` 却调用
 *   `GET /student/notifications` —— 该路由实际读的是 `class_notifications`
 *   （班级公告），与这张表无关。
 *
 * 结果：学生端没有任何"针对我个人的"站内消息能力，
 *   预警触达只能靠 email / sms / wechat 这些**外部渠道**。
 *   一旦外部渠道未配置（本项目的默认状态），学生就完全收不到提醒。
 *
 * 本服务把这张表变成真正的站内消息中心：
 *   - 预警生成时写入一条（type = warning_{level}），与外部渠道解耦；
 *   - 班级公告发布时给全班学生各写一条（type = class_notice）；
 *   - 提供未读数、列表、单条已读、全部已读；
 *   - 定时清理历史消息，避免无限增长。
 *
 * 设计取舍：站内消息是**尽力而为**的旁路，失败绝不影响主流程
 *   （预警写入、公告发布），因此 create* 方法内部吞掉异常并只记日志。
 * ─────────────────────────────────────────────────────────────
 */

/** 消息类型 → 展示用标签与配色（前端据此渲染图标/颜色） */
export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  warning_yellow: '黄色预警',
  warning_orange: '橙色预警',
  warning_red: '红色预警',
  warning_severe: '严重预警',
  class_notice: '班级通知',
  system: '系统消息',
};

/** 保留天数：超过则清理（站内消息不需要永久留存，DB 里另有审计表） */
const NOTIFICATION_RETENTION_DAYS = 90;

/** 单次清理上限，避免一次删太多锁表 */
const CLEANUP_BATCH_SIZE = 5000;

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 预警级别 → 消息类型 */
  static typeForWarningLevel(level: string): string {
    const normalized = String(level || '').trim().toLowerCase();
    if (['yellow', 'orange', 'red', 'severe'].includes(normalized)) {
      return `warning_${normalized}`;
    }
    return 'system';
  }

  /**
   * 写入一条站内消息（尽力而为，失败只记日志）
   *
   * @param userId  接收者 users.id
   * @param type    消息类型（见 NOTIFICATION_TYPE_LABELS）
   * @param content 消息正文
   * @param tx      可选事务客户端；传入时与主流程同事务，保证一致性
   */
  async createForUser(
    userId: bigint | number | string | null | undefined,
    type: string,
    content: string,
    tx?: any,
  ): Promise<boolean> {
    try {
      if (userId === null || userId === undefined || userId === '') {
        return false;
      }
      const text = String(content || '').trim();
      if (!text) {
        return false;
      }
      const client = tx || this.prisma;
      await client.notification.create({
        data: {
          user_id: BigInt(userId as any),
          type: String(type || 'system').slice(0, 32),
          content: text,
          status: 'unread',
        },
      });
      return true;
    } catch (error: any) {
      this.logger.warn(
        `[站内消息] 写入失败 user=${String(userId)} type=${type}: ${error?.message || error}`,
      );
      return false;
    }
  }

  /**
   * 批量写入站内消息（预警广播用）
   *
   * createMany 一次插入，避免 N 次往返；失败降级为逐条写。
   */
  async createManyForUsers(
    userIds: Array<bigint | number | string>,
    type: string,
    content: string,
    tx?: any,
  ): Promise<number> {
    const ids = Array.from(
      new Set(
        (userIds || [])
          .filter((id) => id !== null && id !== undefined && id !== '')
          .map((id) => String(id)),
      ),
    );
    if (ids.length === 0) return 0;

    const text = String(content || '').trim();
    if (!text) return 0;

    const client = tx || this.prisma;
    try {
      const result = await client.notification.createMany({
        data: ids.map((id) => ({
          user_id: BigInt(id),
          type: String(type || 'system').slice(0, 32),
          content: text,
          status: 'unread',
        })),
      });
      return Number(result?.count || ids.length);
    } catch (error: any) {
      this.logger.warn(
        `[站内消息] createMany 失败，降级逐条写入（${ids.length} 条）：${error?.message || error}`,
      );
      let ok = 0;
      for (const id of ids) {
        if (await this.createForUser(id, type, text, tx)) ok += 1;
      }
      return ok;
    }
  }

  /** 未读数（前端红点） */
  async countUnread(userId: bigint | number | string) {
    return this.prisma.notification.count({
      where: { user_id: BigInt(userId as any), status: 'unread' },
    });
  }

  /** 分页列表 + 未读数（一次请求拿全，减少前端往返） */
  async listForUser(
    userId: bigint | number | string,
    options: { page?: number; pageSize?: number; status?: string; type?: string } = {},
  ) {
    const uid = BigInt(userId as any);
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));

    const where: any = { user_id: uid };
    const status = String(options.status || '').trim();
    if (status === 'unread' || status === 'read') {
      where.status = status;
    }
    const type = String(options.type || '').trim();
    if (type) {
      where.type = type;
    }

    const [list, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.countUnread(uid),
    ]);

    return {
      list: list.map((item) => ({
        id: item.id.toString(),
        type: item.type,
        type_label: NOTIFICATION_TYPE_LABELS[item.type] || item.type,
        content: item.content,
        status: item.status,
        is_read: item.status === 'read',
        created_at: item.created_at,
      })),
      total,
      unread,
      page,
      pageSize,
    };
  }

  /**
   * 单条已读
   *
   * 返回值语义（**真实状态迁移**，不是"SQL 命中了行"）：
   *   true  = 本次调用把一条 unread 变成了 read
   *   false = 消息不存在 / 不属于该用户 / **已经是 read**
   *
   * 为什么要带 `status: 'unread'` 条件：
   * 并发自测发现，若 where 只带 {id, user_id}，Prisma 的 updateMany
   * 即使把一行重新写成同样的 'read' 也会返回 count=1 ——
   * 于是并发调用 10 次会全部返回"已标记为已读"，
   * 而不是"仅第一次成功、其余幂等地告知已读"。
   * 加上 status 条件后，只有**真正发生迁移**的那一次返回 true，
   * 其余返回 false，控制器据此返回 404（不泄露他人消息是否存在）。
   */
  async markRead(userId: bigint | number | string, notificationId: bigint | number | string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        id: BigInt(notificationId as any),
        user_id: BigInt(userId as any),
        status: 'unread',
      },
      data: { status: 'read', updated_at: new Date() },
    });
    return result.count > 0;
  }

  /** 全部已读 */
  async markAllRead(userId: bigint | number | string) {
    const result = await this.prisma.notification.updateMany({
      where: { user_id: BigInt(userId as any), status: 'unread' },
      data: { status: 'read', updated_at: new Date() },
    });
    return result.count;
  }

  /**
   * 历史消息清理（每日 04:10）
   *
   * 站内消息是"提醒"而非"档案"：已读且超过保留期的直接删除。
   * 未读消息**不删** —— 学生还没看到就删掉等于没通知。
   */
  @Cron('0 10 4 * * *')
  async cleanupOldNotifications() {
    try {
      const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const stale = await this.prisma.notification.findMany({
        where: { status: 'read', created_at: { lt: cutoff } },
        select: { id: true },
        take: CLEANUP_BATCH_SIZE,
      });
      if (stale.length === 0) {
        return;
      }
      const result = await this.prisma.notification.deleteMany({
        where: { id: { in: stale.map((item) => item.id) } },
      });
      this.logger.log(
        `[站内消息] 清理已读且超过 ${NOTIFICATION_RETENTION_DAYS} 天的消息 ${result.count} 条`,
      );
    } catch (error: any) {
      this.logger.warn(`[站内消息] 清理失败：${error?.message || error}`);
    }
  }
}

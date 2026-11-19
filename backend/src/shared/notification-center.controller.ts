import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { NotificationCenterService } from './notification-center.service';

/**
 * 站内消息中心接口
 *
 * 路由刻意放在 `/student/notifications*` 下，与前端既有的
 * `pages/student/MyNotifications.vue`（调用 `GET /student/notifications`、
 * `POST /student/notifications/:id/read`）保持一致，并在此基础上
 * 补齐未读数与"全部已读"。
 *
 * 注意：`GET /student/notifications` 这个路径**已被 StudentsController
 * 注册**（读 class_notifications 班级公告）。Nest 在路由冲突时由
 * 注册顺序决定谁生效，为避免歧义，站内消息中心使用独立子路径：
 *
 *   GET  /student/inbox              站内消息列表（原 notification 表）
 *   GET  /student/inbox/unread-count 未读数
 *   POST /student/inbox/:id/read     单条已读
 *   POST /student/inbox/read-all     全部已读
 *
 * 这样两个数据源各走各的路由，互不覆盖 —— 班级公告仍在原路径，
 * 个人站内消息走 /student/inbox。
 */
@Controller('student/inbox')
@UseGuards(AuthGuard)
export class NotificationCenterController {
  constructor(private readonly notificationCenter: NotificationCenterService) {}

  /** 取当前登录用户的 users.id（notification.user_id 指向它） */
  private getUserId(req: any): bigint {
    const raw = req.user?.sub ?? req.user?.userId;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      throw new ForbiddenException('未登录');
    }
    try {
      return BigInt(String(raw).trim());
    } catch {
      throw new ForbiddenException('登录态异常，无法解析用户标识');
    }
  }

  private parseId(raw: string): bigint {
    const text = String(raw || '').trim();
    if (!/^\d+$/.test(text)) {
      throw new BadRequestException('消息 ID 必须是数字');
    }
    return BigInt(text);
  }

  @Get()
  async list(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
  ) {
    const userId = this.getUserId(req);
    const data = await this.notificationCenter.listForUser(userId, {
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
      status,
      type,
    });

    return {
      code: 0,
      message: 'ok',
      data,
      trace_id: req.trace_id,
    };
  }

  /** 未读数：前端红点轮询用，返回体刻意保持极小 */
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const userId = this.getUserId(req);
    const unread = await this.notificationCenter.countUnread(userId);

    return {
      code: 0,
      message: 'ok',
      data: { unread },
      trace_id: req.trace_id,
    };
  }

  /**
   * 全部已读
   *
   * ⚠️ 必须声明在 `:id/read` **之前**：
   * 但两者路径段数不同（read-all 是 1 段，:id/read 是 2 段），
   * 其实不会互相匹配。这里仍显式前置，避免后续有人把
   * `:id/read` 改成 `:id` 时把 read-all 吞掉。
   */
  @Post('read-all')
  async markAllRead(@Req() req: any) {
    const userId = this.getUserId(req);
    const updated = await this.notificationCenter.markAllRead(userId);

    return {
      code: 0,
      message: `已将 ${updated} 条消息标记为已读`,
      data: { updated, unread: 0 },
      trace_id: req.trace_id,
    };
  }

  @Post(':id/read')
  async markRead(@Req() req: any, @Param('id') id: string) {
    const userId = this.getUserId(req);
    const notificationId = this.parseId(id);

    const changed = await this.notificationCenter.markRead(userId, notificationId);
    if (!changed) {
      // 不存在 / 不属于当前用户 —— 都按 404 处理，不泄露他人消息是否存在
      throw new NotFoundException('消息不存在或不属于当前用户');
    }

    const unread = await this.notificationCenter.countUnread(userId);
    return {
      code: 0,
      message: '已标记为已读',
      data: { id: notificationId.toString(), unread },
      trace_id: req.trace_id,
    };
  }
}

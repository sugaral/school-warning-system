import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { AuthGuard } from '../shared/auth.guard';
import { PrismaService } from '../shared/prisma.service';

@Controller('admin/audit')
@UseGuards(AuthGuard, PermissionGuard)
export class AuditManageController {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeIds(ids: unknown) {
    if (!Array.isArray(ids)) {
      return [];
    }

    return Array.from(
      new Map(
        ids
          .map((item) => String(item || '').trim())
          .filter((item) => /^\d+$/.test(item))
          .map((item) => [item, BigInt(item)]),
      ).values(),
    );
  }

  @Delete('operations/:id')
  @Permissions('audit:delete')
  async deleteOperationLog(@Param('id') id: string) {
    const targetId = BigInt(id);
    const existing = await this.prisma.audit_logs.findUnique({
      where: { id: targetId },
      select: { id: true },
    });

    if (!existing) {
      return { code: 404, message: '未找到对应的操作日志', data: null };
    }

    await this.prisma.audit_logs.delete({
      where: { id: targetId },
    });

    return { code: 0, message: '删除成功', data: null };
  }

  @Post('operations/batch-delete')
  @Permissions('audit:delete')
  async batchDeleteOperationLogs(@Body() body: { ids?: string[] }) {
    const ids = this.normalizeIds(body?.ids);
    if (ids.length === 0) {
      return { code: 400, message: '请先选择要删除的操作日志', data: null };
    }

    const result = await this.prisma.audit_logs.deleteMany({
      where: { id: { in: ids } },
    });

    return {
      code: 0,
      message: `已删除 ${result.count} 条操作日志`,
      data: { count: result.count },
    };
  }

  @Delete('notifications/:id')
  @Permissions('audit:delete')
  async deleteNotificationLog(@Param('id') id: string) {
    const targetId = BigInt(id);
    const existing = await this.prisma.notification_logs.findUnique({
      where: { id: targetId },
      select: { id: true },
    });

    if (!existing) {
      return { code: 404, message: '未找到对应的消息发送记录', data: null };
    }

    await this.prisma.notification_logs.delete({
      where: { id: targetId },
    });

    return { code: 0, message: '删除成功', data: null };
  }

  @Post('notifications/batch-delete')
  @Permissions('audit:delete')
  async batchDeleteNotificationLogs(@Body() body: { ids?: string[] }) {
    const ids = this.normalizeIds(body?.ids);
    if (ids.length === 0) {
      return { code: 400, message: '请先选择要删除的消息发送记录', data: null };
    }

    const result = await this.prisma.notification_logs.deleteMany({
      where: { id: { in: ids } },
    });

    return {
      code: 0,
      message: `已删除 ${result.count} 条消息发送记录`,
      data: { count: result.count },
    };
  }

  @Delete('security-events/:id')
  @Permissions('audit:delete')
  async deleteSecurityEvent(@Param('id') id: string) {
    const targetId = BigInt(id);
    const existing = await this.prisma.security_events.findUnique({
      where: { id: targetId },
      select: { id: true },
    });

    if (!existing) {
      return { code: 404, message: '未找到对应的安全事件', data: null };
    }

    await this.prisma.security_events.delete({
      where: { id: targetId },
    });

    return { code: 0, message: '删除成功', data: null };
  }

  @Post('security-events/batch-delete')
  @Permissions('audit:delete')
  async batchDeleteSecurityEvents(@Body() body: { ids?: string[] }) {
    const ids = this.normalizeIds(body?.ids);
    if (ids.length === 0) {
      return { code: 400, message: '请先选择要删除的安全事件', data: null };
    }

    const result = await this.prisma.security_events.deleteMany({
      where: { id: { in: ids } },
    });

    return {
      code: 0,
      message: `已删除 ${result.count} 条安全事件`,
      data: { count: result.count },
    };
  }
}

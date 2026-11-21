import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../rbac/permission.decorator';
import { PermissionGuard } from '../rbac/permission.guard';
import { AuthGuard } from '../shared/auth.guard';
import { PrismaService } from '../shared/prisma.service';

@Controller('admin/audit')
@UseGuards(AuthGuard, PermissionGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  private readonly entityTextMap: Record<string, string> = {
    attendance: '签到',
    sessions: '签到',
    class_session: '签到课次',
    class_sessions: '签到课次',
    student: '学生',
    students: '学生',
    teacher: '教师',
    teachers: '教师',
    user: '用户',
    users: '用户',
    class: '班级',
    classes: '班级',
    course: '课程',
    courses: '课程',
    'course-classes': '开课班',
    course_classes: '开课班',
    schedules: '课表',
    schedule: '课表',
    org: '组织机构',
    orgs: '组织机构',
    warning: '预警',
    warnings: '预警',
    'warning-cases': '高风险干预',
    warning_cases: '高风险干预',
    leave_requests: '请假申请',
    makeup_requests: '补课申请',
    appeals: '申诉',
    role: '角色',
    roles: '角色',
    permission: '权限',
    permissions: '权限',
    rule: '规则',
    rules: '规则',
    config: '系统配置',
    notification: '通知',
    notifications: '通知',
    feedback: '反馈',
    feedbacks: '反馈',
    audit: '审计',
    report: '报表',
    reports: '报表',
    jobs: '任务',
    grades: '成绩',
    grade: '成绩',
    admin: '管理端',
    teacher_bindings: '教师绑定',
    profile: '个人资料',
  };

  private readonly actionTextMap: Record<string, string> = {
    view: '查看',
    create: '创建',
    update: '更新',
    delete: '删除',
    approve: '审批',
    handle: '处理',
    checkin: '签到',
    status: '状态变更',
    enable: '启用',
    disable: '停用',
    bind: '绑定',
    unbind: '解绑',
    import: '导入',
    export: '导出',
    'batch-create': '批量创建',
    'batch-delete': '批量删除',
    ack: '确认',
    clear: '清理',
    complete: '完成',
    assign: '分配',
    login: '登录',
    logout: '退出',
    process_ended_sessions: '自动处理结束签到',
    run_daily: '执行日预警',
    rescan_all: '重扫预警',
  };

  private readonly fullActionTextMap: Record<string, string> = {
    'scheduler.process_ended_sessions': '自动处理结束签到',
    'warning.reconcile_recent': '夜间预警对账',
  };

  private formatEntityDesc(entityType?: string | null) {
    const key = String(entityType || '').trim();
    return this.entityTextMap[key] || key || '-';
  }

  private formatStoredOrDerivedEntityDesc(
    entityType?: string | null,
    storedDesc?: string | null,
  ) {
    const text = String(storedDesc || '').trim();
    if (text) {
      return text;
    }
    return this.formatEntityDesc(entityType);
  }

  private formatActionDesc(action?: string | null, entityType?: string | null) {
    const normalizedAction = String(action || '').trim();
    if (!normalizedAction) {
      return '-';
    }

    const exactText = this.fullActionTextMap[normalizedAction];
    if (exactText) {
      return exactText;
    }

    const segments = normalizedAction.split('.').filter(Boolean);
    const actionKey = segments[segments.length - 1] || normalizedAction;
    const actionText = this.actionTextMap[actionKey];
    if (!actionText) {
      return normalizedAction;
    }

    if (actionKey === 'checkin' || actionKey === 'login' || actionKey === 'logout') {
      return actionText;
    }

    const targetEntity =
      this.formatEntityDesc(entityType) ||
      this.formatEntityDesc(segments[0]);

    if (actionKey === 'status') {
      return `${targetEntity}状态变更`;
    }

    return `${actionText}${targetEntity}`;
  }

  private formatStoredOrDerivedActionDesc(
    action?: string | null,
    entityType?: string | null,
    storedDesc?: string | null,
  ) {
    const text = String(storedDesc || '').trim();
    if (text) {
      return text;
    }
    return this.formatActionDesc(action, entityType);
  }

  private formatIpDisplay(ip?: string | null) {
    const raw = String(ip || '').trim();
    if (!raw) {
      return '未记录 IP';
    }

    const first = raw.split(',')[0].trim().replace(/^::ffff:/i, '');
    const normalized = first.toLowerCase();
    if (
      normalized === '127.0.0.1' ||
      normalized === '::1' ||
      normalized === '0.0.0.0' ||
      normalized === 'localhost'
    ) {
      return '代理未透传真实 IP';
    }

    return first;
  }

  private isSystemActor(actorUserId?: bigint | null) {
    return actorUserId === 0n;
  }

  private formatOperatorDisplay(
    actorUserId?: bigint | null,
    user?: { name?: string | null } | null,
  ) {
    if (this.isSystemActor(actorUserId)) {
      return '系统任务';
    }

    return String(user?.name || '').trim() || '未知';
  }

  private formatOperatorEmailDisplay(
    actorUserId?: bigint | null,
    user?: { email?: string | null } | null,
  ) {
    if (this.isSystemActor(actorUserId)) {
      return 'system';
    }

    return String(user?.email || '').trim() || '';
  }

  private formatOperatorMobileDisplay(
    actorUserId?: bigint | null,
    user?: { mobile?: string | null } | null,
  ) {
    if (this.isSystemActor(actorUserId)) {
      return 'system';
    }

    return String(user?.mobile || '').trim() || '';
  }

  private formatAuditIpDisplay(actorUserId?: bigint | null, ip?: string | null) {
    if (this.isSystemActor(actorUserId) && !String(ip || '').trim()) {
      return '系统任务';
    }

    return this.formatIpDisplay(ip);
  }

  // 获取操作日志
  @Get('operations')
  @Permissions('audit:view')
  async getOperationLogs(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const where: any = {};

    if (action) {
      where.action = { contains: action };
    }

    if (entityType) {
      where.entity_type = entityType;
    }

    if (startDate && endDate) {
      where.created_at = {
        gte: new Date(`${startDate}T00:00:00`),
        lt: new Date(`${endDate}T23:59:59`),
      };
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));

    const [logs, total] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where,
        select: {
          id: true,
          actor_user_id: true,
          action: true,
          entity_type: true,
          entity_id: true,
          ip: true,
          created_at: true,
          before_json: true,
          after_json: true,
        },
        orderBy: { created_at: 'desc' },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.audit_logs.count({ where }),
    ]);

    // 获取用户信息
    const userIds = logs.map((log: { actor_user_id: bigint }) => log.actor_user_id);
    const users =
      userIds.length > 0
        ? await this.prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [];

    const userMap = new Map(
      users.map((u: { id: bigint; name: string; email: string | null }) => [
        u.id.toString(),
        { ...u, email: u.email || '' },
      ]),
    );

    return {
      code: 0,
      message: 'ok',
      data: {
        list: logs.map(
          (log: {
            id: bigint;
            actor_user_id: bigint;
            action: string;
            entity_type: string;
            entity_id: bigint | null;
            ip: string | null;
            created_at: Date;
            before_json: any;
            after_json: any;
          }) => {
            const user = userMap.get(log.actor_user_id.toString()) as
              | { name: string }
              | undefined;

            return {
              id: log.id.toString(),
              operator: this.formatOperatorDisplay(log.actor_user_id, user),
              action: log.action,
              actionDesc: this.formatStoredOrDerivedActionDesc(
                log.action,
                log.entity_type,
                (log as any).action_desc,
              ),
              resource: log.entity_type,
              resourceDesc: this.formatStoredOrDerivedEntityDesc(
                log.entity_type,
                (log as any).entity_desc,
              ),
              entityId: log.entity_id?.toString(),
              ip: this.formatAuditIpDisplay(log.actor_user_id, log.ip),
              timestamp: log.created_at,
              before: log.before_json,
              after: log.after_json,
            };
          },
        ),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    };
  }

  // 获取操作日志详情
  @Get('operations/:id')
  @Permissions('audit:view')
  async getOperationLogDetail(@Param('id') id: string) {
    const log = await this.prisma.audit_logs.findUnique({
      where: { id: BigInt(id) },
      select: {
        id: true,
        actor_user_id: true,
        action: true,
        entity_type: true,
        entity_id: true,
        ip: true,
        user_agent: true,
        created_at: true,
        before_json: true,
        after_json: true,
      },
    });

    if (!log) {
      return { code: 404, message: '未找到对应的操作日志', data: null };
    }

    // 获取用户信息
    const user = await this.prisma.users.findUnique({
      where: { id: log.actor_user_id },
      select: { name: true, email: true, mobile: true },
    });

    return {
      code: 0,
      message: 'ok',
      data: {
        id: log.id.toString(),
        operator: this.formatOperatorDisplay(log.actor_user_id, user),
        operatorEmail: this.formatOperatorEmailDisplay(log.actor_user_id, user),
        operatorMobile: this.formatOperatorMobileDisplay(log.actor_user_id, user),
        action: log.action,
        actionDesc: this.formatStoredOrDerivedActionDesc(
          log.action,
          log.entity_type,
          (log as any).action_desc,
        ),
        resource: log.entity_type,
        resourceDesc: this.formatStoredOrDerivedEntityDesc(
          log.entity_type,
          (log as any).entity_desc,
        ),
        entityId: log.entity_id?.toString(),
        ip: this.formatAuditIpDisplay(log.actor_user_id, log.ip),
        userAgent: log.user_agent,
        timestamp: log.created_at,
        before: log.before_json,
        after: log.after_json,
      },
    };
  }

  // 获取消息发送审计记录
  @Get('notifications')
  @Permissions('audit:view')
  async getNotificationLogs(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('receiver') receiver?: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const where: any = {};

    if (status) {
      where.send_status = status;
    }

    if (channel) {
      where.channel = channel;
    }

    if (receiver) {
      where.receiver = { contains: receiver };
    }

    if (startDate && endDate) {
      where.sent_at = {
        gte: new Date(`${startDate}T00:00:00`),
        lt: new Date(`${endDate}T23:59:59`),
      };
    }

    const [logs, total] = await Promise.all([
      this.prisma.notification_logs.findMany({
        where,
        orderBy: { sent_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification_logs.count({ where }),
    ]);

    return {
      code: 0,
      message: 'ok',
      data: {
        list: logs.map(
          (log: {
            id: bigint;
            receiver: string;
            channel: string;
            content_snapshot: string | null;
            send_status: string;
            sent_at: Date;
            error_msg: string | null;
          }) => ({
            id: log.id.toString(),
            recipient: log.receiver,
            channel: log.channel,
            content: log.content_snapshot || '',
            status: log.send_status,
            sentAt: log.sent_at,
            errorMessage: log.error_msg,
          }),
        ),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    };
  }

  // 获取安全事件列表
  @Get('security-events')
  @Permissions('audit:view')
  async getSecurityEvents(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
    @Query('user') user?: string,
    @Query('eventType') eventType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const where: any = {};

    if (eventType) {
      where.event_type = eventType;
    }

    if (user) {
      const matchedUsers = await this.prisma.users.findMany({
        where: {
          OR: [{ name: { contains: user } }, { email: { contains: user } }],
        },
        select: { id: true },
      });
      where.user_id = {
        in: matchedUsers.map((item: any) => item.id),
      };
    }

    if (startDate && endDate) {
      where.created_at = {
        gte: new Date(`${startDate}T00:00:00`),
        lt: new Date(`${endDate}T23:59:59`),
      };
    }

    const [events, total] = await Promise.all([
      this.prisma.security_events.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.security_events.count({ where }),
    ]);

    // 获取用户信息
    const userIds: bigint[] = events
      .filter((e: { user_id: bigint | null }) => e.user_id !== null)
      .map((e: { user_id: bigint | null }) => e.user_id!);
    const users =
      userIds.length > 0
        ? await this.prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [];

    const userMap = new Map(
      users.map((u: { id: bigint; name: string; email: string | null }) => [
        u.id.toString(),
        { ...u, email: u.email || '' },
      ]),
    );

    return {
      code: 0,
      message: 'ok',
      data: {
        list: events.map(
          (event: {
            id: bigint;
            event_type: string;
            user_id: bigint | null;
            ip: string | null;
            detail_json: any;
            created_at: Date;
          }) => {
            const user = event.user_id
              ? (userMap.get(event.user_id.toString()) as { name: string } | undefined)
              : null;

            return {
              id: event.id.toString(),
              eventType: event.event_type,
              user: user?.name || '未知',
              userId: event.user_id?.toString(),
              ip: this.formatIpDisplay(event.ip),
              detail: event.detail_json,
              timestamp: event.created_at,
            };
          },
        ),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    };
  }

  // 获取安全事件详情
  @Get('security-events/:id')
  @Permissions('audit:view')
  async getSecurityEventDetail(@Param('id') id: string) {
    const event = await this.prisma.security_events.findUnique({
      where: { id: BigInt(id) },
    });

    if (!event) {
      return { code: 404, message: '未找到对应的安全事件', data: null };
    }

    // 获取用户信息
    let user = null;
    if (event.user_id) {
      user = await this.prisma.users.findUnique({
        where: { id: event.user_id },
        select: { name: true, email: true, mobile: true },
      });
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        id: event.id.toString(),
        eventType: event.event_type,
        user: user?.name || '未知',
        userId: event.user_id?.toString(),
        userEmail: user?.email,
        userMobile: user?.mobile,
        ip: this.formatIpDisplay(event.ip),
        detail: event.detail_json,
        timestamp: event.created_at,
      },
    };
  }

  // 导出审计日志
  @Post('export')
  @Permissions('audit:export')
  async exportAuditLogs(
    @Query('type') type: 'operations' | 'notifications' | 'security',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
  ) {
    const start =
      startDate ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = endDate || new Date().toISOString().split('T')[0];

    let data: any[] = [];

    switch (type) {
      case 'operations':
        data = await this.prisma.audit_logs.findMany({
          where: {
            ...(action ? { action: { contains: action } } : {}),
            ...(entityType ? { entity_type: entityType } : {}),
            created_at: {
              gte: new Date(`${start}T00:00:00`),
              lt: new Date(`${end}T23:59:59`),
            },
          },
          select: {
            id: true,
            actor_user_id: true,
            action: true,
            entity_type: true,
            entity_id: true,
            ip: true,
            user_agent: true,
            created_at: true,
            before_json: true,
            after_json: true,
          },
          orderBy: { created_at: 'desc' },
        });

        if (data.length > 0) {
          const userIds = data.map((item: any) => item.actor_user_id);
          const users = await this.prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          });
          const userMap = new Map(
            users.map((item) => [
              item.id.toString(),
              { name: item.name, email: item.email || '' },
            ]),
          );

          data = data.map((log: any) => ({
            id: log.id.toString(),
            operator: this.formatOperatorDisplay(
              log.actor_user_id,
              userMap.get(log.actor_user_id.toString()) || null,
            ),
            action: log.action,
            actionDesc: this.formatStoredOrDerivedActionDesc(
              log.action,
              log.entity_type,
              (log as any).action_desc,
            ),
            resource: log.entity_type,
            resourceDesc: this.formatStoredOrDerivedEntityDesc(
              log.entity_type,
              (log as any).entity_desc,
            ),
            entityId: log.entity_id?.toString() || '',
            ip: this.formatAuditIpDisplay(log.actor_user_id, log.ip),
            userAgent: log.user_agent || '',
            timestamp: log.created_at,
            before: log.before_json,
            after: log.after_json,
          }));
        }
        break;

      case 'notifications':
        data = await this.prisma.notification_logs.findMany({
          where: {
            sent_at: {
              gte: new Date(`${start}T00:00:00`),
              lt: new Date(`${end}T23:59:59`),
            },
          },
          orderBy: { sent_at: 'desc' },
        });
        break;

      case 'security':
        data = await this.prisma.security_events.findMany({
          where: {
            created_at: {
              gte: new Date(`${start}T00:00:00`),
              lt: new Date(`${end}T23:59:59`),
            },
          },
          orderBy: { created_at: 'desc' },
        });
        break;
    }

    return {
      code: 0,
      message: '导出成功',
      data: {
        type,
        startDate: start,
        endDate: end,
        count: data.length,
        data,
      },
    };
  }
}


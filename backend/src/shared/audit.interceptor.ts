import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { PinoLogger } from 'nestjs-pino';
import { SKIP_AUDIT_KEY } from './skip-audit.decorator';
import { serializeForAudit } from './json.util';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AuditInterceptor');
  }

  private readonly maxUserAgentLength = 255;

  /** 敏感字段集合，记录到审计日志前需脱敏 */
  private readonly sensitiveFields = new Set([
    'password_hash', 'code_hash', 'salt', 'wx_openid',
    'password', 'token', 'secret', 'access_token',
  ]);

  private readonly entityTypeMap: Record<string, string> = {
    attendance: '签到',
    sessions: '签到',
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
    roles: '角色',
    role: '角色',
    permissions: '权限',
    permission: '权限',
    rules: '规则',
    rule: '规则',
    config: '系统配置',
    system: '系统',
    stats: '统计',
    reports: '报表',
    report: '报表',
    jobs: '任务',
    grades: '成绩',
    grade: '成绩',
    notification: '通知',
    notifications: '通知',
    audit: '审计',
    admin: '管理端',
    teacher_bindings: '教师绑定',
    profile: '个人资料',
  };

  private readonly actionTypeMap: Record<string, string> = {
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
  };

  private readonly routePrefixes = new Set([
    'admin',
    'teacher',
    'head-teacher',
    'student-admin',
    'teaching-admin',
  ]);

  private readonly entityAliases: Record<string, string> = {
    sessions: 'attendance',
    'bind-org': 'orgs',
    'bind-courses': 'teacher_bindings',
    'my-bindings': 'teacher_bindings',
  };

  /** 实体类型到 Prisma 表名的映射 */
  private readonly entityToTableMap: Record<string, string> = {
    students: 'student_profiles',
    teachers: 'users',
    users: 'users',
    classes: 'classes',
    courses: 'courses',
    course_classes: 'course_classes',
    'course-classes': 'course_classes',
    schedules: 'schedules',
    schedule: 'schedules',
    orgs: 'orgs',
    org: 'orgs',
    warnings: 'warnings',
    warning: 'warnings',
    'warning-cases': 'warning_cases',
    warning_cases: 'warning_cases',
    leave_requests: 'leave_requests',
    makeup_requests: 'makeup_requests',
    appeals: 'appeals',
    roles: 'roles',
    role: 'roles',
    permissions: 'permissions',
    permission: 'permissions',
    rules: 'warning_rules',
    rule: 'warning_rules',
    config: 'system_configs',
    grades: 'grades',
    grade: 'grades',
    notification: 'notification_jobs',
    notifications: 'notification_jobs',
    teacher_bindings: 'teacher_bindings',
    attendance: 'class_sessions',
    sessions: 'class_sessions',
    feedback: 'security_events',
    profile: 'users',
    jobs: 'notification_jobs',
  };

  private getClientIp(request: any) {
    const candidates = [
      request.headers?.['x-forwarded-for'],
      request.headers?.['x-real-ip'],
      request.ip,
      request.socket?.remoteAddress,
    ];

    for (const candidate of candidates) {
      const raw = String(Array.isArray(candidate) ? candidate[0] : candidate || '')
        .split(',')[0]
        .trim()
        .replace(/^::ffff:/i, '');
      if (!raw) {
        continue;
      }
      return raw;
    }

    return '';
  }

  private normalizeUserAgent(userAgent: unknown) {
    const text = String(userAgent || '').trim();
    if (!text) {
      return null;
    }
    return text.slice(0, this.maxUserAgentLength);
  }

  /**
   * 修正后的跳过规则
   * - 保留 /health（健康检查无需审计）
   * - 保留 /admin/audit（避免循环记录）
   * - 移除 /auth/ 整体排除 → 认证操作需要审计
   * - 移除 /admin/schedules/import 排除 → 课表导入是高危操作
   * - 仅排除高频认证路径 /auth/token 和 /auth/refresh
   */
  private shouldSkip(path: string): boolean {
    if (path.includes('/health')) return true;
    if (path.includes('/admin/audit')) return true;
    // 高频 token 刷新路径跳过
    if (path === '/auth/token' || path === '/auth/refresh') return true;
    return false;
  }

  /** 需要记录 before 快照的 HTTP 方法 */
  private shouldCaptureBefore(method: string): boolean {
    return ['PUT', 'PATCH', 'DELETE'].includes(method);
  }

  /** 需要记录 after 快照的 HTTP 方法 */
  private shouldCaptureAfter(method: string): boolean {
    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  }

  /**
   * 从路径和请求体推断实体 ID
   */
  private extractIdFromPathOrBody(path: string, body: any): bigint | null {
    // 从路径提取 /:id
    const pathMatch = path.match(/\/(\d+)(?:\/|$)/);
    if (pathMatch) return BigInt(pathMatch[1]);
    // 从 body 提取
    if (body?.id) return BigInt(body.id);
    return null;
  }

  /**
   * 抓取变更前快照
   */
  private async captureBeforeSnapshot(path: string, body: any): Promise<any> {
    const entityId = this.extractIdFromPathOrBody(path, body);
    if (!entityId) return null;

    const entityType = this.resolveEntityType(path);
    const tableName = this.entityToTableMap[entityType];
    if (!tableName) return null;

    try {
      const record = await (this.prisma as any)[tableName].findUnique({
        where: { id: entityId },
      });
      if (!record) return null;
      return this.redactSensitiveFields(record);
    } catch {
      // 查不到不阻断主流程
      return null;
    }
  }

  /**
   * 抓取变更后快照
   */
  private async captureAfterSnapshot(
    entityType: string,
    entityId: bigint,
    response: any,
    body: any,
  ): Promise<any> {
    const tableName = this.entityToTableMap[entityType];
    if (!tableName) return body || null;

    try {
      // 优先从 response.data 获取
      if (response?.data && typeof response.data === 'object') {
        return this.redactSensitiveFields(response.data);
      }
      // 其次从 DB 重新查询
      const record = await (this.prisma as any)[tableName].findUnique({
        where: { id: entityId },
      });
      if (record) return this.redactSensitiveFields(record);
      return body || null;
    } catch {
      return body || null;
    }
  }

  /**
   * 敏感字段脱敏
   */
  private redactSensitiveFields(record: any): any {
    if (!record || typeof record !== 'object') return record;
    const result: any = Array.isArray(record) ? [] : {};
    for (const [key, value] of Object.entries(record)) {
      if (this.sensitiveFields.has(key)) {
        result[key] = '***REDACTED***';
      } else if (typeof value === 'bigint') {
        result[key] = value.toString();
      } else if (value instanceof Date) {
        result[key] = value.toISOString();
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const method = request.method;
    const path = request.path;
    const body = request.body;

    // 检查 @SkipAudit 装饰器
    const skipAudit = Reflect.getMetadata(SKIP_AUDIT_KEY, context.getHandler());
    if (skipAudit) return next.handle();

    if (!user || (!user.sub && !user.userId)) {
      return next.handle();
    }

    if (this.shouldSkip(path)) {
      return next.handle();
    }

    // ✅ 新增：写操作前先抓取 before 快照
    const beforePromise = this.shouldCaptureBefore(method)
      ? this.captureBeforeSnapshot(path, body)
      : Promise.resolve(null);

    return from(beforePromise).pipe(
      switchMap((beforeSnapshot) =>
        next.handle().pipe(
          tap(async (response) => {
            try {
              const { action, entityType, actionDesc, entityDesc } = this.parseAction(
                method,
                path,
              );
              const actorUserId = BigInt(user.userId || user.sub);
              const entityId = this.extractEntityId(path, body, response);

              // ✅ 新增：写操作后抓取 after 快照
              const afterSnapshot = this.shouldCaptureAfter(method)
                ? await this.captureAfterSnapshot(entityType, entityId, response, body)
                : null;

              await this.prisma.audit_logs.create({
                data: {
                  actor_user_id: actorUserId,
                  action,
                  entity_type: entityType,
                  entity_id: entityId,
                  before_json: beforeSnapshot
                    ? (serializeForAudit(beforeSnapshot) as any)
                    : Prisma.JsonNull,
                  after_json: afterSnapshot
                    ? (serializeForAudit(afterSnapshot) as any)
                    : Prisma.JsonNull,
                  ip: this.getClientIp(request) || null,
                  user_agent: this.normalizeUserAgent(request.headers['user-agent']),
                },
              });
            } catch (error) {
              this.logger.error({ err: error }, '审计日志写入失败');
            }
          }),
        ),
      ),
    );
  }

  private parseAction(
    method: string,
    path: string,
  ): {
    action: string;
    entityType: string;
    actionDesc: string;
    entityDesc: string;
  } {
    const entityType = this.resolveEntityType(path);
    const entityDesc = this.entityTypeMap[entityType] || entityType;

    let action = `${entityType}.view`;
    let actionDesc = `查看${entityDesc}`;

    if (path.includes('/approve')) {
      action = `${entityType}.approve`;
      actionDesc = `审批${entityDesc}`;
    } else if (path.includes('/handle')) {
      action = `${entityType}.handle`;
      actionDesc = `处理${entityDesc}`;
    } else if (path.includes('/checkin')) {
      action = `${entityType}.checkin`;
      actionDesc = '签到';
    } else if (path.includes('/status')) {
      action = `${entityType}.status`;
      actionDesc = `${entityDesc}状态变更`;
    } else if (path.includes('/enable')) {
      action = `${entityType}.enable`;
      actionDesc = `启用${entityDesc}`;
    } else if (path.includes('/disable')) {
      action = `${entityType}.disable`;
      actionDesc = `停用${entityDesc}`;
    } else if (path.includes('/bind')) {
      action = `${entityType}.bind`;
      actionDesc = `绑定${entityDesc}`;
    } else if (path.includes('/unbind')) {
      action = `${entityType}.unbind`;
      actionDesc = `解绑${entityDesc}`;
    } else if (path.includes('/import')) {
      action = `${entityType}.import`;
      actionDesc = `导入${entityDesc}`;
    } else if (path.includes('/export')) {
      action = `${entityType}.export`;
      actionDesc = `导出${entityDesc}`;
    } else if (path.includes('/batch-create')) {
      action = `${entityType}.batch-create`;
      actionDesc = `批量创建${entityDesc}`;
    } else if (path.includes('/batch-delete')) {
      action = `${entityType}.batch-delete`;
      actionDesc = `批量删除${entityDesc}`;
    } else {
      switch (method) {
        case 'POST':
          action = `${entityType}.create`;
          actionDesc = `创建${entityDesc}`;
          break;
        case 'PUT':
        case 'PATCH':
          action = `${entityType}.update`;
          actionDesc = `更新${entityDesc}`;
          break;
        case 'DELETE':
          action = `${entityType}.delete`;
          actionDesc = `删除${entityDesc}`;
          break;
        case 'GET':
          action = `${entityType}.view`;
          actionDesc = `查看${entityDesc}`;
          break;
        default:
          action = `${entityType}.unknown`;
          actionDesc = `操作${entityDesc}`;
      }
    }

    return { action, entityType, actionDesc, entityDesc };
  }

  private resolveEntityType(path: string) {
    const parts = path
      .split('/')
      .filter(Boolean)
      .filter((segment) => !/^\d+$/.test(segment));

    const meaningfulParts = parts.filter((segment, index) => {
      if (index === 0 && this.routePrefixes.has(segment)) {
        return false;
      }
      return true;
    });

    const rawEntityType = meaningfulParts[0] || parts[0] || 'unknown';
    return this.entityAliases[rawEntityType] || rawEntityType;
  }

  private extractEntityId(path: string, body: any, response: any): bigint {
    const pathMatch = path.match(/\/(\d+)(?:\/|$)/);
    if (pathMatch) {
      return BigInt(pathMatch[1]);
    }

    if (response?.data?.id) {
      return BigInt(response.data.id);
    }

    if (body?.id) {
      return BigInt(body.id);
    }

    return BigInt(0);
  }
}

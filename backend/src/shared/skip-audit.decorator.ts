/**
 * @SkipAudit 装饰器
 * 标记在控制器方法上，让 AuditInterceptor 跳过该端点的审计记录
 *
 * @example
 *   @SkipAudit()
 *   @Get('health')
 *   getHealth() { ... }
 */
import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skipAudit';

export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);

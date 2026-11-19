import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * 幂等模块（P1-4）
 *
 * 全局注册 IdempotencyInterceptor。拦截器内部会检查
 * `@Idempotent()` 元数据，因此只有显式标注的接口才受幂等保护，
 * 未标注接口行为完全不变（零回归风险）。
 */
@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class IdempotencyModule {}

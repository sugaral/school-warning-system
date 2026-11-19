import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { IDEMPOTENT_KEY } from './idempotency.decorator';

/**
 * HTTP 幂等拦截器（P1-4 修复）
 *
 * 修复前实测状态：
 *  - `idempotency_keys` 表在 schema 里有唯一键，但全代码**只有一处 deleteMany**
 *    （`users.controller.ts:337`，删用户时清理），**无任何写入 / 读取**；
 *  - 用户资料里声明的 `lock:notification-dispatch` 之外也没有任何幂等机制；
 *  - 结论：重复提交（双击签到、重复点审批、网络重试）必然产生重复数据。
 *
 * 本拦截器实现双向保险：
 *  1. **Redis**：`warn:idem:{userId}:{key}` 缓存响应体（TTL 24h）；
 *     `warn:idem:lock:{userId}:{key}` 用 SET NX 兜住并发；
 *  2. **数据库**：`idempotency_keys` 唯一键 `(user_id, idempotency_key)`
 *     作为最终一致性兜底，即使 Redis 被清空也不会重复执行。
 *
 * 判定规则：
 *  - 同 key + 同 request_hash → 回放首次响应（不执行业务）
 *  - 同 key + 不同 request_hash → 409（防止用旧 key 提交新内容）
 *  - 无 `Idempotency-Key` 头 → 直接放行（保持既有接口行为不变）
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private readonly ttlSeconds = 24 * 60 * 60;
  /** 并发等待：轮询间隔与最长等待（毫秒） */
  private readonly waitIntervalMs = 120;
  private readonly waitTimeoutMs = 8000;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const handler = context.getHandler();
    const clazz = context.getClass();

    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [handler, clazz]);
    if (!enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest();

    // 只有写操作需要幂等
    const method = String(request.method || '').toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return next.handle();
    }

    const rawKey = request.headers['idempotency-key'] ?? request.headers['x-idempotency-key'];
    const idemKey = String(Array.isArray(rawKey) ? rawKey[0] : rawKey || '').trim();

    // 未提供幂等键：保持既有行为，直接放行
    if (!idemKey) {
      return next.handle();
    }

    if (idemKey.length > 64) {
      throw new ConflictException('Idempotency-Key 过长（最多 64 字符）');
    }

    const userId = this.resolveUserId(request);
    if (!userId) {
      // 未认证请求不做幂等（AuthGuard 会另行拦截）
      return next.handle();
    }

    const requestHash = this.hashRequest(request);
    const cacheKey = `warn:idem:${userId}:${idemKey}`;
    const lockKey = `warn:idem:lock:${userId}:${idemKey}`;

    // 1) 先查 Redis 缓存
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return this.replayOrConflict(cached, requestHash);
    }

    // 2) 再查数据库（Redis 被清空后的兜底）
    const dbRow = await this.prisma.idempotency_keys.findUnique({
      where: { user_id_idempotency_key: { user_id: userId, idempotency_key: idemKey } },
    });
    if (dbRow) {
      if (dbRow.request_hash !== requestHash) {
        throw new ConflictException('该 Idempotency-Key 已用于不同的请求内容');
      }
      if (dbRow.response_json) {
        await this.writeCache(cacheKey, requestHash, dbRow.response_json);
        return of(dbRow.response_json);
      }
    }

    // 3) 抢占锁，防止并发重复执行
    const lockToken = `${process.pid}:${Date.now()}`;
    const locked = await this.redis
      .acquireLock(lockKey, this.waitTimeoutMs + 2000, lockToken)
      .catch(() => true); // Redis 故障时降级，交给 DB 唯一键兜底

    if (!locked) {
      // 已有同 key 请求在执行：等待其完成后回放结果
      const waited = await this.waitForResult(cacheKey, requestHash);
      if (waited) return of(waited);
      throw new ConflictException('相同 Idempotency-Key 的请求正在处理中，请稍后重试');
    }

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          // 异步落盘，不阻塞响应
          void this.persist(cacheKey, lockKey, lockToken, userId, idemKey, requestHash, responseBody);
        },
        error: () => {
          // 业务失败不缓存，释放锁以便客户端重试
          void this.redis.releaseLock(lockKey, lockToken).catch(() => undefined);
        },
      }),
    );
  }

  /** 缓存命中时：hash 一致则回放，不一致则冲突 */
  private replayOrConflict(cached: any, requestHash: string): Observable<any> {
    if (cached.requestHash !== requestHash) {
      throw new ConflictException('该 Idempotency-Key 已用于不同的请求内容');
    }
    return of(cached.body);
  }

  /** 落库 + 写缓存 + 释放锁 */
  private async persist(
    cacheKey: string,
    lockKey: string,
    lockToken: string,
    userId: bigint,
    idemKey: string,
    requestHash: string,
    responseBody: any,
  ) {
    const payload = this.toJsonSafe(responseBody);
    try {
      await this.prisma.idempotency_keys.upsert({
        where: { user_id_idempotency_key: { user_id: userId, idempotency_key: idemKey } },
        update: { request_hash: requestHash, response_json: payload },
        create: {
          user_id: userId,
          idempotency_key: idemKey,
          request_hash: requestHash,
          response_json: payload,
        },
      });
    } catch (error: any) {
      this.logger.warn(`[幂等] 落库失败 key=${idemKey}: ${error?.message || error}`);
    }

    await this.writeCache(cacheKey, requestHash, payload);
    await this.redis.releaseLock(lockKey, lockToken).catch(() => undefined);
  }

  /** 轮询等待并发请求的结果 */
  private async waitForResult(cacheKey: string, requestHash: string): Promise<any | null> {
    const deadline = Date.now() + this.waitTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.waitIntervalMs));
      const cached = await this.readCache(cacheKey);
      if (cached) {
        if (cached.requestHash !== requestHash) {
          throw new ConflictException('该 Idempotency-Key 已用于不同的请求内容');
        }
        return cached.body;
      }
    }
    return null;
  }

  private async readCache(cacheKey: string): Promise<{ requestHash: string; body: any } | null> {
    try {
      // RedisService extends ioredis，可直接用 get/set
      const raw = await this.redis.get(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  private async writeCache(cacheKey: string, requestHash: string, body: any) {
    try {
      // 注意：Redis 每个 key 都必须设 TTL（编码铁律 19）
      await this.redis.set(
        cacheKey,
        JSON.stringify({ requestHash, body }),
        'EX',
        this.ttlSeconds,
      );
    } catch {
      /* 缓存失败不影响主流程，DB 已兜底 */
    }
  }

  private resolveUserId(request: any): bigint | null {
    const raw = request.user?.sub ?? request.user?.userId;
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    try {
      return BigInt(String(raw));
    } catch {
      return null;
    }
  }

  /** 对「方法 + 路径 + 查询 + 请求体」做 SHA-256，作为请求指纹 */
  private hashRequest(request: any): string {
    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const query = JSON.stringify(request.query || {});
    const raw = `${String(request.method).toUpperCase()}|${String(request.originalUrl || request.url || '')}|${query}|${body}`;
    return createHash('sha256').update(raw).digest('hex');
  }

  /** 保证可写入 Prisma Json 字段（去掉 BigInt / undefined） */
  private toJsonSafe(value: any): any {
    try {
      return JSON.parse(
        JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      );
    } catch {
      return null;
    }
  }

  /**
   * 过期幂等键清理：避免 idempotency_keys 无限增长（§8.7 要求）。
   * 保留期比 Redis TTL 长 1 天，保证「Redis 过期但 DB 仍可兜底」的窗口存在。
   */
  @Cron('0 30 4 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanupExpiredKeys() {
    const cutoff = new Date(Date.now() - (this.ttlSeconds + 24 * 60 * 60) * 1000);
    try {
      const result = await this.prisma.idempotency_keys.deleteMany({
        where: { created_at: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.logger.log(`[幂等] 已清理过期幂等键 ${result.count} 条`);
      }
    } catch (error: any) {
      this.logger.warn(`[幂等] 清理过期键失败：${error?.message || error}`);
    }
  }
}

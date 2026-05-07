import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';

function parseInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function maskRedisUrl(redisUrl: string) {
  try {
    const parsed = new URL(redisUrl);
    if (parsed.password) {
      parsed.password = '***';
    }
    if (parsed.username) {
      parsed.username = parsed.username === 'default' ? 'default' : '***';
    }
    return parsed.toString();
  } catch {
    return redisUrl;
  }
}

function buildRedisOptions(configService: ConfigService) {
  const redisUrl = String(
    configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379'),
  ).trim();

  const options: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  };

  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      options.host = parsed.hostname || '127.0.0.1';
      options.port = parsed.port ? parseInteger(parsed.port, 6379) : 6379;
      options.username = parsed.username || undefined;
      options.password = parsed.password || undefined;
      const dbText = parsed.pathname.replace(/^\/+/, '').trim();
      if (/^\d+$/.test(dbText)) {
        options.db = parseInteger(dbText, 0);
      }
      if (parsed.protocol === 'rediss:') {
        options.tls = {};
      }
    } catch {
      // Fall through to explicit REDIS_HOST / REDIS_PORT style config.
    }
  }

  options.host = String(
    configService.get<string>('REDIS_HOST', options.host || '127.0.0.1'),
  ).trim() || '127.0.0.1';
  options.port = parseInteger(
    configService.get<number>('REDIS_PORT', options.port || 6379),
    options.port || 6379,
  );

  const explicitPassword = String(
    configService.get<string>('REDIS_PASSWORD', options.password || ''),
  ).trim();
  options.password = explicitPassword || options.password || undefined;
  options.db = parseInteger(
    configService.get<number>('REDIS_DB', options.db ?? 0),
    options.db ?? 0,
  );

  return {
    redisUrl,
    displayUrl: maskRedisUrl(redisUrl),
    options,
  };
}

/**
 * Redis 服务 - 全局单例
 * 支持 Docker 容器内连接 (redis://warnsys-redis:6379)
 * 支持本地连接 (redis://127.0.0.1:6380)
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly cachePassthroughPrefixes = [
    'attendance:batch-job:',
    'warnings:class-view:',
    'warning:processing:student:',
  ];

  constructor(private configService: ConfigService) {
    const { displayUrl, options } = buildRedisOptions(configService);

    super({
      ...options,
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.error(`Redis 连接失败，已重试 ${times} 次`);
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.on('connect', () => {
      this.logger.log(`Redis 连接成功: ${displayUrl}`);
    });

    this.on('error', (err) => {
      this.logger.error(`Redis 连接错误: ${err.message}`);
    });

    // 尝试连接
    this.connect().catch((err) => {
      this.logger.warn(`Redis 初始连接失败: ${err.message}，将在首次使用时重试`);
    });
  }

  async onModuleDestroy() {
    await this.quit();
    this.logger.log('Redis 连接已关闭');
  }

  /**
   * 设置带 TTL 的缓存
   */
  async setCache(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    if (!this.shouldUseCache(key)) {
      return;
    }
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.setex(key, ttlSeconds, serialized);
  }

  /**
   * 获取缓存
   */
  async getCache<T = any>(key: string): Promise<T | null> {
    if (!this.shouldUseCache(key)) {
      return null;
    }
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  /**
   * 删除缓存
   */
  async delCache(key: string): Promise<void> {
    if (!this.shouldUseCache(key)) {
      return;
    }
    await this.del(key);
  }

  /**
   * 模糊删除缓存 (支持通配符)
   */
  async delCachePattern(pattern: string): Promise<void> {
    if (!this.shouldUseCache(pattern)) {
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        try {
          await this.unlink(...keys);
        } catch {
          await this.del(...keys);
        }
      }
    } while (cursor !== '0');
  }

  private shouldUseCache(key: string) {
    const normalizedKey = String(key || '').trim();
    return this.cachePassthroughPrefixes.some((prefix) => normalizedKey.startsWith(prefix));
  }

  /**
   * 分布式锁 (SET NX + PX)
   * @param key 锁键
   * @param ttlMs 锁过期时间（毫秒）
   * @param value 可选值，用于安全释放
   * @returns true = 获取锁成功, false = 锁已被占用
   */
  async acquireLock(key: string, ttlMs: number, value?: string): Promise<boolean> {
    const lockValue = value || `${process.pid}:${Date.now()}`;
    const result = await this.set(key, lockValue, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  /**
   * 释放分布式锁（仅当值匹配时释放，防止误删他人锁）
   */
  async releaseLock(key: string, value: string): Promise<boolean> {
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.eval(script, 1, key, value);
      return Number(result) === 1;
    } catch (error: any) {
      this.logger.warn(`释放锁失败 key=${key}: ${error?.message || error}`);
      return false;
    }
  }

  /**
   * 带锁执行任务（分布式互斥）
   * @param key 锁键
   * @param ttlMs 锁过期时间
   * @param fn 要执行的任务
   * @returns 任务结果；如果未获取到锁则返回 null
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<{ locked: boolean; result?: T }> {
    const lockValue = `${process.pid}:${Date.now()}`;
    const acquireStart = Date.now();
    const locked = await this.acquireLock(key, ttlMs, lockValue);
    const acquireMs = Date.now() - acquireStart;
    if (!locked) {
      return { locked: false };
    }
    let fnError: unknown;
    let fnDurationMs = 0;
    let fnFinishedAt = 0;
    try {
      const fnStart = Date.now();
      const result = await fn();
      fnFinishedAt = Date.now();
      fnDurationMs = fnFinishedAt - fnStart;
      return { locked: true, result };
    } catch (error) {
      fnFinishedAt = Date.now();
      fnDurationMs = fnFinishedAt - acquireStart;
      fnError = error;
      throw error;
    } finally {
      const beforeReleaseAt = Date.now();
      const releaseStartedAfterFnMs = fnFinishedAt > 0 ? beforeReleaseAt - fnFinishedAt : beforeReleaseAt - acquireStart;
      const releaseStart = Date.now();
      await this.releaseLock(key, lockValue);
      const releaseMs = Date.now() - releaseStart;
      if (acquireMs > 100 || releaseMs > 100 || releaseStartedAfterFnMs > 100) {
        const outcome = fnError ? 'error' : 'ok';
        console.log(`[withLock] key=${key} acquire=${acquireMs}ms fn=${fnDurationMs}ms preReleaseGap=${releaseStartedAfterFnMs}ms release=${releaseMs}ms outcome=${outcome}`);
      }
    }
  }
}

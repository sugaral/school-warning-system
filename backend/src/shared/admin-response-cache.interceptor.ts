import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, of } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { RedisService } from './redis.service';

@Injectable()
export class AdminResponseCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminResponseCacheInterceptor.name);
  private readonly enabled = process.env.ADMIN_RESPONSE_CACHE_ENABLED === '1';
  private readonly ttlSeconds = Math.min(
    300,
    Math.max(5, Number(process.env.ADMIN_RESPONSE_CACHE_TTL_SECONDS || 20)),
  );
  private readonly maxPayloadBytes = Math.min(
    512 * 1024,
    Math.max(8 * 1024, Number(process.env.ADMIN_RESPONSE_CACHE_MAX_BYTES || 256 * 1024)),
  );
  private readonly bypassPathMatchers = [
    /^\/?health(?:\/|$)/i,
    /^\/?auth(?:\/|$)/i,
    /^\/?files(?:\/|$)/i,
    /^\/?uploads(?:\/|$)/i,
    /\/download(?:\/|$)/i,
    /^\/?attendance\/batch-jobs\/.+/i,
    /^\/?attendance\/sessions(?:\/|$)/i,
    /^\/?attendance\/session-options(?:\/|$)/i,
    /^\/?jobs\/scan-status(?:\/|$)/i,
    /^\/?warnings\/class-view(?:\/|$)/i,
    /\/qr-state(?:\/|$)/i,
    /\/captcha(?:\/|$)/i,
  ];

  constructor(private readonly redis: RedisService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.enabled) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest();
    const method = String(request?.method || 'GET').trim().toUpperCase();
    const path = this.normalizePath(request?.originalUrl || request?.url || request?.path || '');

    if (this.shouldBypass(method, path, request)) {
      return next.handle();
    }

    if (method === 'GET') {
      return from(this.buildCacheContext(request, path)).pipe(
        switchMap((cacheContext) => {
          const startedAt = Date.now();
          return from(this.redis.getCache<any>(cacheContext.cacheKey)).pipe(
            switchMap((cached) => {
              if (cached) {
                this.logger.log(
                  `[管理缓存] 命中 域=${cacheContext.domains.join(',')} 耗时=${Date.now() - startedAt}ms 路径=${path}`,
                );
                return of(cached);
              }

              this.logger.log(
                `[管理缓存] 未命中 域=${cacheContext.domains.join(',')} 耗时=${Date.now() - startedAt}ms 路径=${path}`,
              );
              const sourceStartedAt = Date.now();
              return next.handle().pipe(
                tap((response) => {
                  void this.storeResponse(cacheContext.cacheKey, response, path, sourceStartedAt);
                }),
              );
            }),
          );
        }),
      );
    }

    return next.handle().pipe(
      tap((response) => {
        void this.bumpVersionsIfNeeded(path, response);
      }),
    );
  }

  private shouldBypass(method: string, path: string, request: any) {
    if (method === 'OPTIONS') {
      return true;
    }

    if (request?.query?.no_cache === '1') {
      return true;
    }

    return this.bypassPathMatchers.some((matcher) => matcher.test(path));
  }

  private normalizePath(value: string) {
    return `/${String(value || '')
      .trim()
      .replace(/^\/+/, '')
      .replace(/\?.*$/, '')}`;
  }

  private normalizeForKey(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeForKey(item));
    }
    if (typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce<Record<string, any>>((accumulator, key) => {
          accumulator[key] = this.normalizeForKey(value[key]);
          return accumulator;
        }, {});
    }
    return value;
  }

  private resolveDomains(path: string) {
    const segments = path.split('/').filter(Boolean);
    const first = segments[0] || 'root';
    const domain = first === 'admin' ? segments[1] || 'admin' : first;
    const domains = new Set<string>([domain]);

    if (['attendance', 'teacher', 'jobs', 'requests', 'warning-rules'].includes(domain)) {
      domains.add('warnings');
    }

    if (domain === 'warnings') {
      domains.add('warnings');
    }

    return Array.from(domains);
  }

  private async buildCacheContext(request: any, path: string) {
    const domains = this.resolveDomains(path);
    const versions = await Promise.all(
      domains.map(async (domain) => {
        try {
          return (await this.redis.get(this.buildVersionKey(domain))) || '0';
        } catch {
          return '0';
        }
      }),
    );
    const keyPayload = {
      path,
      query: this.normalizeForKey(request?.query || {}),
      user: String(request?.user?.userId || request?.user?.sub || ''),
      roles: this.normalizeForKey(request?.user?.roles || []),
      data_scope: this.normalizeForKey(request?.dataScope || {}),
      versions,
    };

    return {
      domains,
      cacheKey: `admin:response-cache:v1:${encodeURIComponent(JSON.stringify(keyPayload))}`,
    };
  }

  private async storeResponse(cacheKey: string, response: any, path: string, startedAt: number) {
    try {
      if (!response || typeof response !== 'object' || Number(response.code) !== 0) {
        return;
      }

      const serialized = JSON.stringify(response);
      if (Buffer.byteLength(serialized, 'utf8') > this.maxPayloadBytes) {
        this.logger.log(
          `[管理缓存] 跳过大尺寸 耗时=${Date.now() - startedAt}ms 字节=${Buffer.byteLength(serialized, 'utf8')} 路径=${path}`,
        );
        return;
      }

      await this.redis.setCache(cacheKey, response, this.ttlSeconds);
      this.logger.log(
        `[管理缓存] 设置 耗时=${Date.now() - startedAt}ms 有效期=${this.ttlSeconds}秒 路径=${path}`,
      );
    } catch (error) {
      this.logger.warn(
        `[管理缓存] 设置失败 路径=${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildVersionKey(domain: string) {
    return `admin:response-cache:version:${domain}`;
  }

  private async bumpVersionsIfNeeded(path: string, response: any) {
    if (!response || typeof response !== 'object' || Number(response.code) !== 0) {
      return;
    }

    const domains = this.resolveDomains(path);
    try {
      await Promise.all(
        domains.map((domain) => this.redis.incr(this.buildVersionKey(domain))),
      );
      this.logger.log(`[管理缓存] 续期 域=${domains.join(',')} 路径=${path}`);
    } catch (error) {
      this.logger.warn(
        `[管理缓存] 续期失败 路径=${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

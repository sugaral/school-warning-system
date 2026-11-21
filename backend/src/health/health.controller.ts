import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { MinioService } from '../shared/minio.service';
import { PrismaService } from '../shared/prisma.service';
import { RedisService } from '../shared/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly minioService: MinioService,
  ) {}

  private async checkDatabasePing(timeoutMs = 1000) {
    let timer: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('db health timeout')), timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  @Get('/health')
  async getHealth() {
    const dbConnected = await this.checkDatabasePing(1000);

    return {
      code: 0,
      message: dbConnected ? 'ok' : 'degraded',
      data: {
        status: dbConnected ? 'ok' : 'degraded',
        database: dbConnected ? 'connected' : 'disconnected',
        redis: this.redis.status || 'unknown',
        minio: this.minioService.isConfigured() ? 'configured' : 'disabled',
      },
      trace_id: (global as any).currentTraceId ?? null,
    };
  }

  @Get('/ready')
  async getReady() {
    const dbConnected = await this.checkDatabasePing(1000);

    const redisReady = this.redis.status === 'ready';
    if (!dbConnected || !redisReady) {
      throw new ServiceUnavailableException({
        code: 503,
        message: 'service unavailable',
        data: {
          database: dbConnected ? 'connected' : 'disconnected',
          redis: this.redis.status || 'unknown',
        },
      });
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        status: 'ready',
        database: 'connected',
        redis: 'ready',
      },
      trace_id: (global as any).currentTraceId ?? null,
    };
  }
}


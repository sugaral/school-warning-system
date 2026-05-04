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

  @Get('/health')
  async getHealth() {
    const dbHealthy = await this.prisma.checkHealth();
    const redisHealthy = (await this.redis.ping().catch(() => '')) === 'PONG';
    const minioHealth = await this.minioService.checkHealth();

    if (!dbHealthy || !redisHealthy || !minioHealth.healthy) {
      throw new ServiceUnavailableException('dependency unavailable');
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        status: 'ok',
        database: 'ok',
        redis: 'ok',
        minio: minioHealth.enabled ? 'ok' : 'disabled',
      },
      trace_id: (global as any).currentTraceId ?? null,
    };
  }
}


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
    return {
      code: 0,
      message: 'ok',
      data: {
        status: 'ok',
        database: this.prisma.isConnected ? 'connected' : 'unknown',
        redis: this.redis.status || 'unknown',
        minio: this.minioService.isConfigured() ? 'configured' : 'disabled',
      },
      trace_id: (global as any).currentTraceId ?? null,
    };
  }
}


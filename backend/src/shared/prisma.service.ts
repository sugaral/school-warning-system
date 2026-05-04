import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

function buildDatabaseUrlWithPoolDefaults() {
  const rawUrl = String(process.env.DATABASE_URL || '').trim();
  if (!rawUrl) {
    return undefined;
  }

  try {
    const parsed = new URL(rawUrl);

    if (!parsed.searchParams.get('connection_limit')) {
      parsed.searchParams.set(
        'connection_limit',
        String(Math.min(60, Math.max(12, Number(process.env.PRISMA_CONNECTION_LIMIT || 30)))),
      );
    }

    if (!parsed.searchParams.get('pool_timeout')) {
      parsed.searchParams.set(
        'pool_timeout',
        String(Math.min(60, Math.max(10, Number(process.env.PRISMA_POOL_TIMEOUT_SECONDS || 30)))),
      );
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private isConnected = false;
  private readonly healthCheckTimeoutMs = 3000;
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const databaseUrl = buildDatabaseUrlWithPoolDefaults();
    super({
      log: ['warn', 'error'],
      datasources: databaseUrl
        ? {
            db: {
              url: databaseUrl,
            },
          }
        : undefined,
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.isConnected = true;
    } catch (error) {
      this.logger.error('连接数据库失败:', error);
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (error) {
      this.logger.error('断开数据库连接失败:', error);
    }
  }

  async ensureConnected() {
    if (!this.isConnected) {
      await this.checkHealthOrThrow();
    }
  }

  private async checkHealthOrThrow() {
    try {
      await Promise.race([
        this.$queryRawUnsafe('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`数据库健康检查超时（${this.healthCheckTimeoutMs}ms）`)),
            this.healthCheckTimeoutMs,
          ),
        ),
      ]);
      this.isConnected = true;
    } catch (error) {
      this.isConnected = false;
      this.logger.error('数据库健康检查失败:', error);
      throw error;
    }
  }

  async checkHealth() {
    try {
      await this.checkHealthOrThrow();
      return this.isConnected;
    } catch {
      return false;
    }
  }
}

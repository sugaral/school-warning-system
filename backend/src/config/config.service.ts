import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../shared/prisma.service';

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  // 进程内 L1 缓存（热数据，极短 TTL）
  private l1Cache: Map<string, any> = new Map();
  private lastL1FetchTime: number = 0;
  private readonly l1CacheTTL = 30_000; // 30 秒进程内缓存
  private loadingPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getConfig(key: string, defaultValue: any = null): Promise<any> {
    await this.ensureCacheReady();

    const resolvedValue = this.resolveConfigValue(key);
    return resolvedValue === undefined ? defaultValue : resolvedValue;
  }

  async getSectionConfig(
    key: string,
    defaultValue: any = null,
    legacyKeys: string[] = [],
  ): Promise<any> {
    await this.ensureCacheReady();

    const l1Value = this.l1Cache.get(key);
    if (l1Value !== undefined) return l1Value;

    for (const legacyKey of legacyKeys) {
      const v = this.l1Cache.get(legacyKey);
      if (v !== undefined) return v;
    }

    return defaultValue;
  }

  async getNumberConfig(key: string, defaultValue: number): Promise<number> {
    const value = await this.getConfig(key, defaultValue);
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  private async ensureCacheReady() {
    const now = Date.now();
    if (this.l1Cache.size > 0 && now - this.lastL1FetchTime <= this.l1CacheTTL) {
      return;
    }

    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = this.reloadFromDb()
      .catch((error) => {
        this.logger.error('加载配置失败:', error);
      })
      .finally(() => {
        this.loadingPromise = null;
      });

    await this.loadingPromise;
  }

  private resolveConfigValue(key: string) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      return undefined;
    }

    if (this.l1Cache.has(normalizedKey)) {
      return this.l1Cache.get(normalizedKey);
    }

    const segments = normalizedKey.split('.').filter(Boolean);
    if (segments.length <= 1) {
      return undefined;
    }

    const [rootKey, ...path] = segments;
    if (!this.l1Cache.has(rootKey)) {
      return undefined;
    }

    let currentValue = this.l1Cache.get(rootKey);
    for (const segment of path) {
      if (
        currentValue === null ||
        currentValue === undefined ||
        typeof currentValue !== 'object' ||
        !(segment in currentValue)
      ) {
        return undefined;
      }

      currentValue = currentValue[segment];
    }

    return currentValue;
  }

  private async reloadFromDb() {
    try {
      await this.prisma.ensureConnected();
      const settings = await this.prisma.system_settings.findMany();

      const freshCache: Record<string, any> = {};
      for (const setting of settings) {
        try {
          freshCache[setting.setting_key] = JSON.parse(setting.setting_val);
        } catch {
          freshCache[setting.setting_key] = setting.setting_val;
        }
      }

      this.l1Cache = new Map(Object.entries(freshCache));
      this.lastL1FetchTime = Date.now();

      this.logger.log('配置已从数据库重新加载');
    } catch (error) {
      this.logger.error('加载配置失败:', error);
      if (this.l1Cache.size > 0) {
        this.lastL1FetchTime = Date.now();
      }
    }
  }

  async clearCache() {
    this.l1Cache.clear();
    this.lastL1FetchTime = 0;
  }
}

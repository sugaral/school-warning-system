import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../shared/redis.service';

type WarningProcessingState = {
  status: 'processing' | 'failed';
  text: string;
  updated_at: string;
};

@Injectable()
export class WarningProcessingService {
  private readonly ttlSeconds = 300;
  private readonly logger = new Logger(WarningProcessingService.name);

  constructor(private readonly redis: RedisService) {}

  async markStudentProcessing(studentId: bigint | string, text: string) {
    const key = this.buildStudentKey(studentId);
    const payload: WarningProcessingState = {
      status: 'processing',
      text,
      updated_at: new Date().toISOString(),
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', this.ttlSeconds);
  }

  async markStudentFailed(studentId: bigint | string, text: string) {
    const key = this.buildStudentKey(studentId);
    const payload: WarningProcessingState = {
      status: 'failed',
      text,
      updated_at: new Date().toISOString(),
    };
    await this.redis.set(key, JSON.stringify(payload), 'EX', 120);
  }

  async clearStudentProcessing(studentId: bigint | string) {
    await this.redis.del(this.buildStudentKey(studentId));
  }

  async getStudentProcessingMap(values: Array<bigint | string | number | null | undefined>) {
    const studentIds = Array.from(
      new Map(
        values
          .filter((value) => value !== null && value !== undefined && value !== '')
          .map((value) => [String(value), String(value)]),
      ).values(),
    );
    if (studentIds.length === 0) {
      return new Map<string, WarningProcessingState>();
    }

    const map = new Map<string, WarningProcessingState>();
    const startedAt = Date.now();

    try {
      const keys = studentIds.map((studentId) => this.buildStudentKey(studentId));
      const rawValues = await this.mgetWithTimeout(keys, 50);
      for (let i = 0; i < studentIds.length; i++) {
        const raw = rawValues[i];
        if (!raw) {
          continue;
        }
        try {
          const parsed = JSON.parse(raw) as WarningProcessingState;
          if (!parsed?.status || !parsed?.text) {
            continue;
          }
          map.set(studentIds[i], parsed);
        } catch {
          // ignore invalid cache payload
        }
      }
    } catch (error: any) {
      this.logger.warn(`getStudentProcessingMap degraded: ${error?.message || error}`);
    }

    const durationMs = Date.now() - startedAt;
    if (durationMs > 100) {
      this.logger.warn(
        `[warning-processing] processing-map slow ${durationMs}ms students=${studentIds.length}`,
      );
    }

    return map;
  }

  private async mgetWithTimeout(keys: string[], timeoutMs: number) {
    return await Promise.race<Array<string | null>>([
      this.redis.mget(...keys),
      new Promise<Array<string | null>>((resolve) => setTimeout(() => resolve(keys.map(() => null)), timeoutMs)),
    ]);
  }

  private buildStudentKey(studentId: bigint | string | number) {
    return `warning:processing:student:${String(studentId)}`;
  }
}

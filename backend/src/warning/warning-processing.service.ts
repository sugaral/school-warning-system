import { Injectable } from '@nestjs/common';
import { RedisService } from '../shared/redis.service';

type WarningProcessingState = {
  status: 'processing' | 'failed';
  text: string;
  updated_at: string;
};

@Injectable()
export class WarningProcessingService {
  private readonly ttlSeconds = 300;

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

    const keys = studentIds.map((studentId) => this.buildStudentKey(studentId));
    const valuesRaw = await this.redis.mget(...keys);
    const map = new Map<string, WarningProcessingState>();

    valuesRaw.forEach((raw, index) => {
      if (!raw) {
        return;
      }

      try {
        const parsed = JSON.parse(raw) as WarningProcessingState;
        if (!parsed?.status || !parsed?.text) {
          return;
        }
        map.set(studentIds[index], parsed);
      } catch {
        // ignore invalid cache payload
      }
    });

    return map;
  }

  private buildStudentKey(studentId: bigint | string | number) {
    return `warning:processing:student:${String(studentId)}`;
  }
}

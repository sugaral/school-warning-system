import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { MinioService } from '../shared/minio.service';
import { RedisService } from '../shared/redis.service';
import { WarningService } from './warning.service';
import {
  WarningQueueItem,
  WarningQueuePayload,
  WarningRecalcTarget,
} from './warning.types';

type QueueScheduleResult = {
  mode: 'noop' | 'queued' | 'sync_fallback';
  warnings_generated: number;
  warnings_enqueued: number;
  warnings_deduped: number;
  targets_merged: number;
  targets_locked: number;
};

type StreamEntry = {
  id: string;
  fields: Record<string, string>;
};

@Injectable()
export class WarningQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WarningQueueService.name);
  private readonly consumerName = `${hostname() || 'backend'}-${process.pid}`;
  private running = false;
  private consumerLoop: Promise<void> | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly minioService: MinioService,
    private readonly warningService: WarningService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (!this.isConsumerEnabled()) {
      this.logger.warn('预警队列消费者已被配置禁用。');
      return;
    }

    this.running = true;
    this.consumerLoop = this.runConsumerLoop();
  }

  async onModuleDestroy() {
    this.running = false;
    await this.consumerLoop?.catch(() => undefined);
  }

  async scheduleAffectedRecords(
    records: WarningRecalcTarget[],
    source = 'warning.recalc',
  ): Promise<QueueScheduleResult> {
    const mergedItems = this.mergeQueueItems(records);
    if (mergedItems.length === 0) {
      return {
        mode: 'noop',
        warnings_generated: 0,
        warnings_enqueued: 0,
        warnings_deduped: 0,
        targets_merged: 0,
        targets_locked: 0,
      };
    }

    const targetsMerged = Math.max(0, records.length - mergedItems.length);

    try {
      const result = await this.enqueueItems(mergedItems, source);
      return {
        mode: 'queued',
        warnings_generated: 0,
        warnings_enqueued: result.enqueued,
        warnings_deduped: result.deduped,
        targets_merged: targetsMerged,
        targets_locked: 0,
      };
    } catch (error: any) {
      this.logger.error(
        `[预警队列] 入队失败，回退到同步重算：${error?.message || String(error)}`,
        error?.stack,
      );

      const fallbackResult = await this.warningService.generateWarningsForAffectedRecords(
        mergedItems.map((item) => ({
          studentId: BigInt(item.studentId),
          recordDate: this.parseRecordDate(item.recordDate),
          courseId: this.parseOptionalBigInt(item.courseId),
          sessionId: this.parseOptionalBigInt(item.sessionId),
        })),
      );

      return {
        mode: 'sync_fallback',
        warnings_generated: Number(fallbackResult?.warnings_generated || 0),
        warnings_enqueued: 0,
        warnings_deduped: 0,
        targets_merged: targetsMerged,
        targets_locked: Number(fallbackResult?.targets_locked || 0),
      };
    }
  }

  getQueueStatus() {
    return {
      enabled: this.isConsumerEnabled(),
      stream: this.getStreamKey(),
      group: this.getConsumerGroup(),
      consumer: this.consumerName,
      snapshot_bucket: this.minioService.getWarningQueueSnapshotBucket(),
      dlq_bucket: this.minioService.getWarningQueueDlqBucket(),
    };
  }

  private async runConsumerLoop() {
    while (this.running) {
      try {
        await this.ensureConsumerGroup();

        const claimedEntries = await this.claimStaleEntries();
        if (claimedEntries.length > 0) {
          await this.processEntries(claimedEntries);
          continue;
        }

        const newEntries = await this.readNewEntries();
        if (newEntries.length === 0) {
          continue;
        }

        await this.processEntries(newEntries);
      } catch (error: any) {
        this.logger.error(
          `[预警队列] 消费者循环失败：${error?.message || String(error)}`,
          error?.stack,
        );
        await this.sleep(1000);
      }
    }
  }

  private async processEntries(entries: StreamEntry[]) {
    if (entries.length === 0) {
      return;
    }

    const concurrency = Math.min(this.getConsumerConcurrency(), entries.length);
    let nextIndex = 0;

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= entries.length) {
            return;
          }

          await this.processEntry(entries[currentIndex]);
        }
      }),
    );
  }

  private async enqueueItems(items: WarningQueueItem[], source: string) {
    if (items.length === 0) {
      return { enqueued: 0, deduped: 0 };
    }

    await this.ensureConsumerGroup();

    const ttlSeconds = this.getPendingTtlSeconds();
    const acceptedItems: WarningQueueItem[] = [];
    const acceptedKeys: string[] = [];
    let deduped = 0;

    for (const item of items) {
      const dedupeKey = this.buildPendingKey(item);
      const result = await this.redis.set(
        dedupeKey,
        JSON.stringify({ source, enqueued_at: new Date().toISOString() }),
        'EX',
        ttlSeconds,
        'NX',
      );

      if (result === 'OK') {
        acceptedItems.push(item);
        acceptedKeys.push(dedupeKey);
      } else {
        deduped += 1;
      }
    }

    if (acceptedItems.length === 0) {
      return { enqueued: 0, deduped };
    }

    const payload: WarningQueuePayload = {
      version: 1,
      source,
      enqueuedAt: new Date().toISOString(),
      items: acceptedItems,
    };

    try {
      const fields = await this.buildMessageFields(payload, 0, '');
      await this.addToStream(this.getStreamKey(), fields, this.getStreamMaxLen());
      return {
        enqueued: acceptedItems.length,
        deduped,
      };
    } catch (error) {
      if (acceptedKeys.length > 0) {
        await this.redis.del(...acceptedKeys);
      }
      throw error;
    }
  }

  private async processEntry(entry: StreamEntry) {
    const payload = await this.resolvePayload(entry.fields);

    try {
      await this.warningService.generateWarningsForAffectedRecords(
        payload.items.map((item) => ({
          studentId: BigInt(item.studentId),
          recordDate: this.parseRecordDate(item.recordDate),
          courseId: this.parseOptionalBigInt(item.courseId),
          sessionId: this.parseOptionalBigInt(item.sessionId),
        })),
      );

      await this.clearPendingKeys(payload.items);
      await this.ackAndDelete(entry.id);
    } catch (error: any) {
      await this.handleProcessingFailure(entry, payload, error);
    }
  }

  private async handleProcessingFailure(
    entry: StreamEntry,
    payload: WarningQueuePayload,
    error: unknown,
  ) {
    const retryCount = Math.max(0, Number(entry.fields.retry_count || 0));
    const nextRetryCount = retryCount + 1;
    const retryLimit = this.getRetryLimit();
    const lastError = this.truncateError(error);

    if (nextRetryCount >= retryLimit) {
      await this.archiveToDlq(payload, lastError, nextRetryCount, entry.id);
      await this.clearPendingKeys(payload.items);
      await this.ackAndDelete(entry.id);
      return;
    }

    const retryFields = await this.buildMessageFields(payload, nextRetryCount, lastError);
    await this.addToStream(this.getStreamKey(), retryFields, this.getStreamMaxLen());
    await this.ackAndDelete(entry.id);

    this.logger.warn(
      `[预警队列] 消息 ${entry.id} 已重新入队，重试 ${nextRetryCount}/${retryLimit}`,
    );
  }

  private async archiveToDlq(
    payload: WarningQueuePayload,
    lastError: string,
    retryCount: number,
    originMessageId: string,
  ) {
    const dlqPayload = {
      payload,
      error: lastError,
      retry_count: retryCount,
      origin_message_id: originMessageId,
      failed_at: new Date().toISOString(),
    };

    const fields = await this.buildDlqFields(dlqPayload);
    await this.addToStream(this.getDlqStreamKey(), fields, this.getDlqStreamMaxLen());

    this.logger.error(
      `[预警队列] 消息 ${originMessageId} 在 ${retryCount} 次尝试后已移至死信队列：${lastError}`,
    );
  }

  private async buildDlqFields(payload: Record<string, unknown>): Promise<Record<string, string>> {
    const json = JSON.stringify(payload);
    const dlqItemCount = Array.isArray((payload.payload as any)?.items)
      ? (payload.payload as any).items.length
      : 1;

    if (this.shouldUseSnapshot(json, dlqItemCount)) {
      const bucket = this.minioService.getWarningQueueDlqBucket();
      const key = this.buildSnapshotKey('dlq');
      await this.minioService.putJson(bucket, key, payload, {
        'x-warning-queue': 'dlq',
      });

      return {
        payload_mode: 'snapshot',
        snapshot_bucket: bucket,
        snapshot_key: key,
        failed_at: new Date().toISOString(),
      };
    }

    return {
      payload_mode: 'inline',
      payload_json: json,
      failed_at: new Date().toISOString(),
    };
  }

  private async resolvePayload(fields: Record<string, string>) {
    const mode = String(fields.payload_mode || 'inline').trim().toLowerCase();

    if (mode === 'snapshot') {
      const buffer = await this.minioService.getBuffer(
        String(fields.snapshot_bucket || '').trim(),
        String(fields.snapshot_key || '').trim(),
      );
      return this.parsePayloadJson(buffer.toString('utf8'));
    }

    return this.parsePayloadJson(String(fields.payload_json || '{}'));
  }

  private parsePayloadJson(json: string): WarningQueuePayload {
    const parsed = JSON.parse(json || '{}') as WarningQueuePayload;
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .map((item) => ({
            studentId: String(item?.studentId || '').trim(),
            recordDate: String(item?.recordDate || '').trim(),
            courseId: this.normalizeOptionalNumericString(item?.courseId),
            sessionId: this.normalizeOptionalNumericString(item?.sessionId),
          }))
          .filter((item) => /^\d+$/.test(item.studentId) && /^\d{4}-\d{2}-\d{2}$/.test(item.recordDate))
      : [];

    return {
      version: Number(parsed.version || 1),
      source: String(parsed.source || 'warning.recalc'),
      enqueuedAt: String(parsed.enqueuedAt || new Date().toISOString()),
      items,
    };
  }

  private async buildMessageFields(
    payload: WarningQueuePayload,
    retryCount: number,
    lastError: string,
  ): Promise<Record<string, string>> {
    const payloadJson = JSON.stringify(payload);
    const itemCount = payload.items.length;

    if (this.shouldUseSnapshot(payloadJson, itemCount)) {
      const bucket = this.minioService.getWarningQueueSnapshotBucket();
      const key = this.buildSnapshotKey('queue');
      await this.minioService.putJson(bucket, key, payload, {
        'x-warning-queue': 'recalc',
      });

      return {
        payload_mode: 'snapshot',
        snapshot_bucket: bucket,
        snapshot_key: key,
        source: payload.source,
        item_count: String(itemCount),
        retry_count: String(retryCount),
        enqueued_at: payload.enqueuedAt,
        last_error: lastError,
      };
    }

    return {
      payload_mode: 'inline',
      payload_json: payloadJson,
      source: payload.source,
      item_count: String(itemCount),
      retry_count: String(retryCount),
      enqueued_at: payload.enqueuedAt,
      last_error: lastError,
    };
  }

  private shouldUseSnapshot(payloadJson: string, itemCount: number) {
    if (!this.minioService.isConfigured()) {
      return false;
    }

    return (
      itemCount >= this.getInlineMaxItems() ||
      Buffer.byteLength(payloadJson, 'utf8') >= this.getInlineMaxBytes()
    );
  }

  private async readNewEntries() {
    const raw = await this.redis.call(
      'XREADGROUP',
      'GROUP',
      this.getConsumerGroup(),
      this.consumerName,
      'COUNT',
      String(this.getReadCount()),
      'BLOCK',
      String(this.getReadBlockMs()),
      'STREAMS',
      this.getStreamKey(),
      '>',
    );

    return this.parseReadEntries(raw);
  }

  private async claimStaleEntries() {
    const raw = await this.redis.call(
      'XAUTOCLAIM',
      this.getStreamKey(),
      this.getConsumerGroup(),
      this.consumerName,
      String(this.getVisibilityTimeoutMs()),
      '0-0',
      'COUNT',
      String(this.getClaimCount()),
    );

    const xAutoClaimResult = raw as any[];
    const entries = Array.isArray(xAutoClaimResult?.[1]) ? xAutoClaimResult[1] : [];
    return entries.map((item: any) => ({
      id: String(item?.[0] || ''),
      fields: this.parseFieldList(item?.[1] || []),
    }));
  }

  private parseReadEntries(raw: any): StreamEntry[] {
    const streams = Array.isArray(raw) ? raw : [];
    const entries: StreamEntry[] = [];

    for (const stream of streams) {
      const messages = Array.isArray(stream?.[1]) ? stream[1] : [];
      for (const message of messages) {
        entries.push({
          id: String(message?.[0] || ''),
          fields: this.parseFieldList(message?.[1] || []),
        });
      }
    }

    return entries;
  }

  private parseFieldList(fields: any[]) {
    const result: Record<string, string> = {};

    for (let index = 0; index < fields.length; index += 2) {
      const key = String(fields[index] || '').trim();
      if (!key) {
        continue;
      }
      result[key] = String(fields[index + 1] || '');
    }

    return result;
  }

  private async ensureConsumerGroup() {
    try {
      await this.redis.call(
        'XGROUP',
        'CREATE',
        this.getStreamKey(),
        this.getConsumerGroup(),
        '0',
        'MKSTREAM',
      );
    } catch (error: any) {
      if (!String(error?.message || '').includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  private async addToStream(
    streamKey: string,
    fields: Record<string, string>,
    maxLen: number,
  ) {
    const flatFields = Object.entries(fields).flatMap(([key, value]) => [key, value]);
    await this.redis.call(
      'XADD',
      streamKey,
      'MAXLEN',
      '~',
      String(maxLen),
      '*',
      ...flatFields,
    );
  }

  private async ackAndDelete(messageId: string) {
    await this.redis.call('XACK', this.getStreamKey(), this.getConsumerGroup(), messageId);
    await this.redis.call('XDEL', this.getStreamKey(), messageId);
  }

  private async clearPendingKeys(items: WarningQueueItem[]) {
    const keys = items.map((item) => this.buildPendingKey(item));
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  private mergeQueueItems(records: WarningRecalcTarget[]) {
    const merged = new Map<string, WarningQueueItem>();

    for (const record of records) {
      if (!(record?.recordDate instanceof Date) || Number.isNaN(record.recordDate.getTime())) {
        continue;
      }

      const dateKey = record.recordDate.toISOString().slice(0, 10);
      const courseId = record.courseId?.toString?.();
      const sessionId = record.sessionId?.toString?.();
      const itemKey = [
        record.studentId.toString(),
        dateKey,
        courseId || '',
        sessionId || '',
      ].join('_');

      merged.set(itemKey, {
        studentId: record.studentId.toString(),
        recordDate: dateKey,
        ...(courseId ? { courseId } : {}),
        ...(sessionId ? { sessionId } : {}),
      });
    }

    return Array.from(merged.values());
  }

  private buildPendingKey(item: WarningQueueItem) {
    const coursePart = item.courseId ? `:${item.courseId}` : '';
    const sessionPart = item.sessionId ? `:${item.sessionId}` : '';
    return `warning:queue:pending:${item.studentId}:${item.recordDate}${coursePart}${sessionPart}`;
  }

  private parseRecordDate(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private normalizeOptionalNumericString(value: unknown) {
    const normalized = String(value || '').trim();
    return /^\d+$/.test(normalized) ? normalized : undefined;
  }

  private parseOptionalBigInt(value?: string) {
    if (!value || !/^\d+$/.test(String(value).trim())) {
      return undefined;
    }

    return BigInt(value);
  }

  private buildSnapshotKey(kind: 'queue' | 'dlq') {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `warning-queue/${kind}/${year}/${month}/${day}/${Date.now()}-${randomUUID()}.json`;
  }

  private truncateError(error: unknown) {
    return String((error as any)?.message || error || '').trim().slice(0, 500);
  }

  private isConsumerEnabled() {
    return !['false', '0', 'no', 'off'].includes(
      String(this.config.get<string>('WARNING_QUEUE_CONSUMER_ENABLED') || 'true')
        .trim()
        .toLowerCase(),
    );
  }

  private getStreamKey() {
    return String(this.config.get<string>('WARNING_QUEUE_STREAM_KEY') || 'stream:warning:recalc');
  }

  private getDlqStreamKey() {
    return String(
      this.config.get<string>('WARNING_QUEUE_DLQ_STREAM_KEY') || 'stream:warning:recalc:dlq',
    );
  }

  private getConsumerGroup() {
    return String(this.config.get<string>('WARNING_QUEUE_GROUP') || 'warning-recalc-group');
  }

  private getPendingTtlSeconds() {
    return this.getClampedNumber('WARNING_QUEUE_PENDING_TTL_SECONDS', 900, 60, 86400);
  }

  private getRetryLimit() {
    return this.getClampedNumber('WARNING_QUEUE_RETRY_LIMIT', 5, 1, 20);
  }

  private getReadCount() {
    return this.getClampedNumber('WARNING_QUEUE_READ_COUNT', 10, 1, 100);
  }

  private getConsumerConcurrency() {
    return this.getClampedNumber('WARNING_QUEUE_CONSUMER_CONCURRENCY', 4, 1, 16);
  }

  private getClaimCount() {
    return this.getClampedNumber('WARNING_QUEUE_CLAIM_COUNT', 10, 1, 100);
  }

  private getReadBlockMs() {
    return this.getClampedNumber('WARNING_QUEUE_READ_BLOCK_MS', 5000, 100, 60000);
  }

  private getVisibilityTimeoutMs() {
    return this.getClampedNumber('WARNING_QUEUE_VISIBILITY_TIMEOUT_MS', 30000, 1000, 600000);
  }

  private getInlineMaxItems() {
    return this.getClampedNumber('WARNING_QUEUE_INLINE_MAX_ITEMS', 30, 1, 1000);
  }

  private getInlineMaxBytes() {
    return this.getClampedNumber('WARNING_QUEUE_INLINE_MAX_BYTES', 8192, 1024, 1048576);
  }

  private getStreamMaxLen() {
    return this.getClampedNumber('WARNING_QUEUE_STREAM_MAXLEN', 10000, 100, 1000000);
  }

  private getDlqStreamMaxLen() {
    return this.getClampedNumber('WARNING_QUEUE_DLQ_STREAM_MAXLEN', 2000, 100, 100000);
  }

  private getClampedNumber(key: string, fallback: number, min: number, max: number) {
    const raw = Number(this.config.get<string>(key) || fallback);
    if (!Number.isFinite(raw)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(raw)));
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

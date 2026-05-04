import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import { Readable } from 'stream';

const DEFAULT_REGION = 'us-east-1';

type PutObjectInput = {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
};

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: Client | null;
  private readonly enabled: boolean;
  private readonly uploadBucket: string;
  private readonly warningQueueSnapshotBucket: string;
  private readonly warningQueueDlqBucket: string;
  private readonly ensuredBuckets = new Set<string>();

  constructor(private readonly config: ConfigService) {
    const endpoint = String(config.get<string>('MINIO_ENDPOINT') || '').trim();
    const accessKey =
      String(config.get<string>('MINIO_ACCESS_KEY') || config.get<string>('MINIO_ROOT_USER') || '').trim();
    const secretKey =
      String(config.get<string>('MINIO_SECRET_KEY') || config.get<string>('MINIO_ROOT_PASSWORD') || '').trim();
    const portValue = Number(config.get<string>('MINIO_PORT') || 9000);
    const useSSL = ['true', '1', 'yes', 'on'].includes(
      String(config.get<string>('MINIO_USE_SSL') || 'false').trim().toLowerCase(),
    );

    this.uploadBucket = String(config.get<string>('MINIO_BUCKET') || 'warnsys-files').trim();
    this.warningQueueSnapshotBucket = String(
      config.get<string>('WARNING_QUEUE_SNAPSHOT_BUCKET') || 'warnsys-warning-queue',
    ).trim();
    this.warningQueueDlqBucket = String(
      config.get<string>('WARNING_QUEUE_DLQ_BUCKET') || 'warnsys-warning-dlq',
    ).trim();

    if (!endpoint || !accessKey || !secretKey) {
      this.enabled = false;
      this.client = null;
      return;
    }

    this.enabled = true;
    this.client = new Client({
      endPoint: endpoint,
      port: Number.isFinite(portValue) ? portValue : 9000,
      useSSL,
      accessKey,
      secretKey,
    });
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('MinIO 未配置，上传将保留在本地磁盘，队列快照保持内联。');
      return;
    }

    for (const bucket of [
      this.uploadBucket,
      this.warningQueueSnapshotBucket,
      this.warningQueueDlqBucket,
    ]) {
      await this.ensureBucket(bucket);
    }
  }

  isConfigured() {
    return this.enabled;
  }

  getUploadBucket() {
    return this.uploadBucket;
  }

  getWarningQueueSnapshotBucket() {
    return this.warningQueueSnapshotBucket;
  }

  getWarningQueueDlqBucket() {
    return this.warningQueueDlqBucket;
  }

  async putBuffer(input: PutObjectInput) {
    const client = this.getClient();
    await this.ensureBucket(input.bucket);

    const metadata: Record<string, string> = {
      ...(input.metadata || {}),
    };
    if (input.contentType) {
      metadata['Content-Type'] = input.contentType;
    }

    await client.putObject(input.bucket, input.key, input.body, input.body.length, metadata);
    return {
      bucket: input.bucket,
      key: input.key,
      size: input.body.length,
    };
  }

  async putJson(
    bucket: string,
    key: string,
    value: unknown,
    metadata?: Record<string, string>,
  ) {
    const body = Buffer.from(JSON.stringify(value), 'utf8');
    return this.putBuffer({
      bucket,
      key,
      body,
      contentType: 'application/json; charset=utf-8',
      metadata,
    });
  }

  async getBuffer(bucket: string, key: string) {
    const client = this.getClient();
    const stream = await client.getObject(bucket, key);
    return this.readStream(stream);
  }

  async getBufferIfExists(bucket: string, key: string) {
    try {
      return await this.getBuffer(bucket, key);
    } catch (error) {
      if (this.isMissingObjectError(error)) {
        return null;
      }
      throw error;
    }
  }

  async objectExists(bucket: string, key: string) {
    const client = this.getClient();
    try {
      await client.statObject(bucket, key);
      return true;
    } catch (error) {
      if (this.isMissingObjectError(error)) {
        return false;
      }
      throw error;
    }
  }

  async checkHealth() {
    if (!this.enabled) {
      return { enabled: false, healthy: true };
    }

    try {
      await this.ensureBucket(this.uploadBucket);
      return { enabled: true, healthy: true };
    } catch (error: any) {
      this.logger.error(
        `[minio] 健康检查失败：${error?.message || String(error)}`,
        error?.stack,
      );
      return { enabled: true, healthy: false };
    }
  }

  private getClient() {
    if (!this.client) {
      throw new Error('MinIO is not configured');
    }
    return this.client;
  }

  private async ensureBucket(bucket: string) {
    if (!bucket) {
      throw new Error('MinIO bucket name is empty');
    }
    if (!this.enabled) {
      return false;
    }
    if (this.ensuredBuckets.has(bucket)) {
      return true;
    }

    const client = this.getClient();
    const exists = await client.bucketExists(bucket).catch(async (error) => {
      if (this.isMissingBucketError(error)) {
        return false;
      }
      throw error;
    });

    if (!exists) {
      await client.makeBucket(bucket, DEFAULT_REGION);
      this.logger.log(`[minio] 已创建存储桶 ${bucket}`);
    }

    this.ensuredBuckets.add(bucket);
    return true;
  }

  private isMissingBucketError(error: unknown) {
    const code = String((error as any)?.code || (error as any)?.Code || '').trim();
    return code === 'NoSuchBucket';
  }

  private isMissingObjectError(error: unknown) {
    const code = String((error as any)?.code || (error as any)?.Code || '').trim();
    return ['NoSuchKey', 'NoSuchObject', 'NotFound', 'NoSuchBucket'].includes(code);
  }

  private async readStream(stream: Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}

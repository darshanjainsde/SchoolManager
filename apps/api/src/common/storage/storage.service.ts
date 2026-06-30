import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@skoolos/config';

export interface UploadResult {
  key: string;
  url: string;
}

/**
 * Thin S3 wrapper used by everything that needs object storage. MinIO locally,
 * AWS S3 / R2 in prod (env-swap only — no code change).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly env = loadEnv();
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: this.env.S3_REGION,
      endpoint: this.env.S3_ENDPOINT,
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: this.env.S3_ACCESS_KEY,
        secretAccessKey: this.env.S3_SECRET_KEY,
      },
    });
  }

  /**
   * Upload a buffer. `prefix` is the folder under the bucket (e.g.
   * `schools/<id>/logo`). Returns a public URL suitable for browser use.
   */
  async upload(
    prefix: string,
    filename: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<UploadResult> {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}/${randomUUID()}-${safe}`.replace(/^\/+/, '');
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return { key, url: this.publicUrl(key) };
  }

  /** Best-effort delete — never throws. */
  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      );
    } catch (e) {
      this.logger.warn(`Failed to delete ${key}: ${(e as Error).message}`);
    }
  }

  /** Read-only presigned URL (5 min). */
  async presignedGet(key: string, ttlSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * MinIO bucket is anonymous-download in local dev, so we can give browsers a
   * direct URL. For prod we'd serve through a CDN or presigned URL instead.
   */
  publicUrl(key: string): string {
    return `${this.env.S3_ENDPOINT.replace(/\/+$/, '')}/${this.env.S3_BUCKET}/${key}`;
  }
}

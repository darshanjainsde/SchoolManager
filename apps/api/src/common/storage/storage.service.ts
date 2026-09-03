import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../errors/api-error';

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
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.env.S3_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      // Log the effective (non-secret) target so a storage failure names the
      // exact endpoint/bucket the request went to — an HTTP 410 or a non-XML
      // body here means the S3/Supabase endpoint is wrong, gone, or paused,
      // which is config, not code. Access keys are never logged.
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      // eslint-disable-next-line no-console
      console.error('[storage.upload] PutObject failed', {
        endpoint: this.env.S3_ENDPOINT,
        bucket: this.env.S3_BUCKET,
        region: this.env.S3_REGION,
        forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
        key,
        httpStatus: e?.$metadata?.httpStatusCode,
        name: e?.name,
      });
      // A dead store is an OPERATOR problem, and the person holding the file
      // deserves to be told that rather than "Something went wrong" — which
      // reads as "your file is bad" and sends them round the loop again.
      // (Staging, 3 Sept 2026: the Supabase project behind S3_ENDPOINT was
      // deleted; every upload 500'd with a generic toast for days.)
      throw new ApiError(
        'STORAGE_UNAVAILABLE',
        'The file store is unreachable right now, so the upload could not be saved. Nothing was recorded — please try again in a few minutes, and tell Sckools if it keeps failing.',
        503,
        'file',
      );
    }
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
   * Browser-facing URL for an uploaded object. When S3_PUBLIC_URL_BASE is set
   * (e.g. Supabase Storage's CDN-backed public path) it wins; otherwise fall
   * back to the MinIO-style <endpoint>/<bucket>/<key> path URL used in dev.
   */
  publicUrl(key: string): string {
    const base = this.env.S3_PUBLIC_URL_BASE?.replace(/\/+$/, '');
    if (base) return `${base}/${key}`;
    return `${this.env.S3_ENDPOINT.replace(/\/+$/, '')}/${this.env.S3_BUCKET}/${key}`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../errors/api-error';

export interface UploadResult {
  key: string;
  /**
   * Browser-usable URL. Empty string for a private upload: there is no URL a
   * browser can hold, by design — read it back through `presignedGet`.
   */
  url: string;
}

/**
 * Key prefixes that belong in the private bucket. Used to resolve which bucket
 * a key lives in on read — an object written before S3_PRIVATE_BUCKET was set
 * is still in the public one, and both must keep resolving.
 */
export const PRIVATE_PREFIXES = ['print-orders/', 'fee-proofs/'] as const;

export interface UploadOptions {
  /**
   * Put this object in the private bucket when one is configured. Use it for
   * anything a stranger holding the link should not be able to open: fee
   * proofs, print-order PDFs. Falls back to the public bucket when
   * S3_PRIVATE_BUCKET is unset, so behaviour is unchanged until it is.
   */
  private?: boolean;
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
  /** Which bucket an object lives in. Private only when one is configured. */
  private bucketFor(isPrivate: boolean | undefined): string {
    if (isPrivate && this.env.S3_PRIVATE_BUCKET) return this.env.S3_PRIVATE_BUCKET;
    return this.env.S3_BUCKET;
  }

  /** True when this key was written to the private bucket. */
  private isPrivateKey(key: string): boolean {
    return !!this.env.S3_PRIVATE_BUCKET && PRIVATE_PREFIXES.some((p) => key.startsWith(p) || key.includes(`/${p}`));
  }

  async upload(
    prefix: string,
    filename: string,
    buffer: Buffer,
    contentType: string,
    opts: UploadOptions = {},
  ): Promise<UploadResult> {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${prefix}/${randomUUID()}-${safe}`.replace(/^\/+/, '');
    const bucket = this.bucketFor(opts.private);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
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
        // Same bucket resolution as the read path, or a private object would
        // be 'deleted' from the public bucket and quietly survive.
        new DeleteObjectCommand({ Bucket: this.isPrivateKey(key) ? this.env.S3_PRIVATE_BUCKET! : this.env.S3_BUCKET, Key: key }),
      );
    } catch (e) {
      this.logger.warn(`Failed to delete ${key}: ${(e as Error).message}`);
    }
  }

  /** Read-only presigned URL (5 min). */
  /**
   * A short-lived link to an object. Resolves the bucket from the key's own
   * prefix, so a key written before the private bucket existed still reads
   * from the public one and nothing 404s during the migration.
   */
  async presignedGet(key: string, ttlSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.isPrivateKey(key) ? this.env.S3_PRIVATE_BUCKET! : this.env.S3_BUCKET, Key: key }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * Browser-facing URL for an uploaded object. When S3_PUBLIC_URL_BASE is set
   * (e.g. Supabase Storage's CDN-backed public path) it wins; otherwise fall
   * back to the MinIO-style <endpoint>/<bucket>/<key> path URL used in dev.
   */
  publicUrl(key: string): string {
    // A private object has no browser-usable URL, and handing back a public
    // one that 404s (or worse, resolves) would defeat the point.
    if (this.isPrivateKey(key)) return '';
    const base = this.env.S3_PUBLIC_URL_BASE?.replace(/\/+$/, '');
    if (base) return `${base}/${key}`;
    return `${this.env.S3_ENDPOINT.replace(/\/+$/, '')}/${this.env.S3_BUCKET}/${key}`;
  }
}

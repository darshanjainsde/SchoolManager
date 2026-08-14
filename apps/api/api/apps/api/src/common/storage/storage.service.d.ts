export interface UploadResult {
    key: string;
    url: string;
}
/**
 * Thin S3 wrapper used by everything that needs object storage. MinIO locally,
 * AWS S3 / R2 in prod (env-swap only — no code change).
 */
export declare class StorageService {
    private readonly logger;
    private readonly env;
    private readonly client;
    constructor();
    /**
     * Upload a buffer. `prefix` is the folder under the bucket (e.g.
     * `schools/<id>/logo`). Returns a public URL suitable for browser use.
     */
    upload(prefix: string, filename: string, buffer: Buffer, contentType: string): Promise<UploadResult>;
    /** Best-effort delete — never throws. */
    delete(key: string): Promise<void>;
    /** Read-only presigned URL (5 min). */
    presignedGet(key: string, ttlSeconds?: number): Promise<string>;
    /**
     * Browser-facing URL for an uploaded object. When S3_PUBLIC_URL_BASE is set
     * (e.g. Supabase Storage's CDN-backed public path) it wins; otherwise fall
     * back to the MinIO-style <endpoint>/<bucket>/<key> path URL used in dev.
     */
    publicUrl(key: string): string;
}
//# sourceMappingURL=storage.service.d.ts.map
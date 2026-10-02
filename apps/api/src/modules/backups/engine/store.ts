import { promises as fs } from 'node:fs';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, DeleteObjectCommand,
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client, UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { Sink, Source } from './archive';

/* ── A school's files ───────────────────────────────────────────────────── */

export type BucketKind = 'public' | 'private';
export interface StoredObject { bucket: BucketKind; key: string; size: number }

/** What the engine needs from object storage for a school's own files. */
export interface ObjectStore {
  readonly hasPrivateBucket: boolean;
  list(prefix: string): Promise<StoredObject[]>;
  get(o: { bucket: BucketKind; key: string }): Promise<{ body: Buffer; contentType?: string } | null>;
  put(o: { bucket: BucketKind; key: string }, body: Buffer, contentType?: string): Promise<void>;
  /** Removes every object under ONE school's folder. Returns how many went. */
  deletePrefix(prefix: string): Promise<number>;
}

/** The folders a school's files live in. Every writer in the API uses one of these. */
export const schoolPrefixes = (schoolId: string): string[] => [`schools/${schoolId}/`, `print-orders/${schoolId}/`];

const ONE_SCHOOL_PREFIX = /^[a-z-]+\/[0-9a-f-]{36}\/$/i;

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const b = body as { transformToByteArray?: () => Promise<Uint8Array> } & AsyncIterable<Uint8Array>;
  if (typeof b.transformToByteArray === 'function') return Buffer.from(await b.transformToByteArray());
  const parts: Buffer[] = [];
  for await (const chunk of b) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

export interface S3Config {
  endpoint: string; region: string; forcePathStyle: boolean;
  accessKeyId: string; secretAccessKey: string;
  bucket: string; privateBucket?: string | null;
}

export function s3Client(c: S3Config): S3Client {
  return new S3Client({
    region: c.region, endpoint: c.endpoint, forcePathStyle: c.forcePathStyle,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    // Checksums only where S3 REQUIRES one. Since SDK 3.729 the default is to add
    // one to every request, and on a PRESIGNED PUT that is the checksum of an
    // EMPTY body (`x-amz-checksum-crc32=AAAAAA==`) baked into the URL: the
    // browser then uploads the real file, storage compares it with the empty
    // body's checksum and refuses it — and the request dies in the browser, so
    // our API never hears of the upload at all. Third-party S3 implementations
    // (Supabase Storage, MinIO) are also less forgiving of the extra headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export class S3ObjectStore implements ObjectStore {
  constructor(private readonly client: S3Client, private readonly c: S3Config) {}

  get hasPrivateBucket(): boolean { return !!this.c.privateBucket && this.c.privateBucket !== this.c.bucket; }

  private name(kind: BucketKind): string {
    return kind === 'private' && this.hasPrivateBucket ? this.c.privateBucket! : this.c.bucket;
  }

  private kinds(): BucketKind[] { return this.hasPrivateBucket ? ['public', 'private'] : ['public']; }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    for (const bucket of this.kinds()) {
      let token: string | undefined;
      do {
        const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.name(bucket), Prefix: prefix, ContinuationToken: token }));
        for (const o of page.Contents ?? []) if (o.Key) out.push({ bucket, key: o.Key, size: Number(o.Size ?? 0) });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    }
    return out;
  }

  async get(o: { bucket: BucketKind; key: string }) {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.name(o.bucket), Key: o.key }));
      return { body: await streamToBuffer(r.Body), contentType: r.ContentType };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async put(o: { bucket: BucketKind; key: string }, body: Buffer, contentType?: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.name(o.bucket), Key: o.key, Body: body, ContentType: contentType }));
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!ONE_SCHOOL_PREFIX.test(prefix)) throw new Error(`deletePrefix refuses "${prefix}" — expected "<area>/<uuid>/"`);
    let n = 0;
    const all = await this.list(prefix);
    for (const bucket of this.kinds()) {
      // Batches of 1000 — the S3 limit per DeleteObjects call.
      const keys = all.filter((o) => o.bucket === bucket).map((o) => o.key);
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.name(bucket), Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
        n += batch.length;
      }
    }
    return n;
  }
}

export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, { body: Buffer; contentType?: string }>();
  constructor(readonly hasPrivateBucket = true) {}
  private id(bucket: BucketKind, key: string) { return `${this.hasPrivateBucket ? bucket : 'public'}:${key}`; }
  async list(prefix: string) {
    return [...this.objects.entries()]
      .filter(([k]) => k.split(':').slice(1).join(':').startsWith(prefix))
      .map(([k, v]) => ({ bucket: k.split(':')[0] as BucketKind, key: k.split(':').slice(1).join(':'), size: v.body.length }));
  }
  async get(o: { bucket: BucketKind; key: string }) { return this.objects.get(this.id(o.bucket, o.key)) ?? null; }
  async put(o: { bucket: BucketKind; key: string }, body: Buffer, contentType?: string) { this.objects.set(this.id(o.bucket, o.key), { body: Buffer.from(body), contentType }); }
  async deletePrefix(prefix: string) {
    if (!ONE_SCHOOL_PREFIX.test(prefix)) throw new Error(`deletePrefix refuses "${prefix}"`);
    let n = 0;
    for (const o of await this.list(prefix)) { this.objects.delete(this.id(o.bucket, o.key)); n += 1; }
    return n;
  }
}

/* ── The .sckools file itself ───────────────────────────────────────────── */

/** S3 refuses multipart parts under 5 MiB, except the last. */
export const MIN_PART = 5 * 1024 * 1024;
/** Upload as soon as this much is buffered, so memory stays flat on a big school. */
const EAGER_PART = 16 * 1024 * 1024;

export interface MultipartState {
  bucket: string;
  key: string;
  uploadId: string;
  parts: { PartNumber: number; ETag: string }[];
  /** Bytes already in uploaded parts. */
  uploaded: number;
  /** Bytes parked in the spill object between steps (under MIN_PART). */
  spilled: number;
}

/**
 * Writes ONE object across many short requests. Bytes accumulate; whenever
 * 5 MiB+ is buffered at a step boundary it becomes a part; anything smaller is
 * parked in `<key>.spill` and picked up by the next step. The finished object
 * is an ordinary single object — a presigned GET downloads it whole.
 */
export class S3MultipartSink implements Sink {
  private buf: Buffer[] = [];
  private bufBytes = 0;

  private constructor(private readonly client: S3Client, private st: MultipartState) {}

  static async start(client: S3Client, bucket: string, key: string): Promise<S3MultipartSink> {
    const r = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'application/octet-stream' }));
    if (!r.UploadId) throw new Error('storage did not start a multipart upload');
    return new S3MultipartSink(client, { bucket, key, uploadId: r.UploadId, parts: [], uploaded: 0, spilled: 0 });
  }

  static async resume(client: S3Client, state: MultipartState): Promise<S3MultipartSink> {
    const sink = new S3MultipartSink(client, { ...state, parts: [...state.parts] });
    if (state.spilled > 0) {
      const r = await client.send(new GetObjectCommand({ Bucket: state.bucket, Key: `${state.key}.spill` }));
      const b = await streamToBuffer(r.Body);
      if (b.length !== state.spilled) throw new Error(`backup spill is ${b.length} bytes, expected ${state.spilled} — the job state and storage disagree`);
      sink.buf = [b];
      sink.bufBytes = b.length;
    }
    return sink;
  }

  get state(): MultipartState { return { ...this.st, parts: [...this.st.parts] }; }

  async append(bytes: Buffer): Promise<void> {
    this.buf.push(Buffer.from(bytes));
    this.bufBytes += bytes.length;
    if (this.bufBytes >= EAGER_PART) await this.uploadBuffered();
  }

  private async uploadBuffered(): Promise<void> {
    if (this.bufBytes === 0) return;
    const body = Buffer.concat(this.buf);
    const PartNumber = this.st.parts.length + 1;
    if (PartNumber > 10000) throw new Error('backup is too large for one object (10,000 parts)');
    const r = await this.client.send(new UploadPartCommand({ Bucket: this.st.bucket, Key: this.st.key, UploadId: this.st.uploadId, PartNumber, Body: body }));
    if (!r.ETag) throw new Error('storage accepted a part but returned no ETag');
    this.st.parts.push({ PartNumber, ETag: r.ETag });
    this.st.uploaded += body.length;
    this.buf = [];
    this.bufBytes = 0;
  }

  async checkpoint(): Promise<MultipartState> {
    if (this.bufBytes >= MIN_PART) {
      await this.uploadBuffered();
      await this.dropSpill();
    } else if (this.bufBytes > 0) {
      const body = Buffer.concat(this.buf);
      await this.client.send(new PutObjectCommand({ Bucket: this.st.bucket, Key: `${this.st.key}.spill`, Body: body }));
      this.buf = [body];
      this.st.spilled = body.length;
    } else {
      await this.dropSpill();
    }
    return this.state;
  }

  private async dropSpill(): Promise<void> {
    if (this.st.spilled > 0) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.st.bucket, Key: `${this.st.key}.spill` }));
      this.st.spilled = 0;
    }
  }

  async finish(): Promise<number> {
    await this.uploadBuffered(); // the last part may be under 5 MiB
    await this.client.send(new CompleteMultipartUploadCommand({
      Bucket: this.st.bucket, Key: this.st.key, UploadId: this.st.uploadId, MultipartUpload: { Parts: this.st.parts },
    }));
    await this.dropSpill();
    return this.st.uploaded;
  }

  /** Throws away an unfinished upload and its spill. Best-effort. */
  static async abort(client: S3Client, state: MultipartState): Promise<void> {
    await client.send(new AbortMultipartUploadCommand({ Bucket: state.bucket, Key: state.key, UploadId: state.uploadId })).catch(() => undefined);
    await client.send(new DeleteObjectCommand({ Bucket: state.bucket, Key: `${state.key}.spill` })).catch(() => undefined);
  }
}

export class S3Source implements Source {
  private cached?: number;
  constructor(private readonly client: S3Client, private readonly bucket: string, private readonly key: string) {}
  async size(): Promise<number> {
    if (this.cached === undefined) {
      const h = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key }));
      this.cached = Number(h.ContentLength ?? 0);
    }
    return this.cached;
  }
  async read(offset: number, length: number): Promise<Buffer> {
    if (length <= 0) return Buffer.alloc(0);
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key, Range: `bytes=${offset}-${offset + length - 1}` }));
    return streamToBuffer(r.Body);
  }
}

/** A local file, for the CLI. Resumable: reopening truncates to the last saved size. */
export class FileSink implements Sink {
  private constructor(private readonly fh: fs.FileHandle, private bytes: number) {}
  static async create(path: string): Promise<FileSink> { return new FileSink(await fs.open(path, 'w'), 0); }
  static async resume(path: string, bytes: number): Promise<FileSink> {
    const fh = await fs.open(path, 'r+');
    await fh.truncate(bytes);
    return new FileSink(fh, bytes);
  }
  get size(): number { return this.bytes; }
  async append(b: Buffer) { await this.fh.write(b, 0, b.length, this.bytes); this.bytes += b.length; }
  async checkpoint() { await this.fh.sync(); return { bytes: this.bytes }; }
  async finish() { await this.fh.sync(); await this.fh.close(); return this.bytes; }
}

export class FileSource implements Source {
  private constructor(private readonly fh: fs.FileHandle, private readonly bytes: number) {}
  static async open(path: string): Promise<FileSource> {
    const fh = await fs.open(path, 'r');
    return new FileSource(fh, (await fh.stat()).size);
  }
  async size() { return this.bytes; }
  async read(offset: number, length: number) {
    const b = Buffer.alloc(Math.max(0, Math.min(length, this.bytes - offset)));
    if (b.length) await this.fh.read(b, 0, b.length, offset);
    return b;
  }
  async close() { await this.fh.close(); }
}

/**
 * The backup file on REAL object storage (MinIO locally; the same S3 protocol
 * Supabase Storage speaks). The engine suite uses memory stores; this proves
 * the parts memory cannot: multipart parts of 5 MiB+, the spill object that
 * carries <5 MiB between steps, Range reads, two buckets, and abort.
 *
 *     E2E_OBJECT_STORAGE=1 pnpm --filter @skoolos/api test:e2e -- school-backup-storage
 *
 * E2E_S3_* (not S3_*): test/env.setup.js overwrites S3_* with fakes for every
 * suite, so a real endpoint has to arrive under its own names. Defaults match
 * docker-compose's MinIO.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { CreateBucketCommand, HeadObjectCommand, ListMultipartUploadsCommand, S3Client } from '@aws-sdk/client-s3';
import { ArchiveReader, ArchiveWriter } from '../src/modules/backups/engine/archive';
import { CHUNK_BYTES } from '../src/modules/backups/engine/container';
import { MIN_PART, MultipartState, S3MultipartSink, S3ObjectStore, S3Source, s3Client } from '../src/modules/backups/engine/store';
import { itWithObjectStorage } from './requires-object-storage';

jest.setTimeout(300_000);

const PUBLIC = process.env.E2E_S3_BUCKET ?? 'skoolos';
const PRIVATE = `${PUBLIC}-private-e2e`;
const cfg = {
  endpoint: process.env.E2E_S3_ENDPOINT ?? 'http://localhost:9000', region: 'us-east-1', forcePathStyle: true,
  accessKeyId: process.env.E2E_S3_ACCESS_KEY ?? 'skoolosminio', secretAccessKey: process.env.E2E_S3_SECRET_KEY ?? 'skoolosminio',
  bucket: PUBLIC, privateBucket: PRIVATE,
};
const PW = 'storage e2e password';
const KDF = { N: 1024, r: 8, p: 1 };

let client: S3Client;
beforeAll(async () => {
  if (process.env.E2E_OBJECT_STORAGE !== '1') return;
  client = s3Client(cfg);
  for (const Bucket of [PUBLIC, PRIVATE]) await client.send(new CreateBucketCommand({ Bucket })).catch(() => undefined);
});

describe('a backup written across many requests onto real S3', () => {
  itWithObjectStorage('survives steps that end below and above the 5 MiB part floor, and reads back byte for byte', async () => {
    const key = `backups/e2e/${randomUUID()}.sckools`;
    const entries = [
      ['small', randomBytes(1000)],          // step ends far under 5 MiB → spill
      ['two-chunks', randomBytes(CHUNK_BYTES + 7)],
      ['big', randomBytes(6 * 1024 * 1024)], // pushes past the part floor
      ['medium', randomBytes(3 * 1024 * 1024)],
      ['huge', randomBytes(17 * 1024 * 1024)], // forces an eager part mid-step
    ] as const;

    let sink = await S3MultipartSink.start(client, PRIVATE, key);
    let writer = await ArchiveWriter.create(sink, PW, KDF);
    let state: MultipartState;
    for (const [name, data] of entries) {
      await writer.add(name, data);
      // End the "request": checkpoint, persist as JSON, resume in a new "process".
      state = JSON.parse(JSON.stringify(await writer.checkpoint())) as MultipartState;
      const ws = JSON.parse(JSON.stringify(writer.state()));
      sink = await S3MultipartSink.resume(client, state);
      writer = ArchiveWriter.resume(sink, PW, ws);
    }
    const { bytes } = await writer.finish({ test: true });

    const head = await client.send(new HeadObjectCommand({ Bucket: PRIVATE, Key: key }));
    expect(Number(head.ContentLength)).toBe(bytes);
    await expect(client.send(new HeadObjectCommand({ Bucket: PRIVATE, Key: `${key}.spill` }))).rejects.toBeTruthy(); // spill cleaned up

    const r = await ArchiveReader.open(new S3Source(client, PRIVATE, key), PW);
    for (const [name, data] of entries) expect((await r.read(name)).equals(data)).toBe(true);
    expect(r.manifest).toEqual({ test: true });
  });

  itWithObjectStorage('an abandoned upload leaves no parts and no spill behind', async () => {
    const key = `backups/e2e/${randomUUID()}.sckools`;
    const sink = await S3MultipartSink.start(client, PRIVATE, key);
    await sink.append(randomBytes(MIN_PART + 10));
    await sink.append(randomBytes(100));
    const state = await sink.checkpoint();
    await S3MultipartSink.abort(client, state);
    const open = await client.send(new ListMultipartUploadsCommand({ Bucket: PRIVATE, Prefix: key }));
    expect(open.Uploads ?? []).toEqual([]);
    await expect(client.send(new HeadObjectCommand({ Bucket: PRIVATE, Key: `${key}.spill` }))).rejects.toBeTruthy();
  });
});

describe("a school's files on real S3", () => {
  itWithObjectStorage('lists both buckets, reads back types, and deletes ONE school only', async () => {
    const store = new S3ObjectStore(client, cfg);
    const mine = randomUUID();
    const other = randomUUID();
    await store.put({ bucket: 'public', key: `schools/${mine}/logo/a.png` }, Buffer.from('a'), 'image/png');
    await store.put({ bucket: 'private', key: `schools/${mine}/fee-proofs/p.jpg` }, Buffer.from('p'), 'image/jpeg');
    await store.put({ bucket: 'public', key: `schools/${other}/logo/b.png` }, Buffer.from('b'), 'image/png');

    const listed = await store.list(`schools/${mine}/`);
    expect(listed.map((o) => `${o.bucket}:${o.key}`).sort()).toEqual([`private:schools/${mine}/fee-proofs/p.jpg`, `public:schools/${mine}/logo/a.png`]);
    expect(await store.get({ bucket: 'private', key: `schools/${mine}/fee-proofs/p.jpg` })).toMatchObject({ contentType: 'image/jpeg' });
    expect(await store.get({ bucket: 'public', key: `schools/${mine}/missing.png` })).toBeNull();

    expect(await store.deletePrefix(`schools/${mine}/`)).toBe(2);
    expect(await store.list(`schools/${mine}/`)).toEqual([]);
    expect(await store.list(`schools/${other}/`)).toHaveLength(1);
    await expect(store.deletePrefix('schools/')).rejects.toThrow(/refuses/);
    await store.deletePrefix(`schools/${other}/`);
  });
});

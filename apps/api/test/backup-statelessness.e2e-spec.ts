/**
 * THE BACKUP JOBS HOLD NO STATE IN A PROCESS — PROVEN, NOT ASSUMED.
 *
 * A serverless API runs every request on whichever instance is free, and kills
 * instances at will. So a job that works is not the same as a job that is
 * stateless: it can work for years on one warm instance and fall over the day
 * a second one appears.
 *
 * This suite makes that day happen on purpose. Every call below runs on a
 * FRESHLY LOADED copy of the service modules (`jest.isolateModules`: a new
 * module registry, so no module-level variable, singleton or cache survives
 * from one call to the next). The only things shared between calls are the two
 * things a real deployment shares: the Postgres database, and an object store
 * that lives OUTSIDE the services (a fake S3 held on `globalThis`).
 *
 * If a service leaned on anything it remembered, one of these fails:
 *
 *   1. a snapshot and a restore, every step on a different instance
 *   2. a restore the request abandoned is finished by the cron, elsewhere
 *   3. two instances stepping the same job at the same moment
 *   4. a failure after the data was emptied puts it back by itself
 *   5. waiting on the safety copy does not run the retry counter out
 *   6. the cron's old whole-school stepper must leave a scoped job alone
 *   7. a sample pack built and loaded across instances
 *   8. a job that is only WAITING is not picked up in a loop
 */
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import * as dbModule from '@skoolos/db';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { Bucket } from '../src/modules/backups/engine/buckets';
import { rawDbFromPrisma } from '../src/modules/backups/engine/db';
import { buildSchemaPlan, q } from '../src/modules/backups/engine/schema-plan';
import { scopePlan } from '../src/modules/backups/engine/scoped-plan';

jest.setTimeout(1_800_000);

/* ── a fake S3 that lives OUTSIDE every service ────────────────────────────── */

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  type Up = { key: string; parts: Map<number, Buffer> };
  const g = globalThis as unknown as { __s3?: { objects: Map<string, Buffer>; uploads: Map<string, Up>; calls: number } };
  g.__s3 ??= { objects: new Map(), uploads: new Map(), calls: 0 };
  const store = g.__s3;
  const key = (b: string, k: string) => `${b}/${k}`;
  const missing = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
  class FakeS3Client {
    async send(cmd: { constructor: { name: string }; input: Record<string, any> }) {
      store.calls += 1;
      const i = cmd.input;
      switch (cmd.constructor.name) {
        case 'CreateMultipartUploadCommand': {
          const id = `up-${store.uploads.size + 1}-${Math.random().toString(36).slice(2)}`;
          store.uploads.set(id, { key: key(i.Bucket, i.Key), parts: new Map() });
          return { UploadId: id };
        }
        case 'UploadPartCommand': {
          store.uploads.get(i.UploadId)!.parts.set(i.PartNumber, Buffer.from(i.Body));
          return { ETag: `"${i.PartNumber}"` };
        }
        case 'CompleteMultipartUploadCommand': {
          const up = store.uploads.get(i.UploadId)!;
          const order = [...i.MultipartUpload.Parts].sort((a: any, b: any) => a.PartNumber - b.PartNumber);
          store.objects.set(up.key, Buffer.concat(order.map((p: any) => up.parts.get(p.PartNumber)!)));
          store.uploads.delete(i.UploadId);
          return {};
        }
        case 'AbortMultipartUploadCommand': store.uploads.delete(i.UploadId); return {};
        case 'PutObjectCommand': store.objects.set(key(i.Bucket, i.Key), Buffer.from(i.Body)); return {};
        case 'GetObjectCommand': {
          const o = store.objects.get(key(i.Bucket, i.Key));
          if (!o) throw missing('NoSuchKey');
          let body = o;
          const m = /^bytes=(\d+)-(\d+)$/.exec(i.Range ?? '');
          if (m) body = o.subarray(Number(m[1]), Number(m[2]) + 1);
          return { Body: { transformToByteArray: async () => new Uint8Array(body) }, ContentType: 'application/octet-stream' };
        }
        case 'HeadObjectCommand': {
          const o = store.objects.get(key(i.Bucket, i.Key));
          if (!o) throw missing('NotFound');
          return { ContentLength: o.length };
        }
        case 'DeleteObjectCommand': store.objects.delete(key(i.Bucket, i.Key)); return {};
        case 'DeleteObjectsCommand':
          for (const o of i.Delete.Objects) store.objects.delete(key(i.Bucket, o.Key));
          return {};
        case 'ListObjectsV2Command': {
          const prefix = key(i.Bucket, i.Prefix ?? '');
          const Contents = [...store.objects.entries()]
            .filter(([k]) => k.startsWith(prefix))
            .map(([k, v]) => ({ Key: k.slice(i.Bucket.length + 1), Size: v.length }));
          return { Contents, IsTruncated: false };
        }
        default: throw new Error(`fake S3: unsupported ${cmd.constructor.name}`);
      }
    }
  }
  return { ...actual, S3Client: FakeS3Client };
});

/* ── a service set that has never seen a previous call ─────────────────────── */

const storageStub = { presignedGet: async () => 'https://example.invalid/x' };
const noop = { invalidate: async () => undefined };

interface Svc {
  backups: import('../src/modules/backups/backups.service').BackupsService;
  restores: import('../src/modules/backups/bucket-restores.service').BucketRestoresService;
  packs: import('../src/modules/backups/sample-packs.service').SamplePacksService;
}
let instances = 0;
const seen = new Set<unknown>();

function fresh(overrides: Record<string, () => unknown> = {}): Svc {
  let out!: Svc;
  jest.isolateModules(() => {
    jest.doMock('@skoolos/db', () => dbModule); // the database is shared; code is not
    for (const [path, factory] of Object.entries(overrides)) jest.doMock(path, factory);
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { BackupsService } = require('../src/modules/backups/backups.service');
    const { BucketRestoresService } = require('../src/modules/backups/bucket-restores.service');
    const { SamplePacksService } = require('../src/modules/backups/sample-packs.service');
    /* eslint-enable */
    const backups = new BackupsService(storageStub, noop, noop);
    out = { backups, restores: new BucketRestoresService(backups), packs: new SamplePacksService(backups) };
  });
  for (const path of Object.keys(overrides)) jest.dontMock(path);
  // Prove it really is a different instance with its own module graph every time.
  expect(seen.has(out.backups)).toBe(false);
  seen.add(out.backups);
  instances += 1;
  return out;
}

/* ── the school under test ─────────────────────────────────────────────────── */

const REPO = resolve(__dirname, '../../..');
const URL = 'postgresql://skoolos:skoolos@localhost:5432/skoolos_test?schema=public';
const SLUG = 'stateless';
const plan = buildSchemaPlan();
let db: ReturnType<typeof rawDbFromPrisma>;
let schoolId: string;
let targetId: string;

const scoped = (b: Bucket[]) => scopePlan(plan, b);
async function fingerprint(id: string, b: Bucket[]): Promise<Map<string, string[]>> {
  const p = scoped(b);
  const out = new Map<string, string[]>();
  for (const t of p.insertOrder) {
    const f = p.where(t.model);
    const rows = await db.query<{ j: string }>(
      `SELECT row_to_json(t)::text AS j FROM ${q(t.table)} t WHERE t."schoolId" = $1::uuid${f ? ` AND (${f})` : ''}
        ORDER BY ${t.pk.map((c) => `t.${q(c)}::text COLLATE "C"`).join(', ')}`, id);
    if (rows.length) out.set(t.table, rows.map((r) => r.j));
  }
  return out;
}
const status = async (id: string) =>
  (await db.query<{ s: string }>(`SELECT status::text AS s FROM "School" WHERE id = $1::uuid`, id))[0]!.s;

/** The school went quiet a while ago — the 70 s settle period is a wall clock, not a test subject. */
const aged = () => db.execute(`UPDATE "School" SET "statusChangedAt" = (now() at time zone 'UTC') - interval '10 minutes' WHERE id = $1::uuid`, schoolId);

async function until<T extends { status: string }>(
  what: string, step: () => Promise<T>, done: string[] = ['DONE', 'FAILED', 'READY'], max = 80,
): Promise<T> {
  for (let i = 0; i < max; i += 1) {
    await aged();
    const v = await step();
    if (done.includes(v.status)) return v;
  }
  throw new Error(`${what} never finished`);
}

async function snapshotOf(buckets: Bucket[]): Promise<string> {
  const start = await fresh().backups.start(schoolId, 'SNAPSHOT', 'test', { scope: buckets });
  const done = await until('snapshot', () => fresh().backups.step(start.id));
  expect(done.status).toBe('READY');
  return start.id;
}

beforeAll(async () => {
  process.env.SCHOOL_BACKUP_PASSWORD = 'a long backup password for tests';
  const env = {
    ...process.env, DATABASE_URL: URL, DIRECT_URL: URL, DATABASE_URL_APP: URL, DATABASE_URL_PLATFORM: URL,
    DEMO_SCHOOL_SLUG: SLUG, DEMO_SCHOOL_NAME: 'Stateless Source School', DEMO_DRY_RUN: 'false',
    DEMO_PASSWORD: 'password', DEMO_ALUMNUS_PASSWORD: 'password',
  };
  const cwd = join(REPO, 'packages/db');
  for (const s of ['seed-school-demo.ts', 'seed-fees-demo.ts', 'seed-alumni-demo.ts']) {
    execSync(`pnpm exec tsx prisma/${s}`, { cwd, env, stdio: 'pipe' });
  }
  const p = getPlatformPrisma();
  db = rawDbFromPrisma(p);
  schoolId = (await p.school.findUniqueOrThrow({ where: { slug: SLUG } })).id;
  targetId = (await p.school.create({ data: { slug: 'stateless-target', name: 'Stateless Target', tier: 'PRO', status: 'LIVE', codePrefix: 'STT' } })).id;
  await p.user.create({ data: { schoolId: targetId, email: 'office@stateless-target.test', passwordHash: 'x', role: 'SCHOOL_ADMIN', isActive: true } });
});

afterAll(async () => {
  await disconnectAll();
});

describe('every step on a different instance', () => {
  it('takes a snapshot and puts it back, and nothing was remembered between the calls', async () => {
    const day = ['day'] as Bucket[];
    const before = await fingerprint(schoolId, day);
    const others = await Promise.all((['school', 'website', 'setup'] as Bucket[]).map((b) => fingerprint(schoolId, [b])));
    const backupId = await snapshotOf(day);

    await db.execute(`UPDATE "Attendance" SET status = 'LATE' WHERE "schoolId" = $1::uuid`, schoolId);
    expect(await fingerprint(schoolId, day)).not.toEqual(before);

    const started = await fresh().restores.start({ schoolId, buckets: day, backupId }, 'test');
    // Starting only records the intent — the school has not been touched.
    expect(started.phase).toBe('starting');
    expect(await status(schoolId)).toBe('LIVE');

    const done = await until('restore', () => fresh().restores.step(started.id));
    expect(done.status).toBe('DONE');
    expect(await status(schoolId)).toBe('LIVE');
    expect(await fingerprint(schoolId, day)).toEqual(before);
    for (const [i, b] of (['school', 'website', 'setup'] as Bucket[]).entries()) {
      expect(await fingerprint(schoolId, [b])).toEqual(others[i]);
    }
  });
});

describe('a restore that nobody is watching', () => {
  it('is finished by the cron on another instance, from the database alone', async () => {
    const day = ['day'] as Bucket[];
    const before = await fingerprint(schoolId, day);
    const backupId = await snapshotOf(day);
    await db.execute(`UPDATE "Attendance" SET status = 'ABSENT' WHERE "schoolId" = $1::uuid`, schoolId);

    // The request that started it dies right here: no browser, no polling.
    const started = await fresh().restores.start({ schoolId, buckets: day, backupId }, 'test');

    for (let i = 0; i < 60; i += 1) {
      await aged();
      const svc = fresh(); // a new instance, exactly as a cron invocation would be
      await svc.backups.drive(Date.now() + 52_000, () => svc.restores.stepNext());
      const v = await fresh().restores.get(started.id);
      if (v.status !== 'RUNNING') break;
    }
    const v = await fresh().restores.get(started.id);
    expect(v.status).toBe('DONE');
    expect(await status(schoolId)).toBe('LIVE');
    expect(await fingerprint(schoolId, day)).toEqual(before);
  });

  it('is left alone by the whole-school stepper, which cannot read its state', async () => {
    const day = ['day'] as Bucket[];
    const backupId = await snapshotOf(day);
    const started = await fresh().restores.start({ schoolId, buckets: day, backupId }, 'test');
    // Run ONLY the old path: no `extra`, so a scoped restore must not be touched.
    await db.execute(`UPDATE "School" SET "statusChangedAt" = (now() at time zone 'UTC') - interval '10 minutes' WHERE id = $1::uuid`, schoolId);
    await fresh().backups.drive(Date.now() + 5_000);
    const v = await fresh().restores.get(started.id);
    expect(v.status).toBe('RUNNING');
    expect(v.phase).toBe('starting');
    // ...and it still finishes afterwards.
    expect((await until('restore', () => fresh().restores.step(started.id))).status).toBe('DONE');
  });
});

describe('two instances at the same moment', () => {
  it('step the same job without doing its work twice', async () => {
    const day = ['day'] as Bucket[];
    const before = await fingerprint(schoolId, day);
    const backupId = await snapshotOf(day);
    await db.execute(`UPDATE "Attendance" SET status = 'LATE' WHERE "schoolId" = $1::uuid`, schoolId);

    const started = await fresh().restores.start({ schoolId, buckets: day, backupId }, 'test');
    let last = started;
    for (let i = 0; i < 80 && last.status === 'RUNNING'; i += 1) {
      await aged();
      const [a, b, c] = await Promise.all([fresh().restores.step(started.id), fresh().restores.step(started.id), fresh().restores.step(started.id)]);
      last = [a, b, c].find((x) => x.status !== 'RUNNING') ?? c;
    }
    const v = await fresh().restores.get(started.id);
    expect(v.status).toBe('DONE');
    expect(await fingerprint(schoolId, day)).toEqual(before);
  });
});

describe('a failure halfway through', () => {
  it('puts the school back by itself, from the safety copy, on whichever instance is next', async () => {
    const day = ['day'] as Bucket[];
    const before = await fingerprint(schoolId, day);
    const backupId = await snapshotOf(day);
    await db.execute(`UPDATE "Attendance" SET status = 'LATE' WHERE "schoolId" = $1::uuid`, schoolId);
    const changed = await fingerprint(schoolId, day);

    // The FIRST row batch written during the import fails — after the buckets
    // were emptied, inside the same step. The rollback's own writes must pass.
    const g = globalThis as unknown as { __failOnce?: boolean };
    g.__failOnce = true;
    const flaky = () => {
      const actual = jest.requireActual('../src/modules/backups/engine/import');
      return { ...actual, applyRows: async (...a: unknown[]) => {
        if (g.__failOnce) { g.__failOnce = false; throw new Error('the disk filled up (injected)'); }
        return (actual.applyRows as (...x: unknown[]) => unknown)(...a);
      } };
    };

    const started = await fresh().restores.start({ schoolId, buckets: day, backupId }, 'test');
    const done = await until('restore', () => fresh({ '../src/modules/backups/engine/import': flaky }).restores.step(started.id));

    expect(done.status).toBe('FAILED');
    expect(done.error).toMatch(/injected/);
    expect(done.error).toMatch(/put back as it was/);
    expect(await status(schoolId)).toBe('LIVE');
    // Not the snapshot's data, and not an emptied school: exactly what it was.
    expect(await fingerprint(schoolId, day)).toEqual(changed);
    expect(changed).not.toEqual(before);
  });
});

describe('waiting is not failing', () => {
  it('does not run the retry counter out while the safety copy is still being written', async () => {
    const day = ['day'] as Bucket[];
    const backupId = await snapshotOf(day);
    const started = await fresh().restores.start({ schoolId, buckets: day, backupId }, 'test');
    await aged();
    // One step: freezes the school and starts the copy.
    await fresh().restores.step(started.id);
    const pre = (await getPlatformPrisma().schoolRestore.findUniqueOrThrow({ where: { id: started.id } })).state as { preBackupId: string };

    // Another worker holds the copy, so it cannot finish. Poll ten times — twice
    // the retry limit. The old code failed the restore on the sixth.
    const prisma = getPlatformPrisma();
    await prisma.schoolBackup.update({ where: { id: pre.preBackupId }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    for (let i = 0; i < 10; i += 1) {
      await prisma.schoolRestore.update({ where: { id: started.id }, data: { lockedUntil: null } });
      const v = await fresh().restores.step(started.id);
      expect(v.status).toBe('RUNNING');
    }
    await prisma.schoolBackup.update({ where: { id: pre.preBackupId }, data: { lockedUntil: null } });
    expect((await until('restore', () => fresh().restores.step(started.id))).status).toBe('DONE');
  });

  it('a job that is only waiting is not picked up again until it can proceed', async () => {
    const day = ['day'] as Bucket[];
    const backupId = await snapshotOf(day);
    const started = await fresh().restores.start({ schoolId, buckets: day, backupId }, 'test');
    await fresh().restores.step(started.id); // starting → awaiting-backup (school just suspended)
    // The school was suspended a moment ago: the copy must wait out the settle period.
    await db.execute(`UPDATE "School" SET "statusChangedAt" = (now() at time zone 'UTC') WHERE id = $1::uuid`, schoolId);
    const pre = (await getPlatformPrisma().schoolRestore.findUniqueOrThrow({ where: { id: started.id } })).state as { preBackupId: string };
    await fresh().backups.step(pre.preBackupId);

    const held = await getPlatformPrisma().schoolBackup.findUniqueOrThrow({ where: { id: pre.preBackupId } });
    // Its wake-up time is IN THE DATABASE, ~70 s out — so no worker can spin on it.
    expect(held.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    const calls = (globalThis as unknown as { __s3: { calls: number } }).__s3.calls;
    for (let i = 0; i < 25; i += 1) await fresh().backups.step(pre.preBackupId);
    // Twenty-five more polls did no work at all: not one storage call.
    expect((globalThis as unknown as { __s3: { calls: number } }).__s3.calls).toBe(calls);

    await aged();
    await getPlatformPrisma().schoolBackup.update({ where: { id: pre.preBackupId }, data: { lockedUntil: null } });
    expect((await until('restore', () => fresh().restores.step(started.id))).status).toBe('DONE');
  });
});

describe('a sample pack, built and loaded across instances', () => {
  it('is cut, finished, and lands on another school without any instance remembering the last', async () => {
    const built = await fresh().packs.createFromSchool({ schoolId, name: 'Stateless pack' }, 'test');
    expect(built.status).toBe('BUILDING');
    const ready = await until('pack', () => fresh().packs.advance(built.id), ['READY', 'FAILED']);
    expect(ready.status).toBe('READY');
    expect(ready.rowCount).toBeGreaterThan(100);

    const targetWeb = await fingerprint(targetId, ['website']);
    const started = await fresh().restores.start({ schoolId: targetId, buckets: ['setup', 'day'], packId: built.id }, 'test');
    // Same wall-clock rule for the target school.
    const ageTarget = () => db.execute(`UPDATE "School" SET "statusChangedAt" = (now() at time zone 'UTC') - interval '10 minutes' WHERE id = $1::uuid`, targetId);
    let v = started;
    for (let i = 0; i < 80 && v.status === 'RUNNING'; i += 1) { await ageTarget(); v = await fresh().restores.step(started.id); }
    expect(v.status).toBe('DONE');
    expect(await status(targetId)).toBe('LIVE');
    expect(await fingerprint(targetId, ['website'])).toEqual(targetWeb);
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "Student" WHERE "schoolId" = $1::uuid`, targetId);
    expect(n).toBeGreaterThan(100);
    // Nothing that outlived the load carries the source school's id.
    const [{ strays }] = await db.query<{ strays: number }>(
      `SELECT count(*)::int AS strays FROM "Student" WHERE "schoolId" = $1::uuid AND id IN (SELECT id FROM "Student" WHERE "schoolId" = $2::uuid)`, targetId, schoolId);
    expect(strays).toBe(0);
  });

  it('a pack whose build job vanished is marked failed, not left building forever', async () => {
    const prisma = getPlatformPrisma();
    const orphan = await prisma.samplePack.create({
      data: { name: 'Orphan', scope: 'setup,day', storageKey: `samples/packs/orphan.sckools`, status: 'BUILDING' },
    });
    await fresh().packs.settlePending();
    expect((await prisma.samplePack.findUniqueOrThrow({ where: { id: orphan.id } })).status).toBe('FAILED');
  });
});

it('really used a different instance every time', () => {
  expect(instances).toBeGreaterThan(60);
});

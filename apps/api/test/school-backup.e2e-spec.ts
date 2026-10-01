/**
 * SCHOOL BACKUPS, END TO END, AGAINST REAL POSTGRES.
 *
 * One realistic school (the demo seed: ~550 children, attendance, marks, a
 * fee ledger, certificates in the register, alumni) plus the rows that broke
 * every earlier attempt — a menu tree written child-first, sealed gateway and
 * mailbox secrets, a link into ANOTHER school's network event, files in both
 * buckets, links to this machine's storage and address.
 *
 *   1. the old cascade could not delete it at all
 *   2. back it up in many tiny resumable steps
 *   3. purge it: every table empty for it, every other school untouched
 *   4. restore on the SAME machine: every row of every table identical
 *   5. import on ANOTHER machine (second database, other keys, host, storage):
 *      links, address, domains and secrets fitted to that machine; the link
 *      to a school that machine does not have reported, not silently lost
 *   6. refusals that must leave the target untouched
 *   7. a failure halfway rolls the import back to nothing
 */
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { verify as argonVerify } from 'argon2';
import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import { ArchiveReader, ArchiveWriter, MemorySink, MemorySource } from '../src/modules/backups/engine/archive';
import { RawDb, rawDbFromPrisma } from '../src/modules/backups/engine/db';
import { Manifest, beginExport, runExport } from '../src/modules/backups/engine/export';
import { ImportRefused, ImportState, preflightImport, rollbackImport, runImport } from '../src/modules/backups/engine/import';
import { Machine } from '../src/modules/backups/engine/machine';
import { purgeSchoolFiles, purgeSchoolRows } from '../src/modules/backups/engine/purge';
import { buildSchemaPlan, q } from '../src/modules/backups/engine/schema-plan';
import { MemoryObjectStore } from '../src/modules/backups/engine/store';
import { openFeeSecret, openMailSecret, sealFeeSecret, sealMailSecret } from '../src/common/crypto/machine-secrets';

jest.setTimeout(600_000);

const REPO = resolve(__dirname, '../../..');
const OWNER_URL = 'postgresql://skoolos:skoolos@localhost:5432/skoolos_test?schema=public';
const B_DB = 'skoolos_test_machine_b';
const B_URL = `postgresql://skoolos:skoolos@localhost:5432/${B_DB}?schema=public`;
const PW = 'a long backup password for tests';
const KDF = { N: 1024, r: 8, p: 1 };
const SLUG = 'bksrc';

const key = (n: number) => Buffer.alloc(32, n);
const A: Machine = { platformHost: 'test.sckools.com', publicBase: 'https://a.example/storage/v1/object/public/sckool-files', feesMaster: 'master-A', mailKey: key(1) };
const B: Machine = { platformHost: 'localhost', publicBase: 'http://localhost:9000/skoolos', feesMaster: 'master-B', mailKey: key(2) };

const plan = buildSchemaPlan();
let dbA: RawDb;
let prismaB: PrismaClient;
let dbB: RawDb;
const filesA = new MemoryObjectStore(true);
const filesB = new MemoryObjectStore(false); // machine B has no private bucket
let schoolId: string;
let otherSchoolId: string;
let archive: Buffer;
let before: Map<string, string[]>;

/** Every row this school owns, table by table, in a stable order — the thing that must survive. */
async function snapshot(db: RawDb, id: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const t of plan.insertOrder) {
    const rows = await db.query<{ j: string }>(
      `SELECT row_to_json(t)::text AS j FROM ${q(t.table)} t WHERE t."schoolId" = $1::uuid ORDER BY ${t.pk.map((c) => `t.${q(c)}::text COLLATE "C"`).join(', ')}`, id,
    );
    if (rows.length) out.set(t.table, rows.map((r) => r.j));
  }
  return out;
}
const total = (s: Map<string, string[]>) => [...s.values()].reduce((n, r) => n + r.length, 0);

async function countOtherSchools(db: RawDb, exceptId: string): Promise<number> {
  let n = 0;
  for (const t of plan.insertOrder) {
    const [{ c }] = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM ${q(t.table)} WHERE "schoolId" IS DISTINCT FROM $1::uuid`, exceptId);
    n += c;
  }
  return n;
}

async function exportInSteps(): Promise<{ bytes: Buffer; manifest: Manifest; steps: number }> {
  const sink = new MemorySink();
  const deps = { db: dbA, files: filesA, machine: A, plan, appVersion: 'test', pageRows: 300 };
  let state = await beginExport(deps, schoolId);
  for (let steps = 1; steps < 10_000; steps += 1) {
    // deadline already passed: each call does exactly one unit, then pauses —
    // the hardest possible schedule for a resumable writer.
    const r = await runExport(deps, JSON.parse(JSON.stringify(state)), sink, PW, { deadline: 0, kdf: KDF });
    if (r.done) return { bytes: sink.buffer(), manifest: r.manifest!, steps };
    state = r.state;
  }
  throw new Error('export never finished');
}

async function importInSteps(db: RawDb, files: MemoryObjectStore, machine: Machine, opts: Parameters<typeof preflightImport>[2], replayEvery = 0) {
  const reader = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
  const deps = { db, files, machine, plan };
  let state: ImportState = await preflightImport(deps, reader, opts);
  for (let steps = 1; steps < 10_000; steps += 1) {
    const saved = JSON.parse(JSON.stringify(state)) as ImportState;
    let r = await runImport(deps, reader, saved, { deadline: 0 });
    // Simulate a crash AFTER the step wrote but BEFORE its state was saved:
    // run the very same step again from the old state.
    if (replayEvery && steps % replayEvery === 0 && !r.done) r = await runImport(deps, reader, saved, { deadline: 0 });
    if (r.done) return { report: r.report!, steps };
    state = r.state;
  }
  throw new Error('import never finished');
}

beforeAll(async () => {
  const env = { ...process.env, DATABASE_URL: OWNER_URL, DIRECT_URL: OWNER_URL, DATABASE_URL_APP: OWNER_URL, DATABASE_URL_PLATFORM: OWNER_URL, DEMO_SCHOOL_SLUG: SLUG, DEMO_SCHOOL_NAME: 'Backup Source School', DEMO_DRY_RUN: 'false', DEMO_PASSWORD: 'password', DEMO_ALUMNUS_PASSWORD: 'password' };
  const cwd = join(REPO, 'packages/db');
  for (const s of ['seed-school-demo.ts', 'seed-fees-demo.ts', 'seed-alumni-demo.ts']) execSync(`pnpm exec tsx prisma/${s}`, { cwd, env, stdio: 'pipe' });

  const p = getPlatformPrisma();
  dbA = rawDbFromPrisma(p);
  schoolId = (await p.school.findUniqueOrThrow({ where: { slug: SLUG } })).id;
  const other = await p.school.findUniqueOrThrow({ where: { slug: 'beacon' } });
  otherSchoolId = other.id;

  // ── the rows that broke earlier attempts ──
  // Ids chosen so the archive (written in id order) holds every child BEFORE
  // its parent — the import must reorder the tree or the inserts fail.
  await p.menuItem.create({ data: { id: 'ffffffff-0000-4000-8000-000000000001', schoolId, label: 'About', slug: 'about' } });
  await p.menuItem.create({ data: { id: '88888888-0000-4000-8000-000000000001', schoolId, label: 'Team', slug: 'team', parentId: 'ffffffff-0000-4000-8000-000000000001' } });
  await p.menuItem.create({ data: { id: '00000000-0000-4000-8000-000000000001', schoolId, label: 'Faculty', slug: 'faculty', parentId: '88888888-0000-4000-8000-000000000001' } });

  const logoKey = `schools/${schoolId}/logo/crest.png`;
  await filesA.put({ bucket: 'public', key: logoKey }, Buffer.from('png-bytes-crest'), 'image/png');
  await filesA.put({ bucket: 'private', key: `schools/${schoolId}/fee-proofs/proof.jpg` }, Buffer.from('private-proof'), 'image/jpeg');
  await filesA.put({ bucket: 'private', key: `print-orders/${schoolId}/paper.pdf` }, Buffer.from('%PDF-1.7 exam'), 'application/pdf');
  await filesA.put({ bucket: 'public', key: `schools/${otherSchoolId}/logo/not-mine.png` }, Buffer.from('other school'), 'image/png');
  await p.mediaAsset.create({ data: { schoolId, kind: 'LOGO', storageKey: logoKey, url: `${A.publicBase}/${logoKey}` } });
  await p.schoolPage.create({ data: { schoolId, slug: 'faculty', title: 'Faculty', blocks: [
    { t: 'img', url: `${A.publicBase}/${logoKey}`, caption: 'Crest' },
    { t: 'cta', label: 'Apply', href: `https://${SLUG}.test.sckools.com/admissions` },
  ] } });
  await p.domain.create({ data: { schoolId, hostname: 'www.bksrc-school.org', type: 'CUSTOM', status: 'LIVE' } });
  await p.schoolPaymentConfig.create({ data: { schoolId, provider: 'PHONEPE', secrets: { saltKey: sealFeeSecret('master-A', schoolId, 'salt-live-123') } } });
  await p.emailSettings.upsert({ where: { schoolId }, update: { smtpPassEnc: sealMailSecret(key(1), 'mailbox-pass') }, create: { schoolId, smtpPassEnc: sealMailSecret(key(1), 'mailbox-pass') } });
  // A link into ANOTHER school's network event — fine here, dangling on machine B.
  const ev = await p.event.create({ data: { schoolId: otherSchoolId, title: 'Inter-school quiz', startAt: new Date('2026-12-01T05:00:00Z'), scope: 'NETWORK' } });
  await p.eventAudienceSchool.create({ data: { eventId: ev.id, schoolId } });
  // Credentials that must NOT travel.
  const admin = await p.user.findFirstOrThrow({ where: { schoolId, email: `admin@${SLUG}.test` } });
  await p.refreshToken.create({ data: { schoolId, userId: admin.id, familyId: admin.id, tokenHash: `rt-${schoolId}`, expiresAt: new Date(Date.now() + 86400e3) } });

  // ── machine B: a second, empty database at the same schema ──
  const admin2 = new Client({ connectionString: 'postgresql://skoolos:skoolos@localhost:5432/postgres' });
  await admin2.connect();
  await admin2.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [B_DB]);
  await admin2.query(`DROP DATABASE IF EXISTS ${B_DB}`);
  await admin2.query(`CREATE DATABASE ${B_DB}`);
  await admin2.end();
  execSync('pnpm exec prisma migrate deploy', { cwd, env: { ...process.env, DATABASE_URL: B_URL, DIRECT_URL: B_URL }, stdio: 'pipe' });
  prismaB = new PrismaClient({ datasources: { db: { url: B_URL } } });
  dbB = rawDbFromPrisma(prismaB);
});

afterAll(async () => {
  await prismaB?.$disconnect();
  await disconnectAll();
});

describe('1 · why this exists', () => {
  it('the old delete (cascade from School) cannot remove a school that ever took a fee', async () => {
    await dbA.execute(`UPDATE "School" SET status = 'SUSPENDED' WHERE id = $1::uuid`, schoolId);
    await expect(dbA.execute(`DELETE FROM "School" WHERE id = $1::uuid`, schoolId)).rejects.toThrow(/append-only|violates foreign key/);
    await dbA.execute(`UPDATE "School" SET status = 'LIVE' WHERE id = $1::uuid`, schoolId);
  });
});

describe('2 · backup', () => {
  it('writes the whole school in many tiny resumable steps', async () => {
    before = await snapshot(dbA, schoolId);
    expect(total(before)).toBeGreaterThan(5000);
    const out = await exportInSteps();
    archive = out.bytes;
    expect(out.steps).toBeGreaterThan(50);
    const counts = Object.fromEntries(Object.entries(out.manifest.tables).map(([t, v]) => [t, v.rows]));
    expect(counts).toEqual(Object.fromEntries([...before].map(([t, r]) => [t, r.length])));
    expect(out.manifest.fileCount).toBe(3); // the other school's file is not in it
    expect(out.manifest.excluded).toEqual(expect.arrayContaining(['RefreshToken', 'OtpChallenge']));
    expect(out.manifest.tables.RefreshToken).toBeUndefined();
    expect(out.manifest.source.machine).toEqual({ platformHost: A.platformHost, publicBase: A.publicBase });
  });

  it('the file says nothing readable without the password', async () => {
    expect(archive.includes(Buffer.from('salt-live-123'))).toBe(false);
    expect(archive.includes(Buffer.from('Backup Source School'))).toBe(false);
    await expect(ArchiveReader.open(new MemorySource(archive), 'wrong')).rejects.toThrow(/not the one/);
  });
});

describe('3 · purge', () => {
  it('refuses a school that is still live', async () => {
    await expect(purgeSchoolRows(dbA, plan, schoolId)).rejects.toThrow(/suspend it first/);
  });

  it('removes every row and file of this school — and not one row or file of any other', async () => {
    const othersBefore = await countOtherSchools(dbA, schoolId);
    const otherFile = await filesA.get({ bucket: 'public', key: `schools/${otherSchoolId}/logo/not-mine.png` });
    await dbA.execute(`UPDATE "School" SET status = 'SUSPENDED' WHERE id = $1::uuid`, schoolId);
    await purgeSchoolRows(dbA, plan, schoolId);
    expect(await purgeSchoolFiles(filesA, schoolId)).toBe(3);

    expect(total(await snapshot(dbA, schoolId))).toBe(0);
    expect(await dbA.query(`SELECT 1 FROM "School" WHERE id = $1::uuid`, schoolId)).toEqual([]);
    for (const t of plan.excludedTables) {
      expect(await dbA.query(`SELECT 1 FROM ${q(t)} WHERE "schoolId" = $1::uuid`, schoolId)).toEqual([]);
    }
    // The network event belonged to the other school and stays; only the audience link went.
    expect(await countOtherSchools(dbA, schoolId)).toBe(othersBefore - 0);
    expect(await filesA.get({ bucket: 'public', key: `schools/${otherSchoolId}/logo/not-mine.png` })).toEqual(otherFile);
  });

  it('purging twice is harmless', async () => {
    await expect(purgeSchoolRows(dbA, plan, schoolId)).resolves.toBeUndefined();
  });

});

describe('4 · restore on the same machine', () => {
  it('brings back every row of every table exactly, with the secrets still usable', async () => {
    const { report } = await importInSteps(dbA, filesA, A, { mode: 'restore', finalStatus: 'LIVE' }, 7);
    const after = await snapshot(dbA, schoolId);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [table, rows] of before) {
      if (table === 'SchoolPaymentConfig' || table === 'EmailSettings') continue; // re-sealed: compared below
      expect([table, after.get(table)]).toEqual([table, rows]);
    }
    const cfg = await getPlatformPrisma().schoolPaymentConfig.findFirstOrThrow({ where: { schoolId } });
    expect(openFeeSecret('master-A', schoolId, (cfg.secrets as Record<string, string>).saltKey)).toBe('salt-live-123');
    const em = await getPlatformPrisma().emailSettings.findUniqueOrThrow({ where: { schoolId } });
    expect(openMailSecret(key(1), em.smtpPassEnc)).toBe('mailbox-pass');
    expect(report.dropped).toEqual([]);
    expect(await filesA.get({ bucket: 'private', key: `print-orders/${schoolId}/paper.pdf` })).toMatchObject({ contentType: 'application/pdf' });
    const s = await getPlatformPrisma().school.findUniqueOrThrow({ where: { id: schoolId } });
    expect(s.status).toBe('LIVE');
    expect(await getPlatformPrisma().refreshToken.count({ where: { schoolId } })).toBe(0); // sessions do not travel
  });

  it('the restored menu tree kept every parent', async () => {
    const tree = await getPlatformPrisma().menuItem.findMany({ where: { schoolId }, orderBy: { id: 'asc' }, select: { id: true, parentId: true } });
    expect(tree).toEqual(expect.arrayContaining([
      { id: '00000000-0000-4000-8000-000000000001', parentId: '88888888-0000-4000-8000-000000000001' },
      { id: '88888888-0000-4000-8000-000000000001', parentId: 'ffffffff-0000-4000-8000-000000000001' },
    ]));
  });

  it('the registers stay append-only: a LIVE school cannot be purged around, and an entry can never be edited', async () => {
    const [row] = await dbA.query<{ id: string }>(`SELECT id FROM "FeeLedgerEntry" WHERE "schoolId" = $1::uuid LIMIT 1`, schoolId);
    expect(row).toBeDefined();
    const purgeFlag = { sql: `SELECT set_config('sckools.purge_school', $1, true)`, params: [schoolId] };
    await expect(dbA.transaction([purgeFlag, { sql: `DELETE FROM "FeeLedgerEntry" WHERE id = $1::uuid`, params: [row.id] }]))
      .rejects.toThrow(/append-only/); // the school is LIVE
    await expect(dbA.execute(`DELETE FROM "FeeLedgerEntry" WHERE id = $1::uuid`, row.id)).rejects.toThrow(/append-only/); // no flag
    await dbA.execute(`UPDATE "School" SET status = 'SUSPENDED' WHERE id = $1::uuid`, schoolId);
    try {
      await expect(dbA.transaction([purgeFlag, { sql: `UPDATE "FeeLedgerEntry" SET narration = 'edited' WHERE id = $1::uuid`, params: [row.id] }]))
        .rejects.toThrow(/append-only/); // suspended + flag still never allows an edit
      const [issue] = await dbA.query<{ id: string }>(`SELECT id FROM "PressIssue" WHERE "schoolId" = $1::uuid LIMIT 1`, schoolId);
      await expect(dbA.transaction([purgeFlag, { sql: `UPDATE "PressIssue" SET serial = 'X' WHERE id = $1::uuid`, params: [issue.id] }]))
        .rejects.toThrow(/immutable/);
    } finally {
      await dbA.execute(`UPDATE "School" SET status = 'LIVE' WHERE id = $1::uuid`, schoolId);
    }
  });

  it('a second restore of the same school is refused before anything is written', async () => {
    const reader = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
    await expect(preflightImport({ db: dbA, files: filesA, machine: A, plan }, reader, { mode: 'restore', finalStatus: 'LIVE' }))
      .rejects.toMatchObject({ code: 'ALREADY_HERE' });
  });
});

describe('5 · import on another machine', () => {
  it('refuses an address another school already has', async () => {
    await prismaB.school.create({ data: { slug: 'taken', name: 'Taken School', tier: 'PRO', status: 'LIVE' } });
    const reader = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
    await expect(preflightImport({ db: dbB, files: filesB, machine: B, plan }, reader, { mode: 'restore', slug: 'taken', finalStatus: 'LIVE' }))
      .rejects.toMatchObject({ code: 'SLUG_TAKEN' });
    await expect(preflightImport({ db: dbB, files: filesB, machine: B, plan }, reader, { mode: 'restore', slug: 'Bad Slug!', finalStatus: 'LIVE' }))
      .rejects.toMatchObject({ code: 'BAD_SLUG' });
  });

  it('refuses a backup from newer code than this machine has', async () => {
    const [last] = await dbB.query<{ id: string }>(`SELECT id FROM "_prisma_migrations" ORDER BY migration_name DESC LIMIT 1`);
    await dbB.execute(`UPDATE "_prisma_migrations" SET rolled_back_at = now() WHERE id = $1`, last.id);
    try {
      const reader = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
      await expect(preflightImport({ db: dbB, files: filesB, machine: B, plan }, reader, { mode: 'restore', finalStatus: 'LIVE' }))
        .rejects.toMatchObject({ code: 'NEWER_SCHEMA' });
    } finally {
      await dbB.execute(`UPDATE "_prisma_migrations" SET rolled_back_at = NULL WHERE id = $1`, last.id);
    }
  });

  it('a failure halfway leaves machine B with nothing of this school', async () => {
    let n = 0;
    const flaky: RawDb = { ...dbB, transaction: async (s) => { n += 1; if (n === 40) throw new Error('connection lost'); return dbB.transaction(s); } };
    const reader = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
    const deps = { db: flaky, files: filesB, machine: B, plan };
    let state = await preflightImport(deps, reader, { mode: 'restore', finalStatus: 'LIVE' });
    await expect((async () => {
      for (;;) { const r = await runImport(deps, reader, state, { deadline: 0 }); if (r.done) return; state = r.state; }
    })()).rejects.toThrow(/connection lost/);
    expect(state.started).toBe(true);
    await rollbackImport({ db: dbB, files: filesB, machine: B, plan }, state);
    expect(total(await snapshot(dbB, schoolId))).toBe(0);
    expect(await dbB.query(`SELECT 1 FROM "School" WHERE id = $1::uuid`, schoolId)).toEqual([]);
    expect(await filesB.list(`schools/${schoolId}/`)).toEqual([]);
  });

  it('imports with everything machine-bound fitted to machine B, and reports what B could not take', async () => {
    const { report } = await importInSteps(dbB, filesB, B, { mode: 'restore', finalStatus: 'LIVE' }, 5);
    const pB = prismaB;

    // The one row machine B cannot hold: its audience link to a school B does not have.
    expect(report.dropped).toEqual([{ table: 'EventAudienceSchool', reason: 'needs a Event that is not on this machine', rows: 1 }]);
    const after = await snapshot(dbB, schoolId);
    expect(total(after)).toBe(total(before) - 1);

    // Links follow the storage; the address follows the host.
    const media = await pB.mediaAsset.findFirstOrThrow({ where: { schoolId } });
    expect(media.url).toBe(`${B.publicBase}/schools/${schoolId}/logo/crest.png`);
    const page = await pB.schoolPage.findFirstOrThrow({ where: { schoolId, slug: 'faculty' } });
    expect(page.blocks).toEqual([
      { t: 'img', url: `${B.publicBase}/schools/${schoolId}/logo/crest.png`, caption: 'Crest' },
      { t: 'cta', label: 'Apply', href: `https://${SLUG}.localhost/admissions` },
    ]);
    const domains = await pB.domain.findMany({ where: { schoolId }, orderBy: { hostname: 'asc' } });
    expect(domains.map((d) => [d.hostname, d.status])).toEqual([[`${SLUG}.localhost`, expect.any(String)], ['www.bksrc-school.org', 'PENDING']]);

    // Secrets re-sealed for B, unreadable with A's keys.
    const cfg = await pB.schoolPaymentConfig.findFirstOrThrow({ where: { schoolId } });
    const salt = (cfg.secrets as Record<string, string>).saltKey;
    expect(openFeeSecret('master-B', schoolId, salt)).toBe('salt-live-123');
    expect(() => openFeeSecret('master-A', schoolId, salt)).toThrow();
    const em = await pB.emailSettings.findUniqueOrThrow({ where: { schoolId } });
    expect(openMailSecret(key(2), em.smtpPassEnc)).toBe('mailbox-pass');

    // Files land in B's only bucket; the private ones too.
    expect((await filesB.list(`schools/${schoolId}/`)).length + (await filesB.list(`print-orders/${schoolId}/`)).length).toBe(3);

    // People sign in with the same password.
    const admin = await pB.user.findFirstOrThrow({ where: { schoolId, email: `admin@${SLUG}.test` } });
    expect(await argonVerify(admin.passwordHash!, 'password')).toBe(true);

    // Everything that is not machine-bound is identical row for row.
    const machineBound = new Set(['MediaAsset', 'SchoolPage', 'Domain', 'SchoolPaymentConfig', 'EmailSettings', 'EventAudienceSchool']);
    for (const [table, rows] of before) {
      if (machineBound.has(table)) continue;
      expect([table, after.get(table)]).toEqual([table, rows]);
    }
  });
});

describe('6 · the writer and reader agree with a real archive', () => {
  it('lists one rows entry per page and nothing it was not given', async () => {
    const r = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
    const names = r.trailer.index.map((e) => e.name);
    expect(names[0]).toBe('school.json');
    expect(names.filter((n) => !/^(rows\/|files\/|school\.json|secrets\.json)/.test(n))).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a writer cannot be resumed into a different archive', async () => {
    const w = await ArchiveWriter.create(new MemorySink(), PW, KDF);
    expect(() => ArchiveWriter.resume(new MemorySink(), 'other password', w.state())).toThrow();
  });
});

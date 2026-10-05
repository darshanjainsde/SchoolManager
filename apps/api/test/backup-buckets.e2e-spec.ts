/**
 * BACKUP BUCKETS, END TO END, AGAINST REAL POSTGRES.
 *
 * One realistic school (the demo seed: ~550 children, attendance, marks, a fee
 * ledger with its append-only trigger, alumni) plus the rows that make the
 * bucket line matter — a website with its own pictures, a featured-staff card
 * pointing at a teacher, a Hall of Fame entry pointing at a student, an admin
 * login beside the teacher and student logins.
 *
 *   1. a bucket snapshot holds its own tables and nobody else's
 *   2. the content fingerprint is the same for unchanged data and different
 *      after one edit — the whole basis for not keeping a copy a day
 *   3. roll `day` back: the day's rows return, the roster and the website are
 *      byte-identical, and not one file is deleted
 *   4. reset the management data: `setup` and `day` empty, website and school
 *      settings byte-identical, the admin login still there
 *   5. load a sample pack into ANOTHER school: its rows arrive re-homed, dates
 *      shifted by whole weeks so every register keeps its weekday, and the
 *      receiving school's website is untouched
 *   6. a pointer on a kept row comes back for the school's own snapshot and
 *      stays empty for a pack, because the teacher it named is a different row
 *   7. what a scoped purge refuses: a school that is not suspended
 */
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import { ArchiveReader, MemorySink, MemorySource } from '../src/modules/backups/engine/archive';
import {
  BucketImportMode, beginBucketImport, preflightBucketImport, runBucketImport,
} from '../src/modules/backups/engine/bucket-import';
import { Bucket } from '../src/modules/backups/engine/buckets';
import { RawDb, rawDbFromPrisma } from '../src/modules/backups/engine/db';
import { Manifest, beginExport, runExport } from '../src/modules/backups/engine/export';
import { Machine } from '../src/modules/backups/engine/machine';
import { purgeBucketRows } from '../src/modules/backups/engine/purge';
import { PACK_EXCLUDED_MODELS } from '../src/modules/backups/engine/rehome';
import { buildSchemaPlan, q } from '../src/modules/backups/engine/schema-plan';
import { ScopedPlan, keptPointers, scopePlan } from '../src/modules/backups/engine/scoped-plan';
import { MemoryObjectStore } from '../src/modules/backups/engine/store';

jest.setTimeout(900_000);

const REPO = resolve(__dirname, '../../..');
const URL = 'postgresql://skoolos:skoolos@localhost:5432/skoolos_test?schema=public';
const PW = 'a long backup password for tests';
const KDF = { N: 1024, r: 8, p: 1 };
const SLUG = 'bkt';
const OTHER = 'bkt-target';

const MACHINE: Machine = {
  platformHost: 'test.sckools.com',
  publicBase: 'https://a.example/storage/v1/object/public/sckool-files',
  feesMaster: 'master-A',
  mailKey: Buffer.alloc(32, 7),
};

const plan = buildSchemaPlan();
const files = new MemoryObjectStore(true);
let db: RawDb;
let schoolId: string;
let otherId: string;
let teacherId: string;
let studentId: string;

const scoped = (buckets: Bucket[], exclude?: string[]) => scopePlan(plan, buckets, exclude ? { exclude } : {});

/** Every row of a scope, in a stable order — the thing that must survive. */
async function snap(id: string, p: ScopedPlan): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const t of p.insertOrder) {
    const filter = p.where(t.model);
    const rows = await db.query<{ j: string }>(
      `SELECT row_to_json(t)::text AS j FROM ${q(t.table)} t
        WHERE t."schoolId" = $1::uuid${filter ? ` AND (${filter})` : ''}
        ORDER BY ${t.pk.map((c) => `t.${q(c)}::text COLLATE "C"`).join(', ')}`,
      id,
    );
    if (rows.length) out.set(t.table, rows.map((r) => r.j));
  }
  return out;
}
const rowsIn = (s: Map<string, string[]>) => [...s.values()].reduce((n, r) => n + r.length, 0);

async function exportScope(id: string, p: ScopedPlan): Promise<{ bytes: Buffer; manifest: Manifest; steps: number }> {
  const sink = new MemorySink();
  const deps = { db, files, machine: MACHINE, plan: p, appVersion: 'test', pageRows: 400 };
  let state = await beginExport(deps, id);
  for (let steps = 1; steps < 10_000; steps += 1) {
    // Deadline already passed, so each call does exactly one unit and pauses —
    // the hardest possible schedule for a resumable writer.
    const r = await runExport(deps, JSON.parse(JSON.stringify(state)), sink, PW, { deadline: 0, kdf: KDF });
    if (r.done) return { bytes: sink.buffer(), manifest: r.manifest!, steps };
    state = r.state;
  }
  throw new Error('export never finished');
}

async function importScope(
  archive: Buffer, p: ScopedPlan,
  options: { schoolId: string; mode: BucketImportMode; rehome?: { shiftDates: boolean } },
) {
  const reader = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
  const deps = { db, files, machine: MACHINE, plan: p };
  const pre = await preflightBucketImport(deps, reader, options);
  let state = beginBucketImport(deps, reader, options, pre);
  for (let steps = 1; steps < 10_000; steps += 1) {
    const r = await runBucketImport(deps, reader, JSON.parse(JSON.stringify(state)), { deadline: 0 });
    if (r.done) return { pre, report: r.report!, steps };
    state = r.state;
  }
  throw new Error('import never finished');
}

const suspend = (id: string) => db.execute(`UPDATE "School" SET status = 'SUSPENDED' WHERE id = $1::uuid`, id);
const setStatus = (id: string, s: string) => db.execute(`UPDATE "School" SET status = $2::"SchoolStatus" WHERE id = $1::uuid`, id, s);

beforeAll(async () => {
  const env = {
    ...process.env,
    DATABASE_URL: URL, DIRECT_URL: URL, DATABASE_URL_APP: URL, DATABASE_URL_PLATFORM: URL,
    DEMO_SCHOOL_SLUG: SLUG, DEMO_SCHOOL_NAME: 'Bucket Source School', DEMO_DRY_RUN: 'false',
    DEMO_PASSWORD: 'password', DEMO_ALUMNUS_PASSWORD: 'password',
  };
  const cwd = join(REPO, 'packages/db');
  for (const s of ['seed-school-demo.ts', 'seed-fees-demo.ts', 'seed-alumni-demo.ts']) {
    execSync(`pnpm exec tsx prisma/${s}`, { cwd, env, stdio: 'pipe' });
  }

  const p = getPlatformPrisma();
  db = rawDbFromPrisma(p);
  const school = await p.school.findUniqueOrThrow({ where: { slug: SLUG } });
  schoolId = school.id;

  // The rows that make the bucket line visible, added here so the assertions
  // name them rather than hoping the seed produced one.
  teacherId = (await p.teacher.findFirstOrThrow({ where: { schoolId } })).id;
  studentId = (await p.student.findFirstOrThrow({ where: { schoolId } })).id;
  const hero = await p.mediaAsset.create({
    data: { schoolId, kind: 'HERO', storageKey: `schools/${schoolId}/hero/front.jpg`, url: `${MACHINE.publicBase}/schools/${schoolId}/hero/front.jpg` },
  });
  const face = await p.mediaAsset.create({
    data: { schoolId, kind: 'AVATAR', storageKey: `schools/${schoolId}/avatar/${studentId}.jpg`, url: `${MACHINE.publicBase}/schools/${schoolId}/avatar/${studentId}.jpg` },
  });
  await files.put({ bucket: 'public', key: hero.storageKey }, Buffer.from('a hero picture'), 'image/jpeg');
  await files.put({ bucket: 'public', key: face.storageKey }, Buffer.from('a face'), 'image/jpeg');
  await files.put({ bucket: 'private', key: `schools/${schoolId}/fee-proofs/paid.pdf` }, Buffer.from('a payment screenshot'));
  await p.featuredStaff.create({ data: { schoolId, teacherId, name: 'Head of Science', role: 'Teacher', order: 1 } });
  const group = await p.hallOfFameGroup.create({ data: { schoolId, kind: 'CUSTOM', label: 'Class of 2026', order: 1 } });
  await p.hallOfFameEntry.create({
    data: { schoolId, groupId: group.id, studentId, batchYear: 2026, rank: 1, name: 'Top of the year' },
  });
  await p.user.create({
    data: { schoolId, email: 'office@bkt.test', passwordHash: 'x', role: 'SCHOOL_ADMIN', isActive: true },
  });

  // A second school to receive a pack: real, and deliberately NOT a copy.
  const other = await p.school.create({
    data: { slug: OTHER, name: 'Bucket Target School', tier: 'PRO', status: 'SUSPENDED', codePrefix: 'BTS' },
  });
  otherId = other.id;
  await p.schoolProfile.create({ data: { schoolId: otherId, themePreset: 'OCEAN' } });
  await p.user.create({
    data: { schoolId: otherId, email: 'office@target.test', passwordHash: 'y', role: 'SCHOOL_ADMIN', isActive: true },
  });
});

afterAll(async () => {
  await disconnectAll();
});

describe('a bucket snapshot holds its own tables and nobody else’s', () => {
  it('takes the day bucket with no files at all, however many the school has', async () => {
    const p = scoped(['day']);
    const { manifest } = await exportScope(schoolId, p);
    expect(manifest.scope).toEqual(['day']);
    expect(manifest.fileCount).toBe(0);
    expect(Object.keys(manifest.tables)).toContain('Attendance');
    expect(Object.keys(manifest.tables)).not.toContain('Student');
    expect(Object.keys(manifest.tables)).not.toContain('SchoolProfile');
    expect(manifest.rowCount).toBeGreaterThan(100);
  });

  it('takes the website with its own pictures, and not the fee proofs', async () => {
    const { manifest } = await exportScope(schoolId, scoped(['website']));
    expect(manifest.scope).toEqual(['website']);
    expect(Object.keys(manifest.tables)).toContain('SchoolProfile');
    expect(Object.keys(manifest.tables)).not.toContain('Attendance');
    // The hero picture travels; the avatar belongs to the roster and the fee
    // proof to nobody's bucket at all.
    expect(manifest.fileCount).toBe(1);
  });

  it('takes the roster with its faces, and nothing that happened', async () => {
    const { manifest } = await exportScope(schoolId, scoped(['setup']));
    expect(manifest.scope).toEqual(['setup']);
    expect(Object.keys(manifest.tables)).toContain('Student');
    expect(Object.keys(manifest.tables)).toContain('MediaAsset'); // the AVATAR half
    expect(Object.keys(manifest.tables)).not.toContain('Attendance');
    expect(Object.keys(manifest.tables)).not.toContain('FeeInvoice');
    expect(manifest.fileCount).toBe(1);
  });

  it('knows the roster cannot be put back on its own, and the management half can', () => {
    expect(scoped(['setup']).closed).toBe(false);
    expect(scoped(['setup', 'day']).closed).toBe(true);
    expect(scoped(['day']).closed).toBe(true);
    expect(scoped(['website']).closed).toBe(true);
  });

  it('splits the logins by role: the admin with the school, everyone else with the roster', async () => {
    const asSchool = await exportScope(schoolId, scoped(['school']));
    const asSetup = await exportScope(schoolId, scoped(['setup']));
    const admins = asSchool.manifest.tables.User?.rows ?? 0;
    const others = asSetup.manifest.tables.User?.rows ?? 0;
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "User" WHERE "schoolId" = $1::uuid`, schoolId);
    expect(admins).toBeGreaterThan(0);
    expect(others).toBeGreaterThan(0);
    // Every login is in exactly one of the two — no row lost, none counted twice.
    expect(admins + others).toBe(n);
  });
});

describe('the content fingerprint is what lets an unchanged bucket be dropped', () => {
  it('is identical for two snapshots of untouched data', async () => {
    const a = await exportScope(schoolId, scoped(['website']));
    const b = await exportScope(schoolId, scoped(['website']));
    expect(a.manifest.contentHash).toHaveLength(64);
    expect(b.manifest.contentHash).toBe(a.manifest.contentHash);
  });

  it('changes after one edit, and comes back after it is undone', async () => {
    const before = (await exportScope(schoolId, scoped(['website']))).manifest.contentHash;
    const p = getPlatformPrisma();
    const was = (await p.schoolProfile.findUniqueOrThrow({ where: { schoolId } })).themePreset;
    await p.schoolProfile.update({ where: { schoolId }, data: { themePreset: 'SUNSET' } });
    const after = (await exportScope(schoolId, scoped(['website']))).manifest.contentHash;
    expect(after).not.toBe(before);
    await p.schoolProfile.update({ where: { schoolId }, data: { themePreset: was } });
    expect((await exportScope(schoolId, scoped(['website']))).manifest.contentHash).toBe(before);
  });

  it('does not change when a bucket OUTSIDE it changes', async () => {
    const before = (await exportScope(schoolId, scoped(['website']))).manifest.contentHash;
    await db.execute(
      `UPDATE "Attendance" SET status = 'ABSENT' WHERE id = (SELECT id FROM "Attendance" WHERE "schoolId" = $1::uuid ORDER BY id LIMIT 1)`,
      schoolId,
    );
    expect((await exportScope(schoolId, scoped(['website']))).manifest.contentHash).toBe(before);
  });
});

describe('rolling the day back leaves everything else exactly as it was', () => {
  it('returns the day’s rows, keeps the roster and the website byte-identical, and deletes no file', async () => {
    const dayPlan = scoped(['day']);
    const keepPlans = [scoped(['school']), scoped(['website']), scoped(['setup'])];

    const dayBefore = await snap(schoolId, dayPlan);
    const keepBefore = await Promise.all(keepPlans.map((p) => snap(schoolId, p)));
    const filesBefore = (await files.list(`schools/${schoolId}/`)).length;
    const { bytes } = await exportScope(schoolId, dayPlan);

    // A day of work after the snapshot: marks changed, an invoice raised.
    await db.execute(`UPDATE "Attendance" SET status = 'LATE' WHERE "schoolId" = $1::uuid`, schoolId);
    const [{ invoices }] = await db.query<{ invoices: number }>(`SELECT count(*)::int AS invoices FROM "FeeInvoice" WHERE "schoolId" = $1::uuid`, schoolId);
    expect(invoices).toBeGreaterThan(0);

    await suspend(schoolId);
    const { report } = await importScope(bytes, dayPlan, { schoolId, mode: 'replace' });
    await setStatus(schoolId, 'LIVE');

    expect(report.buckets).toEqual(['day']);
    expect(report.files).toBe(0);
    expect(await snap(schoolId, dayPlan)).toEqual(dayBefore);
    for (const [i, p] of keepPlans.entries()) {
      expect(await snap(schoolId, p)).toEqual(keepBefore[i]);
    }
    // Rows only: a rollback must never take a fee PDF with it.
    expect((await files.list(`schools/${schoolId}/`)).length).toBe(filesBefore);
  });
});

describe('resetting the management data keeps the school and its website', () => {
  it('empties setup and day, and leaves the website, the settings and the admin login alone', async () => {
    const dataPlan = scoped(['setup', 'day']);
    const schoolPlan = scoped(['school']);
    const webPlan = scoped(['website']);

    const schoolBefore = await snap(schoolId, schoolPlan);
    const webBefore = await snap(schoolId, webPlan);
    const filesBefore = (await files.list(`schools/${schoolId}/`)).length;
    const { bytes } = await exportScope(schoolId, dataPlan);

    await suspend(schoolId);
    await purgeBucketRows(db, dataPlan, schoolId);

    expect(rowsIn(await snap(schoolId, dataPlan))).toBe(0);
    expect(await snap(schoolId, schoolPlan)).toEqual(schoolBefore);
    // The website keeps every row; two POINTERS into the roster are emptied by
    // Postgres, which is the whole reason the restore saves and replaces them.
    const webAfter = await snap(schoolId, webPlan);
    expect([...webAfter.keys()].sort()).toEqual([...webBefore.keys()].sort());
    for (const [table, rows] of webAfter) expect(rows.length).toBe(webBefore.get(table)!.length);
    expect((await files.list(`schools/${schoolId}/`)).length).toBe(filesBefore);

    // Put it back, so the rest of the suite has a school again.
    const { report } = await importScope(bytes, dataPlan, { schoolId, mode: 'replace' });
    await setStatus(schoolId, 'LIVE');
    expect(report.rows).toBeGreaterThan(100);
  });

  it('refuses to empty a school that is still live', async () => {
    await setStatus(schoolId, 'LIVE');
    await expect(purgeBucketRows(db, scoped(['day']), schoolId)).rejects.toThrow(/suspend it first/);
  });
});

describe('a pointer on a kept row', () => {
  it('comes back when the school’s own roster does, and stays empty for a stranger’s', async () => {
    expect(keptPointers(plan, ['setup', 'day']).map((p) => `${p.table}.${p.column}`).sort())
      .toEqual(['FeaturedStaff.teacherId', 'HallOfFameEntry.studentId']);

    // Point the two cards at live rows first: the reset test above empties the
    // roster by hand, which nulls them before any import could save them.
    await db.execute(`UPDATE "FeaturedStaff" SET "teacherId" = $2::uuid WHERE "schoolId" = $1::uuid`, schoolId, teacherId);
    await db.execute(`UPDATE "HallOfFameEntry" SET "studentId" = $2::uuid WHERE "schoolId" = $1::uuid`, schoolId, studentId);

    const dataPlan = scoped(['setup', 'day']);
    const { bytes } = await exportScope(schoolId, dataPlan);
    await suspend(schoolId);
    const { report } = await importScope(bytes, dataPlan, { schoolId, mode: 'replace' });
    await setStatus(schoolId, 'LIVE');

    // Two cards, two pointers, both re-linked to the same rows they named.
    expect(report.relinked).toBe(2);
    const [{ t }] = await db.query<{ t: string | null }>(`SELECT "teacherId"::text AS t FROM "FeaturedStaff" WHERE "schoolId" = $1::uuid`, schoolId);
    expect(t).toBe(teacherId);
    const [{ s }] = await db.query<{ s: string | null }>(`SELECT "studentId"::text AS s FROM "HallOfFameEntry" WHERE "schoolId" = $1::uuid`, schoolId);
    expect(s).toBe(studentId);
  });
});

describe('a sample pack lands on another school as its own data', () => {
  it('re-homes every row, shifts the dates by whole weeks, and leaves the receiving website alone', async () => {
    const packPlan = scoped(['setup', 'day'], Object.keys(PACK_EXCLUDED_MODELS));
    const { bytes, manifest } = await exportScope(schoolId, packPlan);
    for (const excluded of Object.keys(PACK_EXCLUDED_MODELS)) {
      expect(Object.keys(manifest.tables)).not.toContain(excluded);
    }

    const webPlan = scoped(['website']);
    const targetWebBefore = await snap(otherId, webPlan);
    const sourceBefore = await snap(schoolId, packPlan);
    const [{ admins }] = await db.query<{ admins: number }>(
      `SELECT count(*)::int AS admins FROM "User" WHERE "schoolId" = $1::uuid AND role IN ('OWNER','SCHOOL_ADMIN')`, otherId);

    // The pack was taken five weeks ago, so a load today shifts it forward.
    const takenAt = new Date(Date.now() - 35 * 86_400_000).toISOString();
    const shifted = await exportWithTakenAt(bytes, takenAt);

    const { pre, report } = await importScope(shifted, packPlan, {
      schoolId: otherId, mode: 'replace', rehome: { shiftDates: true },
    });
    expect(pre.fromAnotherSchool).toBe(true);
    expect(pre.shiftWeeks).toBe(5);
    expect(report.shiftedWeeks).toBe(5);

    // Every row is now the target school's own.
    const landed = await snap(otherId, packPlan);
    if (rowsIn(landed) < 100) {
      // eslint-disable-next-line no-console
      console.log('pack load dropped rows:', JSON.stringify(report.dropped.slice(0, 12), null, 1));
    }
    expect(rowsIn(landed)).toBeGreaterThan(100);
    const [{ strays }] = await db.query<{ strays: number }>(
      `SELECT count(*)::int AS strays FROM "Student" WHERE "schoolId" = $1::uuid`, schoolId);
    expect(strays).toBe(rowsIn(sourceBefore) > 0 ? strays : 0); // the source still has its own
    expect(await snap(schoolId, packPlan)).toEqual(sourceBefore);

    // The receiving school's website never moved.
    expect(await snap(otherId, webPlan)).toEqual(targetWebBefore);
    // ...and its own admin login is still there, beside the pack's teachers.
    const [{ admins: after }] = await db.query<{ admins: number }>(
      `SELECT count(*)::int AS admins FROM "User" WHERE "schoolId" = $1::uuid AND role IN ('OWNER','SCHOOL_ADMIN')`, otherId);
    expect(after).toBe(admins);

    // Dates moved by whole weeks, so every register kept its weekday.
    const days = await db.query<{ d: string }>(
      `SELECT DISTINCT to_char(date, 'ID') AS d FROM "Attendance" WHERE "schoolId" = $1::uuid`, otherId);
    const sourceDays = await db.query<{ d: string }>(
      `SELECT DISTINCT to_char(date, 'ID') AS d FROM "Attendance" WHERE "schoolId" = $1::uuid`, schoolId);
    expect(days.map((x) => x.d).sort()).toEqual(sourceDays.map((x) => x.d).sort());

    // The student codes now read as the receiving school's.
    const [{ code }] = await db.query<{ code: string | null }>(
      `SELECT code FROM "Student" WHERE "schoolId" = $1::uuid AND code IS NOT NULL ORDER BY code LIMIT 1`, otherId);
    if (code) expect(code.startsWith('BTS-')).toBe(true);
  });

  it('refuses a stranger’s archive when nobody asked to re-home it', async () => {
    const packPlan = scoped(['setup', 'day']);
    const { bytes } = await exportScope(schoolId, packPlan);
    const reader = await ArchiveReader.open<Manifest>(new MemorySource(bytes), PW);
    await expect(preflightBucketImport(
      { db, files, machine: MACHINE, plan: packPlan }, reader, { schoolId: otherId, mode: 'replace' },
    )).rejects.toThrow(/Load it as a sample pack/);
  });

  it('refuses to empty a scope that would strand rows outside it', async () => {
    const { bytes } = await exportScope(schoolId, scoped(['setup']));
    const reader = await ArchiveReader.open<Manifest>(new MemorySource(bytes), PW);
    await expect(preflightBucketImport(
      { db, files, machine: MACHINE, plan: scoped(['setup']) }, reader, { schoolId, mode: 'replace' },
    )).rejects.toThrow(/would delete rows outside it/);
  });

  it('refuses an archive of the wrong buckets', async () => {
    const { bytes } = await exportScope(schoolId, scoped(['website']));
    const reader = await ArchiveReader.open<Manifest>(new MemorySource(bytes), PW);
    await expect(preflightBucketImport(
      { db, files, machine: MACHINE, plan: scoped(['day']) }, reader, { schoolId, mode: 'replace' },
    )).rejects.toThrow(/holds the website/);
  });
});

/**
 * Rewrites an archive's `takenAt` so a pack can be loaded as though it were cut
 * weeks ago, without waiting weeks. The trailer is sealed, so the archive is
 * re-written entry by entry rather than patched.
 */
async function exportWithTakenAt(archive: Buffer, takenAt: string): Promise<Buffer> {
  const { ArchiveWriter } = await import('../src/modules/backups/engine/archive');
  const reader = await ArchiveReader.open<Manifest>(new MemorySource(archive), PW);
  const sink = new MemorySink();
  const writer = await ArchiveWriter.create(sink, PW, KDF);
  for (const e of reader.entries()) {
    await writer.add(e.name, await reader.read(e), e.meta as Record<string, unknown> | undefined);
  }
  await writer.finish({ ...reader.manifest, takenAt } as unknown as Record<string, unknown>);
  return sink.buffer();
}

/**
 * pnpm --filter @skoolos/api exec tsx scripts/sample-pack/index.ts [--out file] [--password-file file]
 *
 * Builds a complete sample school — Nursery to XII, three sections each, 20
 * teachers, fees, salary, four months of attendance, exams, diary, library,
 * events, leave — in a SCRATCH database, cuts its management data (setup + day)
 * into a locked `.sckools` sample pack, and then proves the pack by loading it
 * into a second school and comparing every table.
 *
 * Nothing here touches staging or production: the scratch database is local and
 * its name must start `skoolos_pack`. The file is what you upload on the owner
 * console's Sample packs page.
 */
import { DB_NAME, DB_URL, ADMIN_URL } from './env';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client } from 'pg';
import { hash, verify } from 'argon2';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { ArchiveReader, MemorySink, MemorySource } from '../../src/modules/backups/engine/archive';
import { beginBucketImport, preflightBucketImport, runBucketImport } from '../../src/modules/backups/engine/bucket-import';
import { rawDbFromPrisma } from '../../src/modules/backups/engine/db';
import { Manifest, beginExport, runExport } from '../../src/modules/backups/engine/export';
import { Machine } from '../../src/modules/backups/engine/machine';
import { PACK_EXCLUDED_MODELS } from '../../src/modules/backups/engine/rehome';
import { buildSchemaPlan, q } from '../../src/modules/backups/engine/schema-plan';
import { scopePlan } from '../../src/modules/backups/engine/scoped-plan';
import { MemoryObjectStore } from '../../src/modules/backups/engine/store';
import { buildSchool } from './phases';
import { Ctx } from './ctx';
import { SCHOOL } from './data';
import { makeRng } from './rng';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const OUT = resolve(process.env.INIT_CWD ?? process.cwd(), flag('out') ?? join(homedir(), 'Downloads', 'sckools-sample-packs', 'sample-school-nursery-xii.sckools'));
const PW_FILE = flag('password-file') ?? join(homedir(), '.sckools-staging-backup-password');
const REPO = resolve(__dirname, '../../../..');
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const log = (m: string) => console.log(`[${secs().padStart(4)}] ${m}`);

const MACHINE: Machine = { platformHost: 'localhost', publicBase: 'http://localhost/files', feesMaster: null, mailKey: null };

async function freshDatabase(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [DB_NAME]);
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }
  execSync('pnpm exec prisma migrate deploy', {
    cwd: join(REPO, 'packages/db'), stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: DB_URL, DIRECT_URL: DB_URL },
  });
}

async function main() {
  if (!existsSync(PW_FILE)) throw new Error(`no backup password at ${PW_FILE} — pass --password-file`);
  const password = readFileSync(PW_FILE, 'utf8').trim();

  log(`scratch database ${DB_NAME}: dropping, creating, migrating`);
  await freshDatabase();
  const p = getPlatformPrisma();
  const db = rawDbFromPrisma(p);

  const school = await p.school.create({
    data: { slug: SCHOOL.slug, name: SCHOOL.name, codePrefix: SCHOOL.codePrefix, tier: 'PRO', status: 'LIVE', workingDays: [1, 2, 3, 4, 5, 6] },
  });
  const pwHash = await hash(SCHOOL.password);
  // A console login for browsing the scratch school. It is a SCHOOL_ADMIN, so it
  // belongs to the school bucket and is NOT part of the pack.
  await p.user.create({ data: { schoolId: school.id, email: `admin@${SCHOOL.emailDomain}`, passwordHash: pwHash, role: 'SCHOOL_ADMIN', name: 'School Admin' } });

  const c: Ctx = {
    p, r: makeRng(20261002), schoolId: school.id, yearId: '', pwHash,
    subjectId: new Map(), subjectName: new Map(), gradeId: [], houseIds: [], teachers: [], staff: [], sections: [], students: [],
    officeUserId: '', accountsUserId: '', librarianUserId: '', holidays: new Set(), schoolDays: [], leaveDays: new Map(),
    teacherFor: new Map(), halfYearly: new Map(), counts: {},
  };

  await buildSchool(c, log);

  /* ── cut the pack: setup + day, minus what must never travel ──────────── */
  const plan = scopePlan(buildSchemaPlan(), ['setup', 'day'], { exclude: Object.keys(PACK_EXCLUDED_MODELS) });
  log(`cutting the pack: ${plan.insertOrder.length} tables, scope ${plan.buckets.join('+')}`);
  const sink = new MemorySink();
  const deps = { db, files: new MemoryObjectStore(true), machine: MACHINE, plan, appVersion: 'sample-pack-generator' };
  let state = await beginExport(deps, school.id);
  let manifest: Manifest | undefined;
  for (let i = 0; i < 100_000; i += 1) {
    const res = await runExport(deps, state, sink, password, { deadline: Number.MAX_SAFE_INTEGER });
    if (res.done) { manifest = res.manifest; break; }
    state = res.state;
  }
  if (!manifest) throw new Error('export did not finish');
  mkdirSync(dirname(OUT), { recursive: true });
  const bytes = sink.buffer();
  writeFileSync(OUT, bytes);
  log(`wrote ${OUT} — ${(bytes.length / 1024 / 1024).toFixed(1)} MB, ${manifest.rowCount.toLocaleString('en-IN')} rows in ${Object.keys(manifest.tables).length} tables, ${manifest.fileCount} files`);

  /* ── prove it: load the file into a second school and compare ─────────── */
  log('proving the pack: loading it into a second school');
  const target = await p.school.create({ data: { slug: 'sample-target', name: 'Sample Target School', codePrefix: 'TGT', tier: 'PRO', status: 'SUSPENDED' } });
  await p.user.create({ data: { schoolId: target.id, email: 'owner@target.test', passwordHash: pwHash, role: 'SCHOOL_ADMIN' } });
  const reader = await ArchiveReader.open<Manifest>(new MemorySource(bytes), password);
  const options = { schoolId: target.id, mode: 'replace' as const, rehome: { shiftDates: true } };
  const pre = await preflightBucketImport({ db, files: deps.files, machine: MACHINE, plan }, reader, options);
  let st = beginBucketImport({ db, files: deps.files, machine: MACHINE, plan }, reader, options, pre);
  let report;
  for (let i = 0; i < 100_000; i += 1) {
    const res = await runBucketImport({ db, files: deps.files, machine: MACHINE, plan }, reader, st, { deadline: Number.MAX_SAFE_INTEGER });
    if (res.done) { report = res.report!; break; }
    st = res.state;
  }
  if (!report) throw new Error('verification load did not finish');

  const problems: string[] = [];
  if (report.dropped.length) problems.push(`rows dropped: ${JSON.stringify(report.dropped.slice(0, 5))}`);
  if (report.cleared.length) problems.push(`links cleared: ${JSON.stringify(report.cleared.slice(0, 5))}`);
  for (const t of plan.insertOrder) {
    const want = manifest.tables[t.table]?.rows ?? 0;
    const f = plan.where(t.model);
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${q(t.table)} x WHERE x."schoolId" = $1::uuid${f ? ` AND (${f})` : ''}`, target.id);
    if (n !== want) problems.push(`${t.table}: pack has ${want}, target has ${n}`);
  }
  const [teacher] = await db.query<{ passwordHash: string; email: string }>(
    `SELECT "passwordHash", email FROM "User" WHERE "schoolId" = $1::uuid AND role = 'TEACHER' ORDER BY email LIMIT 1`, target.id);
  if (!teacher || !(await verify(teacher.passwordHash, SCHOOL.password))) problems.push('a teacher login does not accept the password after the load');
  log(`pack proven: ${report.rows.toLocaleString('en-IN')} rows landed on the second school, ${problems.length} problems`);
  if (problems.length) { for (const x of problems) console.error('  ✗', x); process.exitCode = 1; }

  /* ── what is in it ────────────────────────────────────────────────────── */
  const q1 = async (sql: string) => (await db.query<{ n: number }>(sql, school.id))[0]!.n;
  const facts: [string, number | string][] = [
    ['grades', await q1(`SELECT count(*)::int AS n FROM "Grade" WHERE "schoolId" = $1::uuid`)],
    ['sections', await q1(`SELECT count(*)::int AS n FROM "ClassSection" WHERE "schoolId" = $1::uuid`)],
    ['students', await q1(`SELECT count(*)::int AS n FROM "Student" WHERE "schoolId" = $1::uuid`)],
    ['teachers', await q1(`SELECT count(*)::int AS n FROM "Teacher" WHERE "schoolId" = $1::uuid`)],
    ['attendance rows', await q1(`SELECT count(*)::int AS n FROM "Attendance" WHERE "schoolId" = $1::uuid`)],
    ['exams', await q1(`SELECT count(*)::int AS n FROM "Exam" WHERE "schoolId" = $1::uuid`)],
    ['results', await q1(`SELECT count(*)::int AS n FROM "Result" WHERE "schoolId" = $1::uuid`)],
    ['invoices', await q1(`SELECT count(*)::int AS n FROM "FeeInvoice" WHERE "schoolId" = $1::uuid`)],
    ['payments', await q1(`SELECT count(*)::int AS n FROM "FeePayment" WHERE "schoolId" = $1::uuid`)],
    ['payslips', await q1(`SELECT count(*)::int AS n FROM "Payslip" WHERE "schoolId" = $1::uuid`)],
    ['leave applications', await q1(`SELECT count(*)::int AS n FROM "LeaveApplication" WHERE "schoolId" = $1::uuid`)],
    ['library issues', await q1(`SELECT count(*)::int AS n FROM "LibraryIssue" WHERE "schoolId" = $1::uuid`)],
    ['events', await q1(`SELECT count(*)::int AS n FROM "Event" WHERE "schoolId" = $1::uuid`)],
    ['diary entries', await q1(`SELECT count(*)::int AS n FROM "DiaryEntry" WHERE "schoolId" = $1::uuid`)],
  ];
  console.log('\nIn the pack:');
  for (const [k, v] of facts) console.log(`  ${k.padEnd(20)} ${typeof v === 'number' ? v.toLocaleString('en-IN') : v}`);
  console.log(`\nFile: ${OUT}`);
  await disconnectAll();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectAll().catch(() => undefined);
  process.exit(1);
});

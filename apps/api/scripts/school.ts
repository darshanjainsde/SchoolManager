/**
 * pnpm school — one school as one file, on any machine that runs this code.
 *
 *   pnpm school export <slug> [--out file.sckools]
 *   pnpm school inspect <file.sckools>
 *   pnpm school import <file.sckools> [--slug new-address] [--status LIVE|SUSPENDED|SETUP] [--replace]
 *
 * Common flags:
 *   --password <pw>   the backup password (else SCHOOL_BACKUP_PASSWORD, else asked)
 *   --env <path>      read settings from this .env file (default: ./.env if present)
 *
 * Needs, from the environment or the .env file:
 *   DATABASE_URL       the database to read from / write into (owner or platform role)
 *   S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET[, S3_PRIVATE_BUCKET, S3_PUBLIC_URL_BASE]
 *   PLATFORM_HOST      this machine's host (e.g. localhost, test.sckools.com)
 *   FEES_SECRET_KEY, EMAIL_SECRET_KEY   optional — without them, gateway keys and a
 *                      school's own mailbox password are not carried; the school re-enters them.
 *
 * There is no time limit here (unlike a server request), so this is the path
 * for very large schools and for laptops. It runs the SAME engine as the owner
 * console; a file from one opens in the other.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
/** Flags that take a value; everything else starting with -- is a switch. */
const VALUED = new Set(['password', 'env', 'out', 'slug', 'status']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(argv[i - 1].replace(/^--/, ''))));
/** pnpm runs scripts inside apps/api; paths the person typed are relative to where THEY were. */
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);

// Settings: an explicit --env file, else ./.env where the person ran this. Never overrides a real env var.
(() => {
  const file = flag('env') ? here(flag('env')!) : here('.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
})();

async function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = (rl as unknown as { _writeToOutput: (s: string) => void });
  const original = write._writeToOutput.bind(rl);
  write._writeToOutput = (s: string) => (s.includes(question) ? original(s) : original(''));
  const answer = await new Promise<string>((res) => rl.question(question, res));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function password(): Promise<string> {
  const pw = flag('password') ?? process.env.SCHOOL_BACKUP_PASSWORD;
  if (pw) return pw;
  if (!process.stdin.isTTY) throw new Error('No backup password: pass --password or set SCHOOL_BACKUP_PASSWORD.');
  return askHidden('Backup password: ');
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const fail = (msg: string): never => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

async function main() {
  const [cmd, target] = positional;
  if (!cmd || !['export', 'import', 'inspect'].includes(cmd) || !target) {
    console.log(readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    process.exit(cmd ? 1 : 0);
  }

  // Engine imports after the env is loaded: some modules read it at import.
  const { getPlatformPrisma, disconnectAll } = await import('@skoolos/db');
  const { ArchiveReader } = await import('../src/modules/backups/engine/archive');
  const { rawDbFromPrisma } = await import('../src/modules/backups/engine/db');
  const { beginExport, runExport } = await import('../src/modules/backups/engine/export');
  const { preflightImport, runImport, rollbackImport, ImportFailed } = await import('../src/modules/backups/engine/import');
  const { machineFromEnv } = await import('../src/modules/backups/engine/machine');
  const { purgeSchoolFiles, purgeSchoolRows } = await import('../src/modules/backups/engine/purge');
  const { buildSchemaPlan } = await import('../src/modules/backups/engine/schema-plan');
  const { FileSink, FileSource, S3ObjectStore, s3Client } = await import('../src/modules/backups/engine/store');
  type Manifest = import('../src/modules/backups/engine/export').Manifest;

  const pw = await password();

  if (cmd === 'inspect') {
    const src = await FileSource.open(here(target));
    const r = await ArchiveReader.open<Manifest>(src, pw).catch((e: Error) => fail(e.message));
    const m = r.manifest;
    console.log(`\n${m.source.name} (${m.source.slug})  — taken ${m.takenAt} on ${m.source.machine.platformHost}`);
    console.log(`  ${m.rowCount.toLocaleString('en-IN')} rows in ${Object.keys(m.tables).length} tables · ${m.fileCount} files (${mb(m.fileBytes)}) · file ${mb(r.bytes)}`);
    console.log(`  schema: ${m.migrations.length} migrations, newest ${m.migrations[m.migrations.length - 1]}`);
    if (m.warnings.length) console.log(`  warnings:\n    - ${m.warnings.join('\n    - ')}`);
    await src.close();
    return;
  }

  for (const k of ['DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET']) {
    if (!process.env[k] && !(k === 'DATABASE_URL' && process.env.DATABASE_URL_PLATFORM)) fail(`${k} is not set (environment or --env file).`);
  }
  const env = {
    PLATFORM_HOST: process.env.PLATFORM_HOST ?? 'localhost', S3_PUBLIC_URL_BASE: process.env.S3_PUBLIC_URL_BASE,
    S3_ENDPOINT: process.env.S3_ENDPOINT!, S3_BUCKET: process.env.S3_BUCKET!, EMAIL_SECRET_KEY: process.env.EMAIL_SECRET_KEY,
  };
  const cfg = {
    endpoint: env.S3_ENDPOINT, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY!, bucket: env.S3_BUCKET, privateBucket: process.env.S3_PRIVATE_BUCKET ?? null,
  };
  const deps = { db: rawDbFromPrisma(getPlatformPrisma()), files: new S3ObjectStore(s3Client(cfg), cfg), machine: machineFromEnv(env), plan: buildSchemaPlan() };
  console.log(`machine: ${deps.machine.platformHost} · storage ${deps.machine.publicBase} · fee keys ${deps.machine.feesMaster ? 'yes' : 'no'} · mail key ${deps.machine.mailKey ? 'yes' : 'no'}`);

  const exportTo = async (schoolId: string, out: string) => {
    const sink = await FileSink.create(out);
    let state = await beginExport({ ...deps, appVersion: process.env.GIT_SHA ?? null }, schoolId);
    let last = -1;
    for (;;) {
      const r = await runExport(deps, state, sink, pw, { deadline: Date.now() + 5_000 });
      if (r.done) return r;
      state = r.state;
      const pct = Math.floor((100 * state.table) / deps.plan.insertOrder.length);
      if (pct !== last && state.phase === 'rows') { process.stdout.write(`\r  copying rows… ${pct}%   `); last = pct; }
      if (state.phase === 'files') process.stdout.write(`\r  copying files… ${state.file}/${state.files?.length ?? '?'}   `);
    }
  };

  if (cmd === 'export') {
    const [school] = await deps.db.query<{ id: string; slug: string; name: string }>(`SELECT id, slug, name FROM "School" WHERE slug = $1 OR id::text = $1`, target);
    if (!school) fail(`No school "${target}" in this database.`);
    const out = here(flag('out') ?? `${school.slug}-${new Date().toISOString().slice(0, 10)}.sckools`);
    console.log(`Backing up ${school.name} (${school.slug}) → ${out}`);
    const r = await exportTo(school.id, out);
    console.log(`\n✓ ${r.manifest!.rowCount.toLocaleString('en-IN')} rows, ${r.manifest!.fileCount} files — ${mb(r.bytes!)}`);
    if (r.manifest!.warnings.length) console.log(`  warnings:\n    - ${r.manifest!.warnings.join('\n    - ')}`);
    await disconnectAll();
    return;
  }

  // ── import ──
  const src = await FileSource.open(here(target));
  const reader = await ArchiveReader.open<Manifest>(src, pw).catch((e: Error) => fail(e.message));
  const m = reader.manifest;
  const replace = has('replace');
  const status = (flag('status') ?? 'LIVE').toUpperCase() as 'LIVE' | 'SUSPENDED' | 'SETUP';
  if (!['LIVE', 'SUSPENDED', 'SETUP'].includes(status)) fail('--status must be LIVE, SUSPENDED or SETUP.');
  console.log(`Importing ${m.source.name} (${m.source.slug}) from ${m.source.machine.platformHost}, taken ${m.takenAt}`);

  const opts = { mode: replace ? 'replace' as const : 'restore' as const, slug: flag('slug'), finalStatus: status };
  const [existing] = await deps.db.query<{ slug: string; status: string }>(`SELECT slug, status::text AS status FROM "School" WHERE id = $1::uuid`, m.source.schoolId);
  if (existing && !replace) fail(`This school is already here as "${existing.slug}". Re-run with --replace to overwrite it (a safety backup is written first).`);
  if (!existing && replace) fail('--replace was given, but this school is not here. Drop --replace.');
  let state;
  try {
    state = await preflightImport(deps, reader, existing ? { ...opts, mode: 'restore' } : opts).catch((e) => {
      if (existing && e.code === 'ALREADY_HERE') return null; // expected: it is about to be replaced
      throw e;
    });
  } catch (e) {
    fail((e as Error).message);
  }

  let safety: string | null = null;
  if (existing) {
    safety = here(`${existing.slug}-before-replace-${new Date().toISOString().replace(/[:.]/g, '-')}.sckools`);
    console.log(`Saving the current copy first → ${safety}`);
    await deps.db.execute(`UPDATE "School" SET status = 'SUSPENDED', "statusChangedAt" = $2::timestamp(3) WHERE id = $1::uuid`, m.source.schoolId, new Date().toISOString());
    try {
      const saved = await exportTo(m.source.schoolId, safety);
      // Read it back before anything is removed — a file that does not open is not a backup.
      const check = await FileSource.open(safety);
      const back = await ArchiveReader.open<Manifest>(check, pw);
      await check.close();
      if (back.manifest.rowCount !== saved.manifest!.rowCount) throw new Error('the safety backup does not read back the same');
    } catch (e) {
      await deps.db.execute(`UPDATE "School" SET status = $2::"SchoolStatus", "statusChangedAt" = $3::timestamp(3) WHERE id = $1::uuid`, m.source.schoolId, existing.status, new Date().toISOString());
      fail(`The current copy could not be saved (${(e as Error).message}), so nothing was replaced. The school is back as it was.`);
    }
    console.log('\n  removing the current copy…');
    await purgeSchoolRows(deps.db, deps.plan, m.source.schoolId);
    await purgeSchoolFiles(deps.files, m.source.schoolId);
    state = await preflightImport(deps, reader, opts);
  }

  try {
    let s = state!;
    for (;;) {
      const r = await runImport(deps, reader, s, { deadline: Date.now() + 5_000 });
      if (r.done) {
        const rep = r.report!;
        console.log(`\n✓ ${rep.rows.toLocaleString('en-IN')} rows and ${rep.files} files imported as "${rep.slug}" — https://${rep.slug}.${deps.machine.platformHost}`);
        for (const d of rep.dropped) console.log(`  not imported: ${d.rows} × ${d.table} — ${d.reason}`);
        for (const c of rep.cleared) console.log(`  link cleared: ${c.rows} × ${c.table}.${c.column} (its target is not on this machine)`);
        if (rep.warnings.length) console.log(`  warnings:\n    - ${rep.warnings.slice(0, 30).join('\n    - ')}${rep.warnings.length > 30 ? `\n    … ${rep.warnings.length - 30} more` : ''}`);
        console.log('  A running API keeps cached addresses and feature flags for a few minutes.');
        break;
      }
      s = r.state;
      process.stdout.write(`\r  ${s.phase}… ${s.phase === 'rows' ? Math.floor((100 * s.table) / deps.plan.insertOrder.length) + '%' : ''}   `);
      state = s;
    }
  } catch (e) {
    console.error(`\n✗ ${(e as Error).message}\n  Removing what this import wrote…`);
    const reached = e instanceof ImportFailed ? e.state : state!;
    await rollbackImport(deps, reached).catch((re: Error) => console.error(`  rollback failed: ${re.message}`));
    if (safety) console.error(`  The school as it was before is in ${safety} — import that to bring it back.`);
    process.exit(1);
  } finally {
    await src.close();
    await disconnectAll();
  }
}

main().catch((e) => fail((e as Error).message));

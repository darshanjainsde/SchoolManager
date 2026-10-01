import { gunzipSync } from 'node:zlib';
import { ArchiveReader } from './archive';
import { appliedMigrations, ColumnInfo, pgCode, RawDb, tableColumns } from './db';
import { BACKUP_KIND, Manifest } from './export';
import {
  Machine, MachineFace, OpenedSecret, SEALED_COLUMNS, faceOf, makeRewriter, resealSecret, rewritesFor, transformDomain,
} from './machine';
import { purgeSchoolFiles, purgeSchoolRows } from './purge';
import { SchemaPlan, TablePlan, orderSelfReferencing, q } from './schema-plan';
import { BucketKind, ObjectStore } from './store';

/** Same rule the tenant lookup applies; a longer slug would never resolve. */
export const SLUG_RULE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const INSERT_BATCH = 1000;

export type ImportMode = 'restore' | 'replace';
export type FinalStatus = 'LIVE' | 'SUSPENDED' | 'SETUP';

export interface ImportOptions {
  mode: ImportMode;
  /** Import under a different address; defaults to the backup's own slug. */
  slug?: string;
  finalStatus: FinalStatus;
}

/** Refused BEFORE anything was written. The message is for the person importing. */
export class ImportRefused extends Error {
  constructor(public readonly code: 'NOT_A_SCHOOL_BACKUP' | 'NEWER_SCHEMA' | 'ALREADY_HERE' | 'SLUG_TAKEN' | 'BAD_SLUG', message: string) {
    super(message);
    this.name = 'ImportRefused';
  }
}

export interface ImportState {
  schoolId: string;
  slug: string;
  options: ImportOptions;
  src: MachineFace & { slug: string };
  phase: 'school' | 'rows' | 'secrets' | 'files' | 'verify' | 'finish' | 'done';
  table: number;
  entry: number;
  file: number;
  /** Once the School row exists here, a failure must purge what was written. */
  started: boolean;
  inserted: Record<string, number>;
  /** "table|reason" → rows. Every row not imported is accounted for here. */
  dropped: Record<string, number>;
  /** "table|column" → rows whose OPTIONAL link was cleared because its target is not here. */
  cleared: Record<string, number>;
  warnings: string[];
  files: number;
}

export interface ImportReport {
  schoolId: string;
  slug: string;
  rows: number;
  files: number;
  tables: Record<string, number>;
  dropped: { table: string; reason: string; rows: number }[];
  cleared: { table: string; column: string; rows: number }[];
  warnings: string[];
}

export interface ImportDeps { db: RawDb; files: ObjectStore; machine: Machine; plan: SchemaPlan }

/**
 * Everything that can be decided without writing: is this a school backup,
 * is this machine's schema new enough, is the school or the address already
 * here. A refusal here leaves the target untouched.
 */
export async function preflightImport(deps: ImportDeps, reader: ArchiveReader<Manifest>, options: ImportOptions): Promise<ImportState> {
  const m = reader.manifest;
  if (m?.kind !== BACKUP_KIND || !reader.entry('school.json')) {
    throw new ImportRefused('NOT_A_SCHOOL_BACKUP', 'This file is a Sckools backup, but not of a school.');
  }
  const here = new Set(await appliedMigrations(deps.db));
  const missing = (m.migrations ?? []).filter((x) => !here.has(x));
  if (missing.length) {
    throw new ImportRefused('NEWER_SCHEMA', `This backup was made by a newer version of Sckools. This machine is missing ${missing.length} database change(s) — ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}. Update the code and run migrations, then import again.`);
  }
  const school = JSON.parse((await reader.read('school.json')).toString('utf8')) as { id: string; slug: string };
  const slug = (options.slug ?? school.slug).trim().toLowerCase();
  if (!SLUG_RULE.test(slug)) {
    throw new ImportRefused('BAD_SLUG', `"${slug}" cannot be a school address — use 2 to 32 lowercase letters, digits or dashes.`);
  }
  // A DIFFERENT school on the address is checked first: a replace that also
  // renames must not sail past it just because its own copy is still here.
  const [taken] = await deps.db.query<{ name: string }>(`SELECT name FROM "School" WHERE slug = $1 AND id <> $2::uuid`, slug, school.id);
  if (taken) throw new ImportRefused('SLUG_TAKEN', `The address "${slug}" already belongs to ${taken.name}. Choose another address for this school.`);
  const [existing] = await deps.db.query<{ slug: string }>(`SELECT slug FROM "School" WHERE id = $1::uuid`, school.id);
  if (existing) {
    throw new ImportRefused('ALREADY_HERE', options.mode === 'replace'
      ? `The current copy of this school (${existing.slug}) is still here. Replacing removes it first — that step did not happen.`
      : `This school is already on this machine as "${existing.slug}". Choose "Replace current data" to overwrite it.`);
  }

  return {
    schoolId: school.id, slug, options,
    src: { ...m.source.machine, slug: m.source.slug },
    phase: 'school', table: 0, entry: 0, file: 0, started: false,
    inserted: {}, dropped: {}, cleared: {}, warnings: [], files: 0,
  };
}

export interface ImportStepResult { state: ImportState; done: boolean; report?: ImportReport }

/**
 * Applies the backup one entry at a time until `deadline`, then stops at an
 * entry boundary. Each entry is written in its own transaction that first
 * clears any rows a crashed earlier attempt left behind, so re-running a step
 * is always safe. Throws on anything unexpected; the caller then calls
 * `rollbackImport`, which removes everything this import wrote.
 */
export async function runImport(
  deps: ImportDeps, reader: ArchiveReader<Manifest>, input: ImportState, opts: { deadline: number },
): Promise<ImportStepResult> {
  const st: ImportState = structuredClone(input);
  // At least one unit of work per call, whatever the clock says — otherwise a
  // step handed an already-passed deadline returns unchanged, and a driver
  // calling it in a loop spins forever.
  let progressed = false;
  const timeLeft = () => !progressed || Date.now() < opts.deadline;
  const dst = { ...faceOf(deps.machine), slug: st.slug };
  const rewrite = makeRewriter(rewritesFor(st.src, dst));
  const colCache = new Map<string, ColumnInfo[]>();
  const cols = async (table: string) => {
    if (!colCache.has(table)) colCache.set(table, await tableColumns(deps.db, table));
    return colCache.get(table)!;
  };

  if (st.phase === 'school') {
    const school = rewrite(JSON.parse((await reader.read('school.json')).toString('utf8')) as Record<string, unknown>);
    const row = { ...school, slug: st.slug, status: 'SUSPENDED', statusChangedAt: new Date().toISOString() };
    const c = (await cols('School')).map((x) => x.name).filter((n) => n in row);
    const list = c.map(q).join(', ');
    st.started = true; // set before the write: a crash mid-insert must still be cleaned up
    await deps.db.execute(
      `INSERT INTO "School" (${list}) SELECT ${list} FROM json_populate_record(NULL::"School", $1::json) ON CONFLICT (id) DO NOTHING`,
      JSON.stringify(row),
    );
    st.phase = 'rows';
    progressed = true;
  }

  while (st.phase === 'rows') {
    if (st.table >= deps.plan.insertOrder.length) {
      // Tables in the backup that this version of the code no longer has.
      const known = new Set(deps.plan.insertOrder.map((t) => t.table));
      for (const t of Object.keys(reader.manifest.tables ?? {})) {
        if (!known.has(t)) st.warnings.push(`${t}: this version of Sckools has no such table — ${reader.manifest.tables[t].rows} row(s) not imported`);
      }
      st.phase = 'secrets';
      break;
    }
    if (!timeLeft()) return { state: st, done: false };
    const t = deps.plan.insertOrder[st.table];
    const entries = reader.entries(`rows/${t.table}/`).sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length === 0) { st.table += 1; st.entry = 0; continue; }
    const target = await cols(t.table);
    if (target.length === 0) {
      st.warnings.push(`${t.table}: missing from this database — run migrations`);
      st.table += 1; st.entry = 0; continue;
    }
    if (t.selfFks.length > 0) {
      // Parents must precede children inside the table, across pages: load it whole.
      const all: Record<string, unknown>[] = [];
      for (const e of entries) all.push(...decodeRows(await reader.read(e)));
      await applyRows(deps, st, t, target, orderSelfReferencing(all, t.pk[0], t.selfFks), rewrite, dst);
      st.table += 1; st.entry = 0;
      progressed = true;
      continue;
    }
    while (st.entry < entries.length) {
      if (!timeLeft()) return { state: st, done: false };
      await applyRows(deps, st, t, target, decodeRows(await reader.read(entries[st.entry])), rewrite, dst);
      st.entry += 1;
      progressed = true;
    }
    st.table += 1; st.entry = 0;
  }

  if (st.phase === 'secrets') {
    const secrets = JSON.parse((await reader.read('secrets.json')).toString('utf8')) as OpenedSecret[];
    for (const s of secrets) {
      const { value, warnings } = resealSecret(s, st.schoolId, deps.machine);
      for (const w of warnings) st.warnings.push(`${w.table}.${w.column}: ${w.reason}`);
      const cast = SEALED_COLUMNS.find((c) => c.table === s.table && c.column === s.column)?.kind === 'fee-map' ? '::jsonb' : '';
      await deps.db.execute(
        `UPDATE ${q(s.table)} SET ${q(s.column)} = $1${cast} WHERE id::text = $2 AND "schoolId" = $3::uuid`,
        cast ? JSON.stringify(value ?? {}) : value, s.id, st.schoolId,
      );
    }
    st.phase = 'files';
  }

  if (st.phase === 'files') {
    const files = reader.entries('files/');
    while (st.file < files.length) {
      if (!timeLeft()) return { state: st, done: false };
      const e = files[st.file];
      const meta = (e.meta ?? {}) as { bucket?: BucketKind; key?: string; contentType?: string | null };
      const key = meta.key ?? e.name.replace(/^files\/(public|private)\//, '');
      const bucket: BucketKind = meta.bucket === 'private' && deps.files.hasPrivateBucket ? 'private' : 'public';
      await deps.files.put({ bucket, key }, await reader.read(e), meta.contentType ?? undefined);
      st.files += 1;
      st.file += 1;
      progressed = true;
    }
    st.phase = 'verify';
  }

  if (st.phase === 'verify') {
    const problems: string[] = [];
    for (const [table, info] of Object.entries(reader.manifest.tables ?? {})) {
      if (!deps.plan.insertOrder.some((t) => t.table === table)) continue;
      const dropped = Object.entries(st.dropped).filter(([k]) => k.startsWith(`${table}|`)).reduce((a, [, n]) => a + n, 0);
      const [{ n }] = await deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(table)} WHERE "schoolId" = $1::uuid`, st.schoolId);
      if (n !== info.rows - dropped) problems.push(`${table}: expected ${info.rows - dropped}, found ${n}`);
    }
    if (problems.length) throw new Error(`the imported school does not match its backup — ${problems.slice(0, 5).join('; ')}`);
    st.phase = 'finish';
  }

  if (st.phase === 'finish') {
    await deps.db.execute(
      `UPDATE "School" SET status = $1::"SchoolStatus", "statusChangedAt" = now() WHERE id = $2::uuid`,
      st.options.finalStatus, st.schoolId,
    );
    st.phase = 'done';
  }

  return {
    state: st,
    done: true,
    report: {
      schoolId: st.schoolId, slug: st.slug,
      rows: Object.values(st.inserted).reduce((a, b) => a + b, 0),
      files: st.files,
      tables: st.inserted,
      dropped: Object.entries(st.dropped).map(([k, rows]) => ({ table: k.split('|')[0], reason: k.split('|').slice(1).join('|'), rows })),
      cleared: Object.entries(st.cleared).map(([k, rows]) => ({ table: k.split('|')[0], column: k.split('|')[1], rows })),
      warnings: st.warnings,
    },
  };
}

/** Removes everything an import wrote. Safe to call twice, and on an import that never started. */
export async function rollbackImport(deps: ImportDeps, st: ImportState): Promise<void> {
  if (!st.started) return;
  await deps.db.execute(`UPDATE "School" SET status = 'SUSPENDED' WHERE id = $1::uuid`, st.schoolId);
  await purgeSchoolRows(deps.db, deps.plan, st.schoolId);
  await purgeSchoolFiles(deps.files, st.schoolId);
}

/* ── one batch of rows ──────────────────────────────────────────────────── */

const typeCache = new WeakMap<RawDb, Map<string, string>>();
/** The Postgres type name of one column (uuid, text, …), for typed comparisons. */
async function columnType(db: RawDb, table: string, column: string): Promise<string> {
  let m = typeCache.get(db);
  if (!m) { m = new Map(); typeCache.set(db, m); }
  const k = `${table}.${column}`;
  if (!m.has(k)) {
    const [r] = await db.query<{ t: string }>(
      `SELECT format_type(a.atttypid, a.atttypmod) AS t FROM pg_attribute a
        WHERE a.attrelid = to_regclass($1) AND a.attname = $2 AND NOT a.attisdropped`,
      `"${table.replace(/"/g, '""')}"`, column,
    );
    if (!r) throw new Error(`${table}.${column} does not exist on this machine`);
    m.set(k, r.t.replace(/\(.*\)$/, ''));
  }
  return m.get(k)!;
}

function decodeRows(entry: Buffer): Record<string, unknown>[] {
  const text = gunzipSync(entry).toString('utf8');
  return text ? text.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
}

const bump = (st: ImportState, table: string, reason: string, n = 1) => {
  const k = `${table}|${reason}`;
  st.dropped[k] = (st.dropped[k] ?? 0) + n;
};

async function applyRows(
  deps: ImportDeps, st: ImportState, t: TablePlan, target: ColumnInfo[],
  input: Record<string, unknown>[], rewrite: <T>(v: T) => T, dst: MachineFace & { slug: string },
): Promise<void> {
  if (input.length === 0) return;
  const targetNames = new Set(target.map((c) => c.name));
  const present = new Set(Object.keys(input[0]));

  // A column this machine REQUIRES that the backup does not have, with no
  // default to fall back on, cannot be invented — refuse rather than guess.
  const unfillable = target.filter((c) => !c.nullable && !c.hasDefault && !present.has(c.name));
  if (unfillable.length) {
    throw new Error(`${t.table}: this machine requires ${unfillable.map((c) => c.name).join(', ')}, which the backup does not have`);
  }
  for (const k of present) {
    if (!targetNames.has(k)) {
      const w = `${t.table}.${k}: not in this version of Sckools — values dropped`;
      if (!st.warnings.includes(w)) st.warnings.push(w);
    }
  }

  const sealed = SEALED_COLUMNS.find((c) => c.table === t.table);
  let rows = input.map((r) => {
    let row = rewrite(r);
    if (t.table === 'Domain') row = transformDomain(row, st.src, dst);
    // Sealed values are re-sealed from the backup's secrets in their own
    // phase; until then a source machine's ciphertext must not sit here.
    if (sealed) row = { ...row, [sealed.column]: sealed.kind === 'fee-map' ? {} : null };
    return row;
  });

  // Links to rows this machine does not have (another school's network event,
  // a row dropped earlier): an optional link is cleared, a required one drops
  // the row. Both are counted and reported — never silent.
  const pkSet = new Set(rows.map((r) => String(r[t.pk[0]])));
  for (const fk of [...t.fks, ...t.selfFks]) {
    if (fk.columns.length !== 1 || fk.refColumns.length !== 1) continue;
    const col = fk.columns[0];
    const isSelf = fk.refTable === t.table;
    const values = [...new Set(rows.map((r) => r[col]).filter((v) => v != null).map(String))]
      .filter((v) => !(isSelf && pkSet.has(v)));
    if (values.length === 0) continue;
    // Compared in the column's OWN type so the lookup uses its index — a
    // ::text comparison would scan every school's rows of the parent table.
    const udt = await columnType(deps.db, fk.refTable, fk.refColumns[0]);
    const found = new Set((await deps.db.query<{ v: string }>(
      `SELECT r.${q(fk.refColumns[0])}::text AS v FROM ${q(fk.refTable)} r WHERE r.${q(fk.refColumns[0])} = ANY($1::text[]::${udt}[])`,
      values,
    )).map((x) => x.v));
    const missing = new Set(values.filter((v) => !found.has(v)));
    if (missing.size === 0) continue;
    rows = rows.flatMap((r) => {
      const v = r[col];
      if (v == null || !missing.has(String(v))) return [r];
      if (fk.nullable) {
        st.cleared[`${t.table}|${col}`] = (st.cleared[`${t.table}|${col}`] ?? 0) + 1;
        return [{ ...r, [col]: null }];
      }
      bump(st, t.table, `needs a ${fk.refModel} that is not on this machine`);
      return [];
    });
  }

  const list = [...present].filter((k) => targetNames.has(k));
  const colSql = list.map(q).join(', ');
  const insertSql = `INSERT INTO ${q(t.table)} (${colSql}) SELECT ${colSql} FROM json_populate_recordset(NULL::${q(t.table)}, $1::json)`;
  // Re-running a batch after a crash must not double it: first remove any of
  // THIS batch's rows already here (matched on the primary key, single or
  // composite, in its real type), then insert — in one transaction.
  const pkMatch = t.pk.map((c) => `t.${q(c)} = x.${q(c)}`).join(' AND ');
  const clearSql = `DELETE FROM ${q(t.table)} t USING json_populate_recordset(NULL::${q(t.table)}, $2::json) x WHERE t."schoolId" = $1::uuid AND ${pkMatch}`;
  const pkOnly = (rs: Record<string, unknown>[]) => JSON.stringify(rs.map((r) => Object.fromEntries(t.pk.map((c) => [c, r[c]]))));

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const statements: { sql: string; params?: unknown[] }[] = [
      { sql: `SELECT set_config('sckools.purge_school', $1, true)`, params: [st.schoolId] },
    ];
    statements.push({ sql: clearSql, params: [st.schoolId, pkOnly(batch)] });
    statements.push({ sql: insertSql, params: [JSON.stringify(batch)] });
    try {
      await deps.db.transaction(statements);
      st.inserted[t.table] = (st.inserted[t.table] ?? 0) + batch.length;
    } catch (e) {
      if (pgCode(e) !== '23505') throw new Error(`${t.table}: ${(e as Error).message.split('\n').slice(-3).join(' ')}`);
      // Something UNIQUE across the whole platform is already taken here (a
      // custom domain, a device token). Insert row by row; skip only those.
      for (const r of batch) {
        try {
          await deps.db.transaction([statements[0], { sql: clearSql, params: [st.schoolId, pkOnly([r])] }, { sql: insertSql, params: [JSON.stringify([r])] }]);
          st.inserted[t.table] = (st.inserted[t.table] ?? 0) + 1;
        } catch (e2) {
          if (pgCode(e2) !== '23505') throw new Error(`${t.table}: ${(e2 as Error).message.split('\n').slice(-3).join(' ')}`);
          bump(st, t.table, 'already taken on this machine by another school (a unique value such as a domain)');
          st.warnings.push(`${t.table} ${String(r[t.pk[0]] ?? '')}: skipped — a unique value is already used here`);
        }
      }
    }
  }
}

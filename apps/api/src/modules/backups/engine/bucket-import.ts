import { ArchiveReader } from './archive';
import { Bucket } from './buckets';
import { appliedMigrations, ColumnInfo, RawDb, tableColumns } from './db';
import { BACKUP_KIND, Manifest } from './export';
import {
  applyRows, columnType, decodeRows, ImportFailed, ImportRefused, RowSink,
} from './import';
import { faceOf, Machine, MachineFace, makeRewriter, OpenedSecret, resealSecret, rewritesFor, SEALED_COLUMNS } from './machine';
import { purgeBucketRows } from './purge';
import { orderSelfReferencing, q } from './schema-plan';
import { RehomeOptions, rehomeRow, weeksBetween } from './rehome';
import { andFilter, KeptPointer, keptPointers, ScopedPlan } from './scoped-plan';
import { BucketKind, ObjectStore } from './store';

/**
 * PUTTING SOME BUCKETS BACK INTO A SCHOOL THAT IS ALREADY HERE.
 *
 * Three jobs, one path:
 *   - roll `day` back to last night, leaving the roster and the website alone;
 *   - replace `setup` + `day` with a sample pack, leaving the website alone;
 *   - put the `school` bucket's settings back after someone broke them.
 *
 * Two modes, and which one a scope gets is forced by the schema, not chosen:
 *
 *   replace  Empty the scope, then insert the snapshot. A true point in time:
 *            rows created since are gone. Allowed only when emptying the scope
 *            strands nothing outside it, which `scopePlan` has already checked
 *            by widening the scope until that is true.
 *   merge    Insert the snapshot over whatever is there, matching on primary
 *            key, emptying nothing. The only mode for the `school` bucket,
 *            because emptying it would delete the admin logins and cascade
 *            into their complaints and notifications.
 *
 * Files are written, never deleted — in any mode, in any scope. A file whose
 * row went away costs storage and nothing else; a file deleted by mistake is
 * gone. Only a whole-school replace or delete removes files.
 */

export type BucketImportMode = 'replace' | 'merge';

export interface BucketImportOptions {
  /** The school receiving the rows. Must already exist and be SUSPENDED. */
  schoolId: string;
  mode: BucketImportMode;
  /**
   * Set when the archive comes from a DIFFERENT school (a sample pack). Absent
   * means the archive must be of this very school.
   */
  rehome?: { shiftDates: boolean };
}

export interface BucketImportState extends RowSink {
  schoolId: string;
  buckets: Bucket[];
  mode: BucketImportMode;
  src: MachineFace & { slug: string };
  /** Null when the archive is of this school; set when it is being re-homed. */
  rehome: RehomeOptions | null;
  phase: 'pointers' | 'purge' | 'rows' | 'secrets' | 'files' | 'relink' | 'verify' | 'done';
  table: number;
  entry: number;
  file: number;
  files: number;
  /** Values of pointers on KEPT rows that aim into the scope, saved before it is emptied. */
  pointers: { table: string; pk: Record<string, unknown>; column: string; value: string; refTable: string }[];
  relinked: number;
  purged: boolean;
}

export interface BucketImportReport {
  schoolId: string;
  buckets: Bucket[];
  mode: BucketImportMode;
  rows: number;
  tables: Record<string, number>;
  files: number;
  relinked: number;
  shiftedWeeks: number;
  dropped: { table: string; reason: string; rows: number }[];
  cleared: { table: string; column: string; rows: number }[];
  warnings: string[];
}

export interface BucketImportDeps {
  db: RawDb;
  files: ObjectStore;
  machine: Machine;
  /** Narrowed by `scopePlan` to the buckets being replaced. */
  plan: ScopedPlan;
}

/** What a restore is about to do, read before anything is written. */
export interface BucketPreflight {
  buckets: Bucket[];
  /** Buckets the request had to widen to, because emptying it would strand them. */
  widenedTo: Bucket[];
  mode: BucketImportMode;
  takenAt: string;
  /** Rows in the archive, per table, and in the school right now. */
  snapshotRows: number;
  currentRows: number;
  tables: { table: string; snapshot: number; current: number }[];
  /** Pointers on kept rows that will be emptied and put back where they can be. */
  pointers: number;
  fromAnotherSchool: boolean;
  shiftWeeks: number;
  filesInArchive: number;
  warnings: string[];
}

const SAME = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

async function readSchool(db: RawDb, schoolId: string) {
  const [row] = await db.query<{ slug: string; status: string; codePrefix: string | null }>(
    `SELECT slug, status::text AS status, "codePrefix" AS "codePrefix" FROM "School" WHERE id = $1::uuid`, schoolId);
  return row;
}

/**
 * Everything decidable without writing: is this the right kind of archive, is
 * this machine new enough, is the school here, is it the same school, and what
 * exactly will change. A refusal here leaves the school untouched.
 */
export async function preflightBucketImport(
  deps: BucketImportDeps, reader: ArchiveReader<Manifest>, options: BucketImportOptions,
): Promise<BucketPreflight> {
  const m = reader.manifest;
  if (m?.kind !== BACKUP_KIND) {
    throw new ImportRefused('NOT_A_SCHOOL_BACKUP', 'This file is not a Sckools backup.');
  }
  const scope = m.scope ?? null;
  if (scope && !SAME(deps.plan.requested, scope)) {
    throw new ImportRefused('WRONG_SCOPE', `This file holds the ${scope.join(' and ')} of a school; you asked to put back the ${deps.plan.requested.join(' and ')}.`);
  }
  const here = new Set(await appliedMigrations(deps.db));
  const missing = (m.migrations ?? []).filter((x) => !here.has(x));
  if (missing.length) {
    throw new ImportRefused('NEWER_SCHEMA', `This backup was made by a newer version of Sckools. This machine is missing ${missing.length} database change(s) — ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}. Update the code and run migrations, then try again.`);
  }
  const school = await readSchool(deps.db, options.schoolId);
  if (!school) {
    throw new ImportRefused('NOT_HERE', 'That school is not on this machine. A single bucket can only be put back into a school that already exists.');
  }
  const fromAnotherSchool = m.source.schoolId !== options.schoolId;
  if (fromAnotherSchool && !options.rehome) {
    throw new ImportRefused('ANOTHER_SCHOOL', `This archive holds ${m.source.name}'s data, not this school's. Load it as a sample pack if that is what you meant.`);
  }

  const tables: { table: string; snapshot: number; current: number }[] = [];
  let currentRows = 0;
  for (const t of deps.plan.insertOrder) {
    const snapshot = m.tables?.[t.table]?.rows ?? 0;
    const [{ n }] = await deps.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${q(t.table)} t WHERE t."schoolId" = $1::uuid${andFilter(deps.plan.where(t.model))}`,
      options.schoolId,
    );
    currentRows += n;
    if (snapshot || n) tables.push({ table: t.table, snapshot, current: n });
  }

  const warnings: string[] = [...(m.warnings ?? [])];
  const inArchiveButNotInScope = Object.keys(m.tables ?? {}).filter((t) => !deps.plan.insertOrder.some((p) => p.table === t));
  if (inArchiveButNotInScope.length) {
    warnings.push(`${inArchiveButNotInScope.length} table(s) in this file are outside the buckets being put back and will be ignored`);
  }

  return {
    buckets: deps.plan.buckets,
    widenedTo: deps.plan.buckets.filter((b) => !deps.plan.requested.includes(b)),
    mode: options.mode,
    takenAt: m.takenAt,
    snapshotRows: tables.reduce((a, t) => a + t.snapshot, 0),
    currentRows,
    tables,
    pointers: keptPointers(deps.plan, deps.plan.buckets).length,
    fromAnotherSchool,
    shiftWeeks: options.rehome?.shiftDates ? weeksBetween(new Date(m.takenAt), new Date()) : 0,
    filesInArchive: reader.entries('files/').length,
    warnings,
  };
}

export function beginBucketImport(
  deps: BucketImportDeps, reader: ArchiveReader<Manifest>, options: BucketImportOptions, pre: BucketPreflight,
): BucketImportState {
  const m = reader.manifest;
  return {
    schoolId: options.schoolId,
    buckets: deps.plan.buckets,
    mode: options.mode,
    src: { ...m.source.machine, slug: m.source.slug },
    rehome: pre.fromAnotherSchool || pre.shiftWeeks !== 0
      ? {
        targetSchoolId: options.schoolId,
        shiftWeeks: pre.shiftWeeks,
        codePrefix: { from: m.source.codePrefix ?? null, to: null },
      }
      : null,
    phase: 'pointers',
    table: 0, entry: 0, file: 0, files: 0,
    pointers: [], relinked: 0, purged: false,
    inserted: {}, dropped: {}, cleared: {}, warnings: [],
  };
}

export interface BucketImportStepResult {
  state: BucketImportState;
  done: boolean;
  report?: BucketImportReport;
}

export async function runBucketImport(
  deps: BucketImportDeps, reader: ArchiveReader<Manifest>, input: BucketImportState, opts: { deadline: number },
): Promise<BucketImportStepResult> {
  const st: BucketImportState = structuredClone(input);
  try {
    return await steps(deps, reader, st, opts);
  } catch (e) {
    throw e instanceof ImportFailed ? e : new ImportFailed<BucketImportState>(e, st);
  }
}

async function steps(
  deps: BucketImportDeps, reader: ArchiveReader<Manifest>, st: BucketImportState, opts: { deadline: number },
): Promise<BucketImportStepResult> {
  let progressed = false;
  const timeLeft = () => !progressed || Date.now() < opts.deadline;
  const dst = { ...faceOf(deps.machine), slug: '' };
  const colCache = new Map<string, ColumnInfo[]>();
  const cols = async (table: string) => {
    if (!colCache.has(table)) colCache.set(table, await tableColumns(deps.db, table));
    return colCache.get(table)!;
  };

  if (st.phase === 'pointers') {
    const school = await readSchool(deps.db, st.schoolId);
    if (!school) throw new Error(`school ${st.schoolId} disappeared`);
    dst.slug = school.slug;
    if (st.rehome) st.rehome = { ...st.rehome, codePrefix: { ...st.rehome.codePrefix, to: school.codePrefix } };
    // Saved BEFORE the scope is emptied: Postgres will set these to NULL.
    st.pointers = st.mode === 'replace' ? await readPointers(deps, st) : [];
    st.phase = 'purge';
    progressed = true;
  }
  if (!dst.slug) {
    const school = await readSchool(deps.db, st.schoolId);
    dst.slug = school?.slug ?? '';
  }
  const rewrite = makeRewriter(rewritesFor(st.src, dst));

  if (st.phase === 'purge') {
    if (st.mode === 'replace' && !st.purged) {
      await purgeBucketRows(deps.db, deps.plan, st.schoolId);
      st.purged = true;
    }
    st.phase = 'rows';
    progressed = true;
  }

  while (st.phase === 'rows') {
    if (st.table >= deps.plan.insertOrder.length) {
      const known = new Set(deps.plan.insertOrder.map((t) => t.table));
      for (const t of Object.keys(reader.manifest.tables ?? {})) {
        if (!known.has(t) && reader.manifest.tables[t].rows > 0) {
          st.warnings.push(`${t}: outside the buckets being put back — ${reader.manifest.tables[t].rows} row(s) ignored`);
        }
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
    const prepare = (rows: Record<string, unknown>[]) =>
      (st.rehome ? rows.map((r) => rehomeRow(r, t, st.rehome!)) : rows);
    if (t.selfFks.length > 0) {
      const all: Record<string, unknown>[] = [];
      for (const e of entries) all.push(...decodeRows(await reader.read(e)));
      await applyRows(deps, st, t, target, orderSelfReferencing(prepare(all), t.pk[0], t.selfFks), rewrite, dst);
      st.table += 1; st.entry = 0;
      progressed = true;
      continue;
    }
    while (st.entry < entries.length) {
      if (!timeLeft()) return { state: st, done: false };
      await applyRows(deps, st, t, target, prepare(decodeRows(await reader.read(entries[st.entry]))), rewrite, dst);
      st.entry += 1;
      progressed = true;
    }
    st.table += 1; st.entry = 0;
  }

  if (st.phase === 'secrets') {
    // Only the sealed columns this scope actually carries, and never for a
    // pack: a secret sealed for another school is not this school's to hold.
    const entry = reader.entry('secrets.json');
    if (entry && !st.rehome) {
      const secrets = JSON.parse((await reader.read(entry)).toString('utf8')) as OpenedSecret[];
      for (const s of secrets) {
        if (!deps.plan.insertOrder.some((t) => t.table === s.table)) continue;
        const { value, warnings } = resealSecret(s, st.schoolId, deps.machine);
        for (const w of warnings) st.warnings.push(`${w.table}.${w.column}: ${w.reason}`);
        const cast = SEALED_COLUMNS.find((c) => c.table === s.table && c.column === s.column)?.kind === 'fee-map' ? '::jsonb' : '';
        await deps.db.execute(
          `UPDATE ${q(s.table)} SET ${q(s.column)} = $1${cast} WHERE id::text = $2 AND "schoolId" = $3::uuid`,
          cast ? JSON.stringify(value ?? {}) : value, s.id, st.schoolId,
        );
      }
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
    st.phase = 'relink';
  }

  if (st.phase === 'relink') {
    st.relinked = await writeBackPointers(deps, st);
    st.phase = 'verify';
    progressed = true;
  }

  if (st.phase === 'verify') {
    const problems: string[] = [];
    for (const t of deps.plan.insertOrder) {
      const info = reader.manifest.tables?.[t.table];
      if (!info) continue;
      const dropped = Object.entries(st.dropped).filter(([k]) => k.startsWith(`${t.table}|`)).reduce((a, [, n]) => a + n, 0);
      const [{ n }] = await deps.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${q(t.table)} t WHERE t."schoolId" = $1::uuid${andFilter(deps.plan.where(t.model))}`,
        st.schoolId,
      );
      const want = info.rows - dropped;
      // A replace put the scope back exactly; a merge only promises that
      // everything in the file is now here, since rows added since stay.
      const ok = st.mode === 'replace' ? n === want : n >= want;
      if (!ok) problems.push(`${t.table}: expected ${st.mode === 'replace' ? '' : 'at least '}${want}, found ${n}`);
    }
    if (problems.length) {
      throw new Error(`the school does not match the snapshot that was put back — ${problems.slice(0, 5).join('; ')}`);
    }
    st.phase = 'done';
  }

  return {
    state: st,
    done: true,
    report: {
      schoolId: st.schoolId,
      buckets: st.buckets,
      mode: st.mode,
      rows: Object.values(st.inserted).reduce((a, b) => a + b, 0),
      tables: st.inserted,
      files: st.files,
      relinked: st.relinked,
      shiftedWeeks: st.rehome?.shiftWeeks ?? 0,
      dropped: Object.entries(st.dropped).map(([k, rows]) => ({ table: k.split('|')[0], reason: k.split('|').slice(1).join('|'), rows })),
      cleared: Object.entries(st.cleared).map(([k, rows]) => ({ table: k.split('|')[0], column: k.split('|')[1], rows })),
      warnings: st.warnings,
    },
  };
}

/* ── pointers on rows we are keeping ───────────────────────────────────────── */

/**
 * Reads the pointers that emptying this scope will set to NULL — a featured
 * staff card's teacher, a Hall of Fame entry's student. The list of columns is
 * derived from the schema (`keptPointers`), so a new one joins this
 * automatically.
 */
async function readPointers(deps: BucketImportDeps, st: BucketImportState): Promise<BucketImportState['pointers']> {
  const out: BucketImportState['pointers'] = [];
  for (const p of keptPointers(deps.plan, deps.plan.buckets)) {
    const keyCols = p.pk.map(q).join(', ');
    const rows = await deps.db.query<Record<string, unknown>>(
      `SELECT ${keyCols}, ${q(p.column)}::text AS "__v" FROM ${q(p.table)} WHERE "schoolId" = $1::uuid AND ${q(p.column)} IS NOT NULL`,
      st.schoolId,
    );
    for (const r of rows) {
      out.push({
        table: p.table,
        pk: Object.fromEntries(p.pk.map((c) => [c, r[c]])),
        column: p.column,
        value: String(r.__v),
        refTable: p.refTable,
      });
    }
  }
  return out;
}

/**
 * Writes each saved pointer back, but only where its target exists again. A
 * school's own snapshot brings the same rows back under the same ids, so its
 * cards re-link; a sample pack's teachers are different rows, so those cards
 * correctly stay empty rather than pointing at a stranger.
 */
async function writeBackPointers(deps: BucketImportDeps, st: BucketImportState): Promise<number> {
  let n = 0;
  for (const p of st.pointers) {
    // Cast through the column's OWN type rather than assuming uuid, so this
    // keeps working for a pointer added on a table keyed by something else.
    const type = await columnType(deps.db, p.table, p.column);
    const where = Object.keys(p.pk).map((c, i) => `${q(c)}::text = $${i + 3}`).join(' AND ');
    const r = await deps.db.execute(
      `UPDATE ${q(p.table)} SET ${q(p.column)} = $2::text::${type}
         WHERE "schoolId" = $1::uuid AND ${where}
           AND EXISTS (SELECT 1 FROM ${q(p.refTable)} x WHERE x.id::text = $2 AND x."schoolId" = $1::uuid)`,
      st.schoolId, p.value, ...Object.values(p.pk).map(String),
    );
    n += typeof r === 'number' ? r : 0;
  }
  return n;
}

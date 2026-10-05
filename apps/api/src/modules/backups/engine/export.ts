import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ArchiveWriter, Sink, WriterState } from './archive';
import { Bucket } from './buckets';
import { appliedMigrations, RawDb } from './db';
import { Machine, MachineFace, OpenedSecret, SEALED_COLUMNS, faceOf, openRowSecrets } from './machine';
import { SchemaPlan, q } from './schema-plan';
import { andFilter, filterOf, ScopedPlan, scopeOf } from './scoped-plan';
import { BucketKind, ObjectStore, schoolPrefixes } from './store';

export const BACKUP_KIND = 'sckools.school';
export const PAGE_ROWS = 2000;
/** Tables without a single `id` are read whole; they are counters and joins, never large. */
const WHOLE_TABLE_LIMIT = 100_000;

export interface Manifest {
  kind: typeof BACKUP_KIND;
  format: 1;
  takenAt: string;
  appVersion: string | null;
  /**
   * The buckets this archive holds, or null for a whole school. A scoped
   * archive is applied to a school that is already here; a null one can also
   * create it.
   */
  scope: Bucket[] | null;
  /**
   * Fingerprint of the archive's CONTENT — the uncompressed rows and file
   * bytes, in order. Two archives of the same data have the same hash whatever
   * the compression did, which is what lets a scheduled snapshot of an
   * unchanged bucket be thrown away instead of kept as a new version.
   */
  contentHash: string;
  source: { schoolId: string; slug: string; name: string; status: string; codePrefix: string | null; machine: MachineFace };
  migrations: string[];
  tables: Record<string, { model: string; rows: number }>;
  rowCount: number;
  fileCount: number;
  fileBytes: number;
  excluded: string[];
  warnings: string[];
}

export interface ExportState {
  schoolId: string;
  phase: 'rows' | 'files' | 'finish';
  table: number;
  after: string | null;
  seq: number;
  files: { bucket: BucketKind; key: string }[] | null;
  file: number;
  counts: Record<string, number>;
  warnings: string[];
  fileCount: number;
  fileBytes: number;
  source: { school: Record<string, unknown>; migrations: string[]; takenAt: string; machine: MachineFace };
  writer: WriterState | null;
  /**
   * Running fingerprint of every entry's UNCOMPRESSED content, chained in the
   * order entries are written. A chain rather than a map so the saved job state
   * stays small on a school with thousands of pages.
   */
  hashChain: string;
}

export interface ExportDeps {
  db: RawDb;
  files: ObjectStore;
  machine: Machine;
  /** A whole-school plan, or one narrowed to some buckets by `scopePlan`. */
  plan: SchemaPlan | ScopedPlan;
  appVersion?: string | null;
  pageRows?: number;
}

/** Reads the school and the schema version; nothing is written yet. */
export async function beginExport(deps: ExportDeps, schoolId: string): Promise<ExportState> {
  const [row] = await deps.db.query<{ j: string }>(`SELECT row_to_json(s)::text AS j FROM "School" s WHERE s.id = $1::uuid`, schoolId);
  if (!row) throw new Error(`School ${schoolId} does not exist`);
  return {
    schoolId, phase: 'rows', table: 0, after: null, seq: 0, files: null, file: 0,
    counts: {}, warnings: [], fileCount: 0, fileBytes: 0,
    source: { school: JSON.parse(row.j), migrations: await appliedMigrations(deps.db), takenAt: new Date().toISOString(), machine: faceOf(deps.machine) },
    writer: null,
    hashChain: '',
  };
}

/** Folds one entry's uncompressed content into the running fingerprint. */
const chain = (st: ExportState, name: string, content: Buffer): void => {
  st.hashChain = createHash('sha256')
    .update(st.hashChain)
    .update(name)
    .update(createHash('sha256').update(content).digest())
    .digest('hex');
};

export interface ExportStepResult { state: ExportState; done: boolean; bytes?: number; manifest?: Manifest }

/**
 * Does as much as fits before `deadline` (ms since epoch), then stops at an
 * entry boundary. Call again with the returned state — in this process or
 * another — until `done`. The sink must be the same object (or a resumed one).
 */
export async function runExport(
  deps: ExportDeps, input: ExportState, sink: Sink, password: string,
  opts: { deadline: number; kdf?: { N: number; r: number; p: number } },
): Promise<ExportStepResult> {
  const st: ExportState = structuredClone(input);
  const pageRows = deps.pageRows ?? PAGE_ROWS;
  const writer = st.writer
    ? ArchiveWriter.resume(sink, password, st.writer)
    : await ArchiveWriter.create(sink, password, opts.kdf);
  // Always written, in every scope: it names the school this archive came
  // from, which is what a scoped restore checks itself against and what a
  // sample pack's re-homing reads the source code prefix from. Only a
  // whole-school import ever INSERTS it.
  if (!writer.has('school.json')) {
    const body = Buffer.from(JSON.stringify(st.source.school));
    await writer.add('school.json', body);
    chain(st, 'school.json', body);
  }
  // At least one unit of work per call, whatever the clock says — otherwise a
  // step handed an already-passed deadline returns unchanged, and a driver
  // calling it in a loop spins forever.
  let progressed = false;
  const timeLeft = () => !progressed || Date.now() < opts.deadline;

  // ── rows ────────────────────────────────────────────────────────────────
  while (st.phase === 'rows') {
    if (st.table >= deps.plan.insertOrder.length) { st.phase = 'files'; break; }
    if (!timeLeft()) return pause(st, writer);
    const t = deps.plan.insertOrder[st.table];
    const single = t.pk.length === 1;
    const order = t.pk.map((c) => `t.${q(c)}`).join(', ');
    // A split table contributes only its own half to this scope.
    const mine = andFilter(filterOf(deps.plan, t.model));
    const rows = single
      ? await deps.db.query<{ j: string; k: string }>(
          `SELECT row_to_json(t)::text AS j, t.${q(t.pk[0])}::text AS k FROM ${q(t.table)} t
            WHERE t."schoolId" = $1::uuid${mine} AND ($2::text IS NULL OR t.${q(t.pk[0])}::text COLLATE "C" > $2::text COLLATE "C")
            ORDER BY t.${q(t.pk[0])}::text COLLATE "C" LIMIT ${pageRows}`,
          st.schoolId, st.after,
        )
      : await deps.db.query<{ j: string; k: string }>(
          `SELECT row_to_json(t)::text AS j, '' AS k FROM ${q(t.table)} t WHERE t."schoolId" = $1::uuid${mine} ORDER BY ${order} LIMIT ${WHOLE_TABLE_LIMIT + 1}`,
          st.schoolId,
        );
    if (!single && rows.length > WHOLE_TABLE_LIMIT) {
      throw new Error(`${t.table} holds more than ${WHOLE_TABLE_LIMIT} rows for one school and has no single key to page by`);
    }
    if (rows.length > 0) {
      const ndjson = Buffer.from(rows.map((r) => r.j).join('\n'), 'utf8');
      const name = `rows/${t.table}/${String(st.seq).padStart(6, '0')}`;
      await writer.add(name, gzipSync(ndjson), { rows: rows.length });
      chain(st, name, ndjson);
      st.counts[t.table] = (st.counts[t.table] ?? 0) + rows.length;
      st.seq += 1;
    }
    progressed = true;
    if (!single || rows.length < pageRows) {
      st.table += 1; st.after = null; st.seq = 0;
    } else {
      st.after = rows[rows.length - 1].k;
    }
  }

  // ── files ───────────────────────────────────────────────────────────────
  if (st.phase === 'files') {
    if (st.files === null) st.files = await listSchoolFiles(deps, st.schoolId);
    while (st.file < st.files.length) {
      if (!timeLeft()) return pause(st, writer);
      const f = st.files[st.file];
      const got = await deps.files.get(f);
      if (!got) {
        st.warnings.push(`file ${f.key} is listed by the school but missing from storage — not in this backup`);
      } else {
        const name = `files/${f.bucket}/${f.key}`;
        await writer.add(name, got.body, { bucket: f.bucket, key: f.key, contentType: got.contentType ?? null });
        chain(st, name, got.body);
        st.fileCount += 1;
        st.fileBytes += got.body.length;
      }
      st.file += 1;
      progressed = true;
    }
    st.phase = 'finish';
  }

  // ── finish ──────────────────────────────────────────────────────────────
  // Sealed secrets are opened HERE, at the last moment, and go straight into
  // the locked file. They are never part of the saved job state, which lives
  // in the database between steps — plaintext there would undo the sealing.
  const scope = scopeOf(deps.plan);
  const holds = (model: string) => deps.plan.byModel.has(model);
  const secrets: OpenedSecret[] = [];
  for (const sealed of SEALED_COLUMNS) {
    // A scope that does not carry the table has nothing to unseal — and must
    // not read a machine key it has no use for.
    if (!holds(sealed.model)) continue;
    const rows = await deps.db.query<{ j: string }>(`SELECT row_to_json(t)::text AS j FROM ${q(sealed.table)} t WHERE t."schoolId" = $1::uuid`, st.schoolId);
    for (const r of rows) {
      const { secret, warnings } = openRowSecrets(sealed, JSON.parse(r.j), st.schoolId, deps.machine);
      if (secret) secrets.push(secret);
      for (const w of warnings) st.warnings.push(`${w.table}.${w.column} (${w.id}): ${w.reason}`);
    }
  }
  // Invitations this school sent to OTHER schools for its network events are
  // those schools' rows, not this one's; say so rather than lose them quietly.
  if (holds('EventAudienceSchool')) {
    const [{ n: invites }] = await deps.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "EventAudienceSchool" a JOIN "Event" e ON e.id = a."eventId" WHERE e."schoolId" = $1::uuid AND a."schoolId" <> $1::uuid`, st.schoolId);
    if (invites > 0) st.warnings.push(`${invites} invitation(s) to other schools for this school's network events are not in this backup — re-invite them after a restore`);
  }
  const secretsBody = Buffer.from(JSON.stringify(secrets));
  await writer.add('secrets.json', secretsBody);
  chain(st, 'secrets.json', secretsBody);
  const school = st.source.school as { id: string; slug: string; name: string; status: string; codePrefix?: string | null };
  const manifest: Manifest = {
    kind: BACKUP_KIND, format: 1, takenAt: st.source.takenAt, appVersion: deps.appVersion ?? null,
    scope,
    contentHash: st.hashChain,
    source: {
      schoolId: school.id, slug: school.slug, name: school.name, status: school.status,
      codePrefix: school.codePrefix ?? null, machine: st.source.machine,
    },
    migrations: st.source.migrations,
    tables: Object.fromEntries(deps.plan.insertOrder.filter((t) => st.counts[t.table]).map((t) => [t.table, { model: t.model, rows: st.counts[t.table] }])),
    rowCount: Object.values(st.counts).reduce((a, b) => a + b, 0),
    fileCount: st.fileCount, fileBytes: st.fileBytes,
    excluded: deps.plan.excluded, warnings: st.warnings,
  };
  const { bytes } = await writer.finish(manifest as unknown as Record<string, unknown>);
  st.writer = null;
  return { state: st, done: true, bytes, manifest };
}

async function pause(st: ExportState, writer: ArchiveWriter): Promise<ExportStepResult> {
  await writer.checkpoint();
  st.writer = writer.state();
  return { state: st, done: false };
}

/**
 * The files this archive carries.
 *
 * A WHOLE-school backup takes every object in the school's folders, plus any
 * MediaAsset whose key sits outside them (written before the folder
 * convention) — it has to be able to rebuild storage from nothing.
 *
 * A SCOPED archive takes only the files its own rows name, which is exactly
 * its `MediaAsset` rows: the website's pictures for `website`, the roster's
 * profile photos for `setup`. `day` names no files at all, which is what keeps
 * a daily snapshot flat as fee PDFs and payment screenshots pile up — and a
 * scoped restore never deletes a file, so nothing is lost by leaving them out.
 */
async function listSchoolFiles(deps: ExportDeps, schoolId: string): Promise<{ bucket: BucketKind; key: string }[]> {
  const seen = new Set<string>();
  const out: { bucket: BucketKind; key: string }[] = [];
  const add = (bucket: BucketKind, key: string) => {
    const id = `${bucket}:${key}`;
    if (!seen.has(id)) { seen.add(id); out.push({ bucket, key }); }
  };
  const scope = scopeOf(deps.plan);
  const mediaFilter = filterOf(deps.plan, 'MediaAsset');
  if (scope === null) {
    for (const prefix of schoolPrefixes(schoolId)) {
      for (const o of await deps.files.list(prefix)) add(o.bucket, o.key);
    }
  }
  if (scope === null || mediaFilter !== null) {
    const media = await deps.db.query<{ k: string }>(
      `SELECT "storageKey" AS k FROM "MediaAsset" t WHERE t."schoolId" = $1::uuid${andFilter(mediaFilter)}`, schoolId);
    for (const m of media) {
      if (!m.k) continue;
      if (scope === null && schoolPrefixes(schoolId).some((p) => m.k.startsWith(p))) continue; // already listed
      add('public', m.k);
    }
  }
  return out.sort((a, b) => (a.bucket + a.key).localeCompare(b.bucket + b.key));
}

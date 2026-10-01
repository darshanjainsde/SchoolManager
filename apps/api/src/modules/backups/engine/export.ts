import { gzipSync } from 'node:zlib';
import { ArchiveWriter, Sink, WriterState } from './archive';
import { appliedMigrations, RawDb } from './db';
import { Machine, MachineFace, OpenedSecret, SEALED_COLUMNS, faceOf, openRowSecrets } from './machine';
import { SchemaPlan, q } from './schema-plan';
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
  source: { schoolId: string; slug: string; name: string; status: string; machine: MachineFace };
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
  secrets: OpenedSecret[];
  warnings: string[];
  fileCount: number;
  fileBytes: number;
  source: { school: Record<string, unknown>; migrations: string[]; takenAt: string; machine: MachineFace };
  writer: WriterState | null;
}

export interface ExportDeps {
  db: RawDb;
  files: ObjectStore;
  machine: Machine;
  plan: SchemaPlan;
  appVersion?: string | null;
  pageRows?: number;
}

/** Reads the school and the schema version; nothing is written yet. */
export async function beginExport(deps: ExportDeps, schoolId: string): Promise<ExportState> {
  const [row] = await deps.db.query<{ j: string }>(`SELECT row_to_json(s)::text AS j FROM "School" s WHERE s.id = $1::uuid`, schoolId);
  if (!row) throw new Error(`School ${schoolId} does not exist`);
  return {
    schoolId, phase: 'rows', table: 0, after: null, seq: 0, files: null, file: 0,
    counts: {}, secrets: [], warnings: [], fileCount: 0, fileBytes: 0,
    source: { school: JSON.parse(row.j), migrations: await appliedMigrations(deps.db), takenAt: new Date().toISOString(), machine: faceOf(deps.machine) },
    writer: null,
  };
}

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
  if (!writer.has('school.json')) await writer.add('school.json', Buffer.from(JSON.stringify(st.source.school)));
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
    const rows = single
      ? await deps.db.query<{ j: string; k: string }>(
          `SELECT row_to_json(t)::text AS j, t.${q(t.pk[0])}::text AS k FROM ${q(t.table)} t
            WHERE t."schoolId" = $1::uuid AND ($2::text IS NULL OR t.${q(t.pk[0])}::text COLLATE "C" > $2::text COLLATE "C")
            ORDER BY t.${q(t.pk[0])}::text COLLATE "C" LIMIT ${pageRows}`,
          st.schoolId, st.after,
        )
      : await deps.db.query<{ j: string; k: string }>(
          `SELECT row_to_json(t)::text AS j, '' AS k FROM ${q(t.table)} t WHERE t."schoolId" = $1::uuid ORDER BY ${order} LIMIT ${WHOLE_TABLE_LIMIT + 1}`,
          st.schoolId,
        );
    if (!single && rows.length > WHOLE_TABLE_LIMIT) {
      throw new Error(`${t.table} holds more than ${WHOLE_TABLE_LIMIT} rows for one school and has no single key to page by`);
    }
    if (rows.length > 0) {
      const sealed = SEALED_COLUMNS.find((c) => c.table === t.table);
      if (sealed) {
        for (const r of rows) {
          const { secret, warnings } = openRowSecrets(sealed, JSON.parse(r.j), st.schoolId, deps.machine);
          if (secret) st.secrets.push(secret);
          for (const w of warnings) st.warnings.push(`${w.table}.${w.column} (${w.id}): ${w.reason}`);
        }
      }
      const ndjson = Buffer.from(rows.map((r) => r.j).join('\n'), 'utf8');
      await writer.add(`rows/${t.table}/${String(st.seq).padStart(6, '0')}`, gzipSync(ndjson), { rows: rows.length });
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
        await writer.add(`files/${f.bucket}/${f.key}`, got.body, { bucket: f.bucket, key: f.key, contentType: got.contentType ?? null });
        st.fileCount += 1;
        st.fileBytes += got.body.length;
      }
      st.file += 1;
      progressed = true;
    }
    st.phase = 'finish';
  }

  // ── finish ──────────────────────────────────────────────────────────────
  await writer.add('secrets.json', Buffer.from(JSON.stringify(st.secrets)));
  const school = st.source.school as { id: string; slug: string; name: string; status: string };
  const manifest: Manifest = {
    kind: BACKUP_KIND, format: 1, takenAt: st.source.takenAt, appVersion: deps.appVersion ?? null,
    source: { schoolId: school.id, slug: school.slug, name: school.name, status: school.status, machine: st.source.machine },
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
 * Every object in the school's folders, plus any MediaAsset whose key sits
 * outside them (written before the folder convention). De-duplicated.
 */
async function listSchoolFiles(deps: ExportDeps, schoolId: string): Promise<{ bucket: BucketKind; key: string }[]> {
  const seen = new Set<string>();
  const out: { bucket: BucketKind; key: string }[] = [];
  const add = (bucket: BucketKind, key: string) => {
    const id = `${bucket}:${key}`;
    if (!seen.has(id)) { seen.add(id); out.push({ bucket, key }); }
  };
  for (const prefix of schoolPrefixes(schoolId)) {
    for (const o of await deps.files.list(prefix)) add(o.bucket, o.key);
  }
  const media = await deps.db.query<{ k: string }>(`SELECT "storageKey" AS k FROM "MediaAsset" WHERE "schoolId" = $1::uuid`, schoolId);
  for (const m of media) {
    if (m.k && !schoolPrefixes(schoolId).some((p) => m.k.startsWith(p))) add('public', m.k);
  }
  return out.sort((a, b) => (a.bucket + a.key).localeCompare(b.bucket + b.key));
}

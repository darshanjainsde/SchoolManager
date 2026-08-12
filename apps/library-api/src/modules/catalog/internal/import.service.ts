import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { withOrg, type LibraryTx } from '@library/db';

export interface RowError {
  /** 1-indexed position among DATA rows — i.e. the row directly below the header is row 1. */
  row: number;
  field: string;
  message: string;
}

/**
 * `'completed'` means every row that could be applied was applied cleanly —
 * it does NOT mean every row was a create/update; a file that is 100%
 * validation errors is still `'completed'` in the sense that nothing
 * unexpected happened, but `errors.length > 0` already tells the caller
 * that. `'completed_with_errors'` is the honest label for the case the
 * design explicitly calls out: a chunk failed partway through the file.
 * There is no `'failed'` status — a partially-applied import is never
 * reported as either pure success or total failure (see the module doc
 * comment on `ImportService.importTitles`).
 */
export type ImportStatus = 'completed' | 'completed_with_errors';

export interface ImportResult {
  status: ImportStatus;
  created: number;
  /**
   * Subset of `created`: rows that had no ISBN at all. These are never
   * matched against an existing Title (see `mapImportRow`'s no-ISBN
   * comment), so re-running the same file creates them AGAIN rather than
   * updating — this count exists so a caller/librarian can tell, from the
   * response alone, that a re-run is not idempotent for these rows without
   * having to infer it from the file contents.
   */
  createdNoIsbn: number;
  updated: number;
  skipped: number;
  errors: RowError[];
}

export interface ImportOptions {
  dryRun?: boolean;
}

export interface ParsedTitleRow {
  isbn13?: string;
  isbn10?: string;
  title: string;
  subtitle?: string;
  author?: string;
  publisher?: string;
  publishedYear?: number;
  edition?: string;
  language?: string;
  callNumber?: string;
  category?: string;
}

/**
 * Hard cap so a request fits comfortably inside the 60s serverless function
 * budget. Proven empirically, not assumed: see the phase1a report's
 * "at-scale" transcript for the wall-clock time of a real MAX_IMPORT_ROWS
 * run against local Postgres (pre-pass + CHUNK_SIZE-row chunked
 * transactions, exactly the path a production request takes) — if that
 * number is ever close to the budget, raise CHUNK_SIZE's headroom or lower
 * this cap, don't just widen a timeout.
 */
export const MAX_IMPORT_ROWS = 2000;

/**
 * Rows per chunk transaction. Each chunk is applied and committed
 * independently (see `importTitles`), so this number is also the blast
 * radius of one bad row: a failure inside a chunk rolls back every row in
 * THAT chunk (not the whole file), so a bigger chunk means more collateral
 * damage per failure and a smaller chunk means more transaction/round-trip
 * overhead and more distinct "chunk N failed" error entries for a file with
 * scattered bad rows. 200 is chosen as a middle point: at MAX_IMPORT_ROWS
 * (2000) that's at most 10 chunks — few enough that per-chunk overhead
 * (opening a transaction, `SET LOCAL`, commit) stays a small fraction of
 * total wall time — while bounding worst-case collateral loss to 200 rows
 * (10% of the cap) instead of the whole file. See the phase1a report for
 * the measured wall-clock time this produces at 2,000 rows; if that number
 * changes materially, this constant is the first thing to revisit.
 */
export const CHUNK_SIZE = 200;

/**
 * `withOrg`'s $transaction options for the up-front resolution pass
 * (`resolvePrepass`). Prisma 5 defaults to a 5000ms `timeout` / 2000ms
 * `maxWait`. The pre-pass does a small, bounded number of queries — not
 * proportional to row count, only to the number of DISTINCT category/author
 * names in the whole file — but a pathological file (e.g. 2,000 rows each
 * with a unique category name) could still push it past the default, so an
 * explicit, generous budget is set rather than relying on the default.
 */
const PREPASS_TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

/**
 * `withOrg`'s $transaction options for a single chunk. A chunk is
 * CHUNK_SIZE rows, each exactly one write — comfortably inside Prisma's 5000ms
 * default in the common case, but padded to leave headroom under a slow or
 * contended database, which is a database problem, not an algorithmic one,
 * and should surface as a clear timeout rather than a mystery P2028.
 */
const CHUNK_TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 };

const ISBN_13_RE = /^\d{13}$/;
const ISBN_10_RE = /^\d{9}[\dX]$/;

/**
 * Thrown out of a chunk's `withOrg` callback to abort+rollback that ONE
 * chunk's transaction when a row hits a database error. There is no
 * in-transaction recovery: a failed statement aborts the whole Postgres
 * transaction (25P02), so nothing after it can run — see `applyChunk`.
 * Carries the offending row's `RowError` so
 * `importTitles` can report exactly which row caused the chunk to roll
 * back, rather than a generic "chunk 4 failed" with no row number a
 * librarian could act on.
 */
class ChunkRowError extends Error {
  constructor(public readonly rowError: RowError) {
    super(rowError.message);
    this.name = 'ChunkRowError';
  }
}

/**
 * Thrown out of a chunk's `withOrg` callback purely to make Prisma roll
 * that chunk back for a dry run — mirrors the whole-file version this
 * replaced, just scoped to one chunk instead of the whole transaction.
 * Carries the chunk's would-be result so `importTitles` can still count it
 * toward the reported totals despite the rollback.
 */
class DryRunChunkRollback extends Error {
  constructor(public readonly result: ChunkResult) {
    super('import dry-run chunk rollback');
    this.name = 'DryRunChunkRollback';
  }
}

/**
 * Pure row validation/mapping — no `tx`, no I/O, so it is unit-testable
 * without a database. Every failure returns a `RowError` instead of
 * throwing: the caller is what turns "this row has a problem" into "skip
 * this row and keep going", and it can only do that if failures come back
 * as data, not as control flow that would abort the whole file.
 *
 * ISBN is OPTIONAL. A school library holds plenty of items with no ISBN —
 * older stock, local-language titles, donations, pamphlets — so rejecting
 * a row for lacking one would make bulk import useless for exactly the
 * collections that most need it. A present-but-malformed ISBN is still a
 * validation error (it's very likely a typo, not a deliberate omission);
 * only a genuinely BLANK isbn cell is treated as "no ISBN, not an error".
 * A no-ISBN row is never matched against an existing Title — inferring
 * identity from title+author+year would silently merge two genuinely
 * different books sharing those fields, which is worse than the duplicate
 * row a librarian can review and merge later with the actual book in hand.
 * See `ImportResult.createdNoIsbn` for how that trade-off is surfaced back
 * to the caller instead of being a silent surprise on re-run.
 */
export function mapImportRow(
  record: Record<string, string>,
  row: number,
): { data: ParsedTitleRow } | { error: RowError } {
  const isbnRaw = (record.isbn ?? '').replace(/[\s-]/g, '').toUpperCase();
  const isThirteen = isbnRaw ? ISBN_13_RE.test(isbnRaw) : false;
  if (isbnRaw && !isThirteen && !ISBN_10_RE.test(isbnRaw)) {
    return { error: { row, field: 'isbn', message: 'isbn must be 10 or 13 characters' } };
  }

  const title = (record.title ?? '').trim();
  if (!title) return { error: { row, field: 'title', message: 'title is required' } };

  let publishedYear: number | undefined;
  const publishedYearRaw = record.publishedyear;
  if (publishedYearRaw) {
    const n = Number(publishedYearRaw);
    if (!Number.isInteger(n) || n < 0 || n > 3000) {
      return {
        error: {
          row,
          field: 'publishedYear',
          message: 'publishedYear must be an integer between 0 and 3000',
        },
      };
    }
    publishedYear = n;
  }

  return {
    data: {
      isbn13: isbnRaw && isThirteen ? isbnRaw : undefined,
      isbn10: isbnRaw && !isThirteen ? isbnRaw : undefined,
      title,
      subtitle: record.subtitle || undefined,
      author: record.author || undefined,
      publisher: record.publisher || undefined,
      publishedYear,
      edition: record.edition || undefined,
      language: record.language || undefined,
      callNumber: record.callnumber || undefined,
      category: record.category || undefined,
    },
  };
}

interface ValidRow {
  rowNum: number;
  data: ParsedTitleRow;
}

/**
 * Pass 1: pure validation/mapping (`mapImportRow` does no I/O), so every row
 * that CAN be rejected without touching the database is rejected before any
 * transaction — pre-pass or chunk — is ever opened for it. Standalone
 * function, not a method, for the same reason `mapImportRow` is: unit
 * tests drive it with no database and no fake `tx`.
 */
function validateRows(rows: Record<string, string>[]): {
  valid: ValidRow[];
  errors: RowError[];
  skipped: number;
} {
  const mapped: ValidRow[] = [];
  const errors: RowError[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const result = mapImportRow(rows[i], rowNum);
    if ('error' in result) {
      errors.push(result.error);
      continue;
    }
    mapped.push({ rowNum, data: result.data });
  }

  // Deduplicate by ISBN WITHIN the file, keeping the last occurrence.
  //
  // This is not a nicety — without it the import is broken for a common input.
  // `resolvePrepass` builds its existing-title map ONCE, before any chunk, so a
  // second row carrying an ISBN that the first row is about to create still
  // looks new and takes the CREATE branch. That raises P2002 against
  // `title_isbn13_per_org`, and Postgres then aborts the whole transaction:
  // Prisma does not wrap statements in savepoints, so every subsequent
  // statement on that `tx` fails with 25P02 ("current transaction is aborted").
  // The result was up to CHUNK_SIZE-1 unrelated valid rows discarded, reported
  // against the wrong row with an opaque message.
  //
  // Keep-last rather than keep-first because a spreadsheet's later row is the
  // correction: someone fixing a typo appends or edits below, and the file's
  // own last word on a title is the one they meant. The dropped rows are
  // reported as errors so the count is visible rather than silent — a file
  // that quietly imports fewer rows than it contains is worse than one that
  // says why.
  const lastIndexByIsbn = new Map<string, number>();
  for (let i = 0; i < mapped.length; i++) {
    const key = mapped[i].data.isbn13 ?? mapped[i].data.isbn10;
    if (key) lastIndexByIsbn.set(key, i);
  }
  const valid: ValidRow[] = [];
  for (let i = 0; i < mapped.length; i++) {
    const row = mapped[i];
    const key = row.data.isbn13 ?? row.data.isbn10;
    if (key && lastIndexByIsbn.get(key) !== i) {
      errors.push({
        row: row.rowNum,
        field: 'isbn',
        message: `duplicate isbn ${key} in this file — superseded by row ${lastIndexByIsbn.get(key)! + 1}`,
      });
      continue;
    }
    valid.push(row);
  }

  return { valid, errors, skipped: errors.length };
}

/** Exported for tests: validateRows is internal, but its dedupe is a
 *  behaviour worth asserting directly rather than through a whole import. */
export const validateRowsForTest = validateRows;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

@Injectable()
export class ImportService {
  /**
   * Up-front resolution, THEN chunked transactions — not one giant
   * transaction for the whole file. Prisma 5's default $transaction
   * `timeout` is 5000ms; the old row-by-row implementation did 2-5
   * sequential round trips per row, so MAX_IMPORT_ROWS (2000) rows meant
   * 4000+ sequential awaits in ONE transaction, blowing the timeout long
   * before the 60s function budget was ever the binding constraint.
   *
   * Fixed in two layers:
   *  1. `resolvePrepass` runs ONCE, before any chunk, and resolves every
   *     distinct category/author name across the WHOLE file in a bounded
   *     number of queries (see its own doc comment) — not per row, not per
   *     chunk.
   *  2. The rows themselves are applied in CHUNK_SIZE-row chunks, each its
   *     own `withOrg` transaction. This is a deliberate trade, not
   *     incidental: if chunk 7 of 20 fails, chunks 1-6 stay committed. One
   *     bad row at position 1,999 must not discard 1,998 good ones — that
   *     is the entire reason chunking exists instead of one transaction
   *     (fast but all-or-nothing) or one transaction per row (safe but
   *     slow and exactly the round-trip-per-row problem this replaces).
   *
   * Partial application is therefore an EXPECTED, reported outcome, not a
   * failure mode to eliminate: `status` is `'completed_with_errors'`
   * whenever any row's chunk failed OR any row failed pure validation, and
   * the caller gets created/updated/skipped counts plus a row-level error
   * list (row, field, message) precise enough to fix the file and re-run.
   * Re-running is safe because of idempotency-by-ISBN (see `applyChunk`'s
   * isbn13 create-create-race recovery and `mapImportRow`'s no-ISBN
   * comment for the one deliberate exception to it).
   *
   * Dry run shares this exact same chunked path — see `runChunk` below —
   * rolling each chunk back individually rather than running the whole
   * file in one (rollback-only) transaction, so what dry run reports is
   * genuinely "what the real path would do to each chunk", not a
   * differently-shaped simulation that could drift from it.
   */
  async importTitles(
    orgId: string,
    rows: Record<string, string>[],
    opts: ImportOptions = {},
  ): Promise<ImportResult> {
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new PayloadTooLargeException(`Import is capped at ${MAX_IMPORT_ROWS} rows per request`);
    }

    const { valid, errors: mappingErrors, skipped: mappingSkipped } = validateRows(rows);
    if (valid.length === 0) {
      return {
        status: mappingErrors.length ? 'completed_with_errors' : 'completed',
        created: 0,
        createdNoIsbn: 0,
        updated: 0,
        skipped: mappingSkipped,
        errors: mappingErrors,
      };
    }

    const dryRun = !!opts.dryRun;
    const prepass = await withOrg(
      orgId,
      (tx) => resolvePrepass(tx, orgId, valid, { dryRun }),
      undefined,
      PREPASS_TX_OPTIONS,
    );

    let created = 0;
    let createdNoIsbn = 0;
    let updated = 0;
    let skipped = mappingSkipped;
    const errors: RowError[] = [...mappingErrors];

    for (const chunk of chunkArray(valid, CHUNK_SIZE)) {
      try {
        const result = await runChunk(orgId, chunk, prepass, dryRun);
        created += result.created;
        createdNoIsbn += result.createdNoIsbn;
        updated += result.updated;
      } catch (err) {
        // The whole chunk's transaction rolled back — none of its rows
        // persisted. This is the "partial application" trade described
        // above: later chunks are still attempted (the loop continues),
        // but every row IN this chunk is honestly reported as not applied,
        // not just the one that triggered the failure.
        const rowError =
          err instanceof ChunkRowError
            ? err.rowError
            : {
                row: chunk[0].rowNum,
                field: 'database',
                message: err instanceof Error ? err.message : String(err),
              };
        errors.push(rowError);
        skipped += chunk.length;
      }
    }

    return {
      status: errors.length ? 'completed_with_errors' : 'completed',
      created,
      createdNoIsbn,
      updated,
      skipped,
      errors,
    };
  }
}

interface ChunkResult {
  created: number;
  createdNoIsbn: number;
  updated: number;
}

/**
 * Runs one chunk in its own `withOrg` transaction. For a dry run, the
 * chunk's would-be result is thrown out via `DryRunChunkRollback` (caught
 * here, not by the caller) purely to make Prisma roll THIS chunk back —
 * exactly the trick the old whole-file implementation used, just scoped
 * down to chunk granularity so dry run exercises the identical chunked
 * code path a real run does.
 */
async function runChunk(
  orgId: string,
  chunk: ValidRow[],
  prepass: Prepass,
  dryRun: boolean,
): Promise<ChunkResult> {
  try {
    return await withOrg(
      orgId,
      async (tx) => {
        const result = await applyChunk(tx, orgId, chunk, prepass);
        if (dryRun) throw new DryRunChunkRollback(result);
        return result;
      },
      undefined,
      CHUNK_TX_OPTIONS,
    );
  } catch (err) {
    if (err instanceof DryRunChunkRollback) return err.result;
    throw err;
  }
}

export interface Prepass {
  existingByIsbn13: Map<string, string>;
  existingByIsbn10: Map<string, string>;
  categoryIdByName: Map<string, string>;
  authorIdByName: Map<string, string>;
}

function findExistingId(prepass: Pick<Prepass, 'existingByIsbn13' | 'existingByIsbn10'>, data: ParsedTitleRow): string | undefined {
  return (
    (data.isbn13 && prepass.existingByIsbn13.get(data.isbn13)) ||
    (data.isbn10 && prepass.existingByIsbn10.get(data.isbn10)) ||
    undefined
  );
}

/**
 * Up-front resolution, run ONCE for the whole file before any chunk runs —
 * this is the change that takes the transaction(s) from 2-5 round trips
 * PER ROW down to a small constant for the WHOLE FILE plus one write per
 * row (in the chunk loop):
 *
 *  - ONE query to find which of this file's ISBNs already have a Title
 *    row (tells every chunk, up front, which of ITS rows will UPDATE vs
 *    CREATE — needed before category/author resolution below, since only
 *    CREATE rows ever read `categoryId`/`authorLink`; resolving those for
 *    an UPDATE row is pure waste the update branch never uses).
 *  - ONE query + ONE `createMany` + ONE re-read for every distinct
 *    category name the file's CREATE rows need, and the same for author
 *    names — instead of a `findFirst`(+maybe `create`) per row.
 *
 * `createMany({ skipDuplicates: true })` (not `findFirst` + conditional
 * `create`) is what makes the category/author step race-safe: under READ
 * COMMITTED, a concurrent import creating the SAME name between this
 * function's read and its write must not throw P2002 and abort this
 * file's import the way a bare `create` would. `skipDuplicates` turns the
 * race into a silent no-op instead, and the re-read resolves to whichever
 * row won (ours or the concurrent import's) — see `resolveByUniqueName`.
 *
 * Both resolvers read/write on `tx` — a `withOrg` transaction — so RLS
 * scopes them to this org's own Category/Author rows only. A lookup on an
 * unscoped connection (e.g. the platform client) would let a name collide
 * across orgs and link this org's title to a row it cannot see or own;
 * this is the exact "name that resolves to an id" case this module has
 * already broken twice on raw UUIDs (see titles.service.ts /
 * categories.service.ts for the same guard, and
 * catalog-import.e2e.spec.ts's cross-org category test for the proof).
 *
 * DRY RUN skips the category/author WRITE step entirely (still does the
 * existing-title read, since that determines the create/update counts a
 * dry run must report accurately). This is safe, not a shortcut that
 * quietly changes behaviour: `ImportResult`'s created/updated/skipped/
 * errors counts depend only on whether a TITLE row would be created vs
 * updated, never on whether it ends up linked to a category/author. Since
 * dry run never persists anything regardless, resolving real
 * category/author ids for it would only be useful for linking — and dry
 * run's chunk writes (see `applyChunk`) don't attempt that link at all
 * when running dry, so there is nothing for a real id to be used for. This
 * is also what keeps "writes nothing" literally true for dry run without
 * needing to also roll back a separate, would-be-committed prepass
 * transaction: the write step simply never runs when dryRun is true.
 */
export async function resolvePrepass(
  tx: LibraryTx,
  orgId: string,
  valid: ValidRow[],
  opts: { dryRun: boolean },
): Promise<Prepass> {
  const isbn13List = [...new Set(valid.map((r) => r.data.isbn13).filter((x): x is string => !!x))];
  const isbn10List = [...new Set(valid.map((r) => r.data.isbn10).filter((x): x is string => !!x))];
  const existingTitles =
    isbn13List.length || isbn10List.length
      ? await tx.title.findMany({
          where: {
            OR: [
              ...(isbn13List.length ? [{ isbn13: { in: isbn13List } }] : []),
              ...(isbn10List.length ? [{ isbn10: { in: isbn10List } }] : []),
            ],
          },
          select: { id: true, isbn13: true, isbn10: true },
        })
      : [];
  const existingByIsbn13 = new Map(
    existingTitles.filter((t) => t.isbn13).map((t) => [t.isbn13 as string, t.id]),
  );
  const existingByIsbn10 = new Map(
    existingTitles.filter((t) => t.isbn10).map((t) => [t.isbn10 as string, t.id]),
  );

  if (opts.dryRun) {
    return { existingByIsbn13, existingByIsbn10, categoryIdByName: new Map(), authorIdByName: new Map() };
  }

  const createRows = valid.filter((r) => !findExistingId({ existingByIsbn13, existingByIsbn10 }, r.data));
  const categoryNames = [
    ...new Set(createRows.map((r) => r.data.category).filter((x): x is string => !!x)),
  ];
  const authorNames = [
    ...new Set(createRows.map((r) => r.data.author).filter((x): x is string => !!x)),
  ];

  const categoryIdByName = await resolveByUniqueName(
    tx.category,
    categoryNames,
    'name',
    (name) => ({ orgId, name }),
  );
  const authorIdByName = await resolveByUniqueName(tx.author, authorNames, 'sortName', (name) => ({
    orgId,
    name,
    sortName: name,
  }));

  return { existingByIsbn13, existingByIsbn10, categoryIdByName, authorIdByName };
}

/**
 * Applies one chunk's rows using the whole-file `Prepass` maps — no
 * per-row lookups. Standalone function (not a method), exactly like
 * `mapImportRow`/`validateRows` above: it takes `tx` as a plain parameter
 * so a unit test can drive it against a hand-built fake `tx` without a
 * real database.
 */
export async function applyChunk(
  tx: LibraryTx,
  orgId: string,
  chunk: ValidRow[],
  prepass: Prepass,
): Promise<ChunkResult> {
  let created = 0;
  let createdNoIsbn = 0;
  let updated = 0;

  for (const { rowNum, data } of chunk) {
    const existingId = findExistingId(prepass, data);
    if (existingId) {
      await updateScalarFields(tx, existingId, data);
      updated++;
      continue;
    }

    const noIsbn = !data.isbn13 && !data.isbn10;
    const categoryId = data.category ? prepass.categoryIdByName.get(data.category) : undefined;
    const authorId = data.author ? prepass.authorIdByName.get(data.author) : undefined;

    try {
      await tx.title.create({
        data: {
          orgId,
          isbn13: data.isbn13,
          isbn10: data.isbn10,
          title: data.title,
          subtitle: data.subtitle,
          publisher: data.publisher,
          publishedYear: data.publishedYear,
          edition: data.edition,
          language: data.language ?? 'en',
          callNumber: data.callNumber,
          authors: authorId ? { create: [{ authorId, role: 'AUTHOR' }] } : undefined,
          categories: categoryId ? { create: [{ categoryId }] } : undefined,
        },
      });
      created++;
      if (noIsbn) createdNoIsbn++;
    } catch (err) {
      // Idempotency backing: `title_isbn13_per_org` is a partial UNIQUE
      // index on (orgId, isbn13) WHERE isbn13 IS NOT NULL (see the
      // catalogue migration). Trap 3 — a transaction gives atomicity, not
      // mutual exclusion; under READ COMMITTED, two truly concurrent
      // imports that both `BEGIN` before either commits can both miss this
      // row in the prepass and both attempt CREATE. Without this catch,
      // the loser's P2002 would propagate out of this chunk and roll back
      // the WHOLE CHUNK for one colliding row. Recover instead: the
      // winner's row now exists, so re-read it and fall back to the same
      // scalar-only UPDATE the row would have taken had the prepass seen
      // it first.
      //
      // This index covers isbn13 rows only — there is no equivalent
      // partial unique index on (orgId, isbn10). An isbn10 row racing a
      // concurrent import on the same ISBN can still both-miss-both-create
      // (see the report's Concerns section); it is not silently "handled"
      // by this catch, which only fires for an isbn13 conflict. Any OTHER
      // error (including that unhandled isbn10 race, and any genuine
      // database error) is wrapped in `ChunkRowError` and rethrown, which
      // aborts and rolls back this chunk's transaction — `importTitles`
      // reports it against this exact row instead of a generic failure.
      // NO in-transaction P2002 recovery here, deliberately. An earlier version
      // caught the unique violation and tried to re-read the winner and update
      // it instead. That could never work: Prisma does not wrap statements in
      // savepoints, so the failed INSERT aborts the whole Postgres transaction
      // and every following statement returns 25P02 ("current transaction is
      // aborted, commands ignored until end of transaction block"). The
      // recovery always threw, the chunk rolled back anyway, and the comment
      // claiming otherwise was false — verified directly against Postgres.
      //
      // The common trigger (the same ISBN twice in one uploaded file) is now
      // removed upstream by the in-file dedupe in `validateRows`. What remains
      // is a genuine cross-request race: two concurrent imports of different
      // files sharing an ISBN. That correctly rolls this chunk back and is
      // reported against the offending row; a re-run then takes the UPDATE
      // branch because the prepass sees the winner's row. Recovering in-place
      // would need a per-row SAVEPOINT, which costs a round trip on every row
      // to salvage a rare one — the wrong trade at 2,000 rows.
      throw new ChunkRowError({
        row: rowNum,
        field: 'database',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { created, createdNoIsbn, updated };
}

/**
 * Scalar fields only, and only the ones this row actually carries a value
 * for — an empty CSV cell must not blank out a field a previous import
 * (or the manual catalogue UI) already populated. Relinking
 * authors/categories on update is deliberately out of scope, same call
 * `UpdateTitleDto` already makes for the single-title PATCH endpoint —
 * which is also why an UPDATE row never needs `categoryId`/`authorLink`
 * resolved for it at all (`resolvePrepass` only resolves those for CREATE
 * rows).
 */
function updateScalarFields(tx: LibraryTx, titleId: string, data: ParsedTitleRow) {
  return tx.title.update({
    where: { id: titleId },
    data: {
      title: data.title,
      subtitle: data.subtitle,
      publisher: data.publisher,
      publishedYear: data.publishedYear,
      edition: data.edition,
      language: data.language,
      callNumber: data.callNumber,
    },
  });
}

/**
 * Find-or-create-by-unique-name for a whole file's worth of distinct names
 * in a bounded number of round trips: one `findMany` for what already
 * exists, one `createMany` for what's missing, one re-`findMany` to pick
 * up the ids (including — Trap 3 — ids created by a *different*, truly
 * concurrent transaction between our read and our write).
 *
 * `skipDuplicates: true` is what makes the create step race-safe: under
 * READ COMMITTED, a concurrent import creating the SAME name between our
 * read and this write must not throw P2002 and abort this file the way a
 * bare `create` would. `skipDuplicates` turns the race into a silent no-op
 * instead, and the re-read below resolves to whichever row won (ours or
 * theirs).
 */
async function resolveByUniqueName(
  // `any` args, not `unknown`: Prisma's generated delegate methods
  // (`tx.category`, `tx.author`) are generic overloads keyed to each
  // model's own args type, which cannot structurally unify with a
  // caller-supplied `unknown` parameter type. This helper's own call sites
  // are the only source of `args`, and they are well-known shapes
  // (`{ where, select }` / `{ data, skipDuplicates }`), so the looseness
  // here is contained.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: {
    findMany: (args: any) => Promise<{ id: string; [key: string]: unknown }[]>;
    createMany: (args: any) => Promise<unknown>;
  },
  names: string[],
  uniqueField: 'name' | 'sortName',
  toCreateData: (name: string) => Record<string, unknown>,
): Promise<Map<string, string>> {
  if (names.length === 0) return new Map();

  const existing = await model.findMany({
    where: { [uniqueField]: { in: names } },
    select: { id: true, [uniqueField]: true },
  });
  const map = new Map(existing.map((row) => [row[uniqueField] as string, row.id]));

  const missing = names.filter((n) => !map.has(n));
  if (missing.length > 0) {
    await model.createMany({ data: missing.map(toCreateData), skipDuplicates: true });
    const reread = await model.findMany({
      where: { [uniqueField]: { in: missing } },
      select: { id: true, [uniqueField]: true },
    });
    for (const row of reread) map.set(row[uniqueField] as string, row.id);
  }

  return map;
}

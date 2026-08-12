import { withOrg, type LibraryTx } from '@library/db';
import { CHUNK_SIZE, ImportService } from '../src/modules/catalog/internal/import.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/** 13 digits, unique per row-number within one test's fresh org. */
const isbnFor = (n: number): string => `978${String(n).padStart(10, '0')}`;

describeLive('ImportService.importTitles — one chunk fails midway, then re-run (live)', () => {
  const importService = new ImportService();
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`catimportfail-${Date.now().toString(36)}`));
  });

  afterAll(async () => {
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  /**
   * This is the property the whole chunked design (see import.service.ts's
   * module doc comment on `importTitles`) rests on: chunk N failing must
   * not discard chunks 1..N-1, and chunks after N must still be attempted.
   *
   * Three full chunks (CHUNK_SIZE rows each), poison row in the MIDDLE of
   * the middle chunk. The poison is a title containing an embedded NUL
   * byte — `mapImportRow` only checks the title is non-empty (a NUL byte
   * survives `.trim()` and any truthiness check), so this passes pure
   * validation and reaches the database, where Postgres genuinely rejects
   * it (`22021 invalid byte sequence for encoding "UTF8"`) — a real
   * database-reason failure, not a disguised validation failure. Verified
   * empirically against this exact schema/driver before writing this
   * assertion (LIBRARY-TRAPS #15): the error is a
   * `PrismaClientUnknownRequestError`, NOT a `PrismaClientKnownRequestError`
   * with code P2002, so it does NOT go through `applyChunk`'s isbn13
   * create-create-race recovery — it is thrown as-is, wrapped in
   * `ChunkRowError`, and rolls back the WHOLE middle chunk.
   *
   * The embedded NUL byte is written here as the `\0` escape sequence, an
   * ASCII source token — never a literal control-character byte (LIBRARY-
   * TRAPS #11: a raw 0x00 byte in a source file makes git treat it as
   * binary, breaking diff/blame permanently).
   */
  const TOTAL_ROWS = CHUNK_SIZE * 3;
  const CHUNK1_END = CHUNK_SIZE; // rows 1..CHUNK_SIZE
  const CHUNK2_END = CHUNK_SIZE * 2; // rows CHUNK_SIZE+1..2*CHUNK_SIZE — the middle chunk
  const NO_ISBN_ROW = Math.floor(CHUNK_SIZE / 2); // inside chunk 1 — always-succeeding chunk
  const POISON_ROW = CHUNK1_END + Math.floor(CHUNK_SIZE / 2); // dead center of the middle chunk
  const NO_ISBN_TITLE = 'Chunk Failure Probe — no-isbn row';

  function buildRows(): Record<string, string>[] {
    return Array.from({ length: TOTAL_ROWS }, (_, i) => {
      const rowNum = i + 1;
      if (rowNum === NO_ISBN_ROW) {
        return { isbn: '', title: NO_ISBN_TITLE };
      }
      if (rowNum === POISON_ROW) {
        return { isbn: isbnFor(rowNum), title: `Poison\0Row${rowNum}` };
      }
      return { isbn: isbnFor(rowNum), title: `Chunk Failure Probe row ${rowNum}` };
    });
  }

  const isbnsInRange = (fromRowInclusive: number, toRowInclusive: number, exclude: number[] = []): string[] => {
    const out: string[] = [];
    for (let r = fromRowInclusive; r <= toRowInclusive; r++) {
      if (exclude.includes(r)) continue;
      out.push(isbnFor(r));
    }
    return out;
  };

  it(
    'commits earlier chunks, still attempts later chunks, names the right row — then a same-file re-run updates ISBN rows and duplicates the no-ISBN row',
    async () => {
      const rows = buildRows();

      // ---------------------------------------------------------------
      // RUN 1
      // ---------------------------------------------------------------
      const result1 = await importService.importTitles(orgA.id, rows, {});

      expect(result1.status).toBe('completed_with_errors');
      // Exactly ONE error entry for the whole failed chunk (not one per
      // row) — importTitles reports the chunk-level exception once; the
      // *other* 199 lost rows in that chunk are accounted for via `skipped`
      // instead (see the module doc comment on this trade-off).
      expect(result1.errors).toEqual([
        { row: POISON_ROW, field: 'database', message: expect.stringContaining('invalid byte sequence') },
      ]);
      // chunk 1 (CHUNK_SIZE rows: CHUNK_SIZE-1 isbn rows + 1 no-isbn row) +
      // chunk 3 (CHUNK_SIZE isbn rows) created; chunk 2 (CHUNK_SIZE rows,
      // including the poison row) fully rolled back and counted as skipped.
      expect(result1.created).toBe(CHUNK_SIZE * 2);
      expect(result1.createdNoIsbn).toBe(1);
      expect(result1.updated).toBe(0);
      expect(result1.skipped).toBe(CHUNK_SIZE);

      // Chunk 1 committed.
      const chunk1Isbns = isbnsInRange(1, CHUNK1_END, [NO_ISBN_ROW]);
      const chunk1Titles = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { isbn13: { in: chunk1Isbns } } }),
      );
      expect(chunk1Titles).toHaveLength(chunk1Isbns.length);
      const noIsbnTitlesAfterRun1 = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { title: NO_ISBN_TITLE } }),
      );
      expect(noIsbnTitlesAfterRun1).toHaveLength(1);

      // Chunk 2 (the failed one) fully rolled back — including the 199
      // rows that were NOT themselves the bad row. This is the "blast
      // radius" the module doc comment describes: one bad row costs the
      // whole chunk, not just itself.
      const chunk2Isbns = isbnsInRange(CHUNK1_END + 1, CHUNK2_END, [POISON_ROW]);
      const chunk2Titles = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { isbn13: { in: [...chunk2Isbns, isbnFor(POISON_ROW)] } } }),
      );
      expect(chunk2Titles).toHaveLength(0);

      // Chunk 3 still attempted (and committed) despite chunk 2 failing —
      // the loop does not abort the file after one chunk's rollback.
      const chunk3Isbns = isbnsInRange(CHUNK2_END + 1, TOTAL_ROWS);
      const chunk3Titles = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { isbn13: { in: chunk3Isbns } } }),
      );
      expect(chunk3Titles).toHaveLength(chunk3Isbns.length);

      // ---------------------------------------------------------------
      // RUN 2 — the SAME file, byte-for-byte unmodified.
      // ---------------------------------------------------------------
      const result2 = await importService.importTitles(orgA.id, rows, {});

      expect(result2.status).toBe('completed_with_errors');
      // The poison row's cause (the embedded NUL byte) lives in the FILE
      // itself, which this re-run deliberately does not change — a
      // corrupted byte in a real CSV export does not fix itself on a
      // second upload of the exact same file. So the middle chunk fails
      // AGAIN, identically, naming the SAME row. This is a stronger proof
      // than a self-healing cause would be: it shows the retry is safe
      // (idempotent) even when the underlying bad data is still there —
      // no duplicate created for the poison row, no corruption of its
      // neighbours, same error reported both times.
      expect(result2.errors).toEqual([
        { row: POISON_ROW, field: 'database', message: expect.stringContaining('invalid byte sequence') },
      ]);
      // Chunk 1's isbn rows and chunk 3's isbn rows all already exist from
      // run 1, so this run UPDATEs them instead of creating duplicates.
      expect(result2.updated).toBe(chunk1Isbns.length + chunk3Isbns.length);
      // The no-ISBN row is NEVER matched against an existing Title (see
      // `mapImportRow`'s no-ISBN doc comment / `ImportResult.createdNoIsbn`)
      // — re-running the same file creates it again. This is the policy
      // this proof exists to pin down, not silently "fix" later.
      expect(result2.created).toBe(1);
      expect(result2.createdNoIsbn).toBe(1);
      expect(result2.skipped).toBe(CHUNK_SIZE);

      // ISBN rows updated, not duplicated — still exactly one row per isbn.
      const chunk1TitlesAfterRun2 = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { isbn13: { in: chunk1Isbns } } }),
      );
      expect(chunk1TitlesAfterRun2).toHaveLength(chunk1Isbns.length);
      const chunk3TitlesAfterRun2 = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { isbn13: { in: chunk3Isbns } } }),
      );
      expect(chunk3TitlesAfterRun2).toHaveLength(chunk3Isbns.length);

      // No-ISBN row duplicated exactly as the policy says it will: TWO
      // rows now, not one. This assertion matters as much as the ISBN
      // ones — it pins the deliberate exception to idempotency so nobody
      // later "fixes" it into a silent merge.
      const noIsbnTitlesAfterRun2 = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { title: NO_ISBN_TITLE } }),
      );
      expect(noIsbnTitlesAfterRun2).toHaveLength(2);

      // The failed chunk stays empty across both runs — no partial/ghost
      // rows accumulate from repeated failed attempts.
      const chunk2TitlesAfterRun2 = await withOrg(orgA.id, (tx: LibraryTx) =>
        tx.title.findMany({ where: { isbn13: { in: [...chunk2Isbns, isbnFor(POISON_ROW)] } } }),
      );
      expect(chunk2TitlesAfterRun2).toHaveLength(0);
    },
    60_000,
  );
});

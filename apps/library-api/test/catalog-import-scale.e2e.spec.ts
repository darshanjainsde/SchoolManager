import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { ImportService, MAX_IMPORT_ROWS } from '../src/modules/catalog/internal/import.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * At-scale proof for the chunked import path (see import.service.ts's
 * doc comment on `MAX_IMPORT_ROWS` / `CHUNK_SIZE`, which both point back
 * here for the measured wall-clock number). The OLD implementation ran the
 * whole file in one transaction and would have blown Prisma 5's 5000ms
 * default `$transaction` timeout well before MAX_IMPORT_ROWS rows — and
 * nothing tested it at anywhere near this size, so "a library importing an
 * 8,000-copy collection" (necessarily as multiple MAX_IMPORT_ROWS-row
 * files, since that is the per-request cap) was the least-tested path in
 * the whole module. This spec pushes exactly MAX_IMPORT_ROWS rows — the
 * real cap, not an arbitrary round number — through the real
 * `ImportService.importTitles` against local Postgres: pre-pass +
 * CHUNK_SIZE-row chunked transactions, precisely the path a production
 * request takes.
 *
 * Rows are NOT all-identical: distinct category/author names (cycled, not
 * one-per-row) exercise `resolvePrepass`'s batched category/author
 * resolution under load too, not just the isbn existence check — a file of
 * 2,000 truly-blank-metadata rows would under-test the pre-pass relative to
 * a real library catalogue import.
 */
describeLive('ImportService.importTitles — at scale (live)', () => {
  const importService = new ImportService();
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`catimportscale-${Date.now().toString(36)}`));
  });

  afterAll(async () => {
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  it(
    `imports exactly MAX_IMPORT_ROWS (${MAX_IMPORT_ROWS}) rows in one call, all created, no errors`,
    async () => {
      const CATEGORY_COUNT = 25;
      const AUTHOR_COUNT = 40;
      // 13 digits total ('978' + 10-digit zero-padded row index) — passes
      // ISBN_13_RE and is unique per row within this org; this org is
      // fresh (seedTwoOrgs) and torn down in afterAll, so there is no
      // cross-run collision risk despite the fixed, non-timestamped scheme.
      const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => {
        const n = i + 1;
        return {
          isbn: `978${String(n).padStart(10, '0')}`,
          title: `Scale Probe Title ${n}`,
          author: `Scale Probe Author ${n % AUTHOR_COUNT}`,
          category: `Scale Probe Category ${n % CATEGORY_COUNT}`,
        };
      });

      const startedAt = Date.now();
      const result = await importService.importTitles(orgA.id, rows, {});
      const elapsedMs = Date.now() - startedAt;

      // eslint-disable-next-line no-console -- the whole point of this test is to report this number (see the module doc comment and the phase1a report).
      console.log(
        `[at-scale proof] ${MAX_IMPORT_ROWS} rows via importTitles: ${elapsedMs}ms ` +
          `(${(elapsedMs / MAX_IMPORT_ROWS).toFixed(2)}ms/row)`,
      );

      expect(result).toEqual({
        status: 'completed',
        created: MAX_IMPORT_ROWS,
        createdNoIsbn: 0,
        updated: 0,
        skipped: 0,
        errors: [],
      });

      const count = await withOrg(orgA.id, (tx: LibraryTx) => tx.title.count({ where: { orgId: orgA.id } }));
      expect(count).toBe(MAX_IMPORT_ROWS);

      // Category/author batching held under load too: exactly the distinct
      // counts this file used, not one row's worth of duplicates each.
      const prisma = getLibraryPlatformPrisma();
      const categoryCount = await prisma.category.count({ where: { orgId: orgA.id } });
      const authorCount = await prisma.author.count({ where: { orgId: orgA.id } });
      expect(categoryCount).toBe(CATEGORY_COUNT);
      expect(authorCount).toBe(AUTHOR_COUNT);

      // Not a hard assertion (this is a proof/measurement spec, not a perf
      // gate — the real judgment call on MAX_IMPORT_ROWS/CHUNK_SIZE belongs
      // in the report, not a flaky CI threshold), but a generous outer
      // bound catches a true regression (e.g. an accidental return to one
      // round trip per row) without flaking on a slow CI box.
      expect(elapsedMs).toBeLessThan(60_000);
    },
    120_000,
  );
});

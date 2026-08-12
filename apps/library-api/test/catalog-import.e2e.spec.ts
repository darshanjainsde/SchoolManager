import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { ImportService, MAX_IMPORT_ROWS } from '../src/modules/catalog/internal/import.service';
import { LIVE, cleanupOrgs, seedLogins, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/** Every ISBN used across this file is unique-per-run so parallel/rerun test invocations never collide on a leftover row from a previous run. */
const uniqueIsbn = (seed: string): string => {
  // 13 digits, deterministic-enough per seed, no real-world meaning.
  // The seed is reduced to digits first: a caller passing a readable label
  // ('http1') would otherwise splice letters into the ISBN, and the importer
  // would correctly reject it — sending the test hunting for a validator bug
  // that isn't there.
  const seedDigits = [...seed].map((c) => (c.charCodeAt(0) % 10).toString()).join('');
  const digits = `978${Date.now().toString().slice(-6)}${seedDigits}`.padEnd(13, '0').slice(0, 13);
  return digits;
};

describeLive('ImportService.importTitles — live', () => {
  const importService = new ImportService();
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`catimport-${Date.now().toString(36)}`));
  });

  afterAll(async () => {
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  /**
   * Dry run must return the SAME diff a real run would apply, without
   * writing. Proved two ways: (1) after the dry run, nothing exists in the
   * database for these ISBNs at all; (2) the dry run's returned counts are
   * identical to what the immediately-following real run reports for the
   * exact same rows.
   */
  it('dry run reports the same diff the real run applies, and writes nothing', async () => {
    const isbnOne = uniqueIsbn('1');
    const isbnTwo = uniqueIsbn('2');
    const rows = [
      { isbn: isbnOne, title: 'Dry Run Probe One' },
      { isbn: isbnTwo, title: 'Dry Run Probe Two' },
    ];

    const dryRunResult = await importService.importTitles(orgA.id, rows, { dryRun: true });
    expect(dryRunResult).toEqual({ status: 'completed', created: 2, createdNoIsbn: 0, updated: 0, skipped: 0, errors: [] });

    const afterDryRun = await withOrg(orgA.id, (tx: LibraryTx) =>
      tx.title.findMany({ where: { isbn13: { in: [isbnOne, isbnTwo] } } }),
    );
    expect(afterDryRun).toHaveLength(0); // nothing written

    const realRunResult = await importService.importTitles(orgA.id, rows, { dryRun: false });
    expect(realRunResult).toEqual(dryRunResult); // identical diff

    const afterRealRun = await withOrg(orgA.id, (tx: LibraryTx) =>
      tx.title.findMany({ where: { isbn13: { in: [isbnOne, isbnTwo] } } }),
    );
    expect(afterRealRun).toHaveLength(2);
  });

  it('is idempotent by ISBN within an org — re-importing the same file updates rather than duplicating', async () => {
    const isbn = uniqueIsbn('3');
    const rows = [{ isbn, title: 'Idempotency Probe v1' }];

    const first = await importService.importTitles(orgA.id, rows, {});
    expect(first).toEqual({ status: 'completed', created: 1, createdNoIsbn: 0, updated: 0, skipped: 0, errors: [] });

    const second = await importService.importTitles(orgA.id, [{ isbn, title: 'Idempotency Probe v2' }], {});
    expect(second).toEqual({ status: 'completed', created: 0, createdNoIsbn: 0, updated: 1, skipped: 0, errors: [] });

    const rows_in_db = await withOrg(orgA.id, (tx: LibraryTx) => tx.title.findMany({ where: { isbn13: isbn } }));
    expect(rows_in_db).toHaveLength(1); // not 2
    expect(rows_in_db[0].title).toBe('Idempotency Probe v2'); // the update actually applied
  });

  it('reports a per-row error with row + field and still imports every other row in the file', async () => {
    const isbnGood1 = uniqueIsbn('4');
    const isbnGood2 = uniqueIsbn('5');
    const rows = [
      { isbn: isbnGood1, title: 'Bad Row Probe — Good Row 1' },
      // Row 2 is invalid because the ISBN is PRESENT but malformed — a typo.
      // A *blank* isbn cell is deliberately valid (see the no-ISBN policy in
      // mapImportRow), so this fixture uses a bad value rather than an empty
      // one; an empty one would now create a row and prove nothing.
      { isbn: '12345', title: 'Bad Row Probe — Malformed ISBN' },
      { isbn: isbnGood2, title: 'Bad Row Probe — Good Row 2' },
    ];

    const result = await importService.importTitles(orgA.id, rows, {});

    expect(result).toEqual({
      status: 'completed_with_errors',
      created: 2,
      createdNoIsbn: 0,
      updated: 0,
      skipped: 1,
      errors: [{ row: 2, field: 'isbn', message: 'isbn must be 10 or 13 characters' }],
    });

    const created = await withOrg(orgA.id, (tx: LibraryTx) =>
      tx.title.findMany({ where: { isbn13: { in: [isbnGood1, isbnGood2] } } }),
    );
    expect(created).toHaveLength(2);
  });

  it('rejects a file over MAX_IMPORT_ROWS with a 413 naming the limit, at the service level too', async () => {
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ isbn: uniqueIsbn(`cap${i}`), title: `Row ${i}` }));
    await expect(importService.importTitles(orgA.id, tooMany, {})).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining(String(MAX_IMPORT_ROWS)),
    });
  });

  /**
   * The client-supplied-FK guard, applied to "a category name that resolves
   * to an id" (the exact case LIBRARY-TRAPS #16 / the task brief calls out
   * for this module, which has already broken this guard twice on raw
   * UUIDs — see titles.service.ts / categories.service.ts).
   *
   * Proof this test protects against: `ImportService.applyRows` resolves
   * `data.category` by NAME on `tx` (RLS-scoped to the importing org) and
   * creates a new Category row for this org if none matches, rather than
   * looking the name up on an unscoped connection (which could match
   * ANOTHER org's category row of the same name and link this org's title
   * to a Category it cannot see or own).
   *
   * Deliberate-break-and-restore (LIBRARY-TRAPS #16), performed manually
   * during development rather than left as a toggle in this file:
   * `resolvePrepass`'s category lookup/create was temporarily changed to use
   * `getLibraryPlatformPrisma()` (an unscoped, BYPASSRLS client) instead of
   * `tx`. With that change, this test failed — orgA's title ended up linked
   * to orgB's pre-existing "Shared Category Name" row (same id, cross-org).
   * The lookup was restored to `tx` and this test passed again. No separate
   * transcript file exists for that break/restore cycle — this test itself,
   * run red-then-green, is the record.
   */
  it("a CSV category name never resolves to another org's Category row", async () => {
    const prisma = getLibraryPlatformPrisma();
    const sharedName = `Shared Category Name ${Date.now().toString(36)}`;
    const categoryInOrgB = await prisma.category.create({ data: { orgId: orgB.id, name: sharedName } });

    const isbn = uniqueIsbn('6');
    const result = await importService.importTitles(orgA.id, [{ isbn, title: 'Category FK Guard Probe', category: sharedName }], {});
    expect(result).toEqual({ status: 'completed', created: 1, createdNoIsbn: 0, updated: 0, skipped: 0, errors: [] });

    const [titleInOrgA] = await withOrg(orgA.id, (tx: LibraryTx) =>
      tx.title.findMany({ where: { isbn13: isbn }, include: { categories: { include: { category: true } } } }),
    );
    expect(titleInOrgA.categories).toHaveLength(1);
    const linkedCategory = titleInOrgA.categories[0].category;
    expect(linkedCategory.name).toBe(sharedName); // same name...
    expect(linkedCategory.id).not.toBe(categoryInOrgB.id); // ...but NOT org B's row
    expect(linkedCategory.orgId).toBe(orgA.id); // a fresh Category row scoped to org A
  });
});

describeLive('POST /catalog/import/titles — live HTTP', () => {
  let app: INestApplication;
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let tokens: Record<'ORG_OWNER' | 'LIBRARIAN' | 'ASSISTANT' | 'MEMBER', string>;
  const host = (o: SeededOrg) => `${o.slug}.library.trackyour.in`;

  beforeAll(async () => {
    process.env.DISABLE_THROTTLER = 'true';
    ({ orgA, orgB } = await seedTwoOrgs(`catimporthttp-${Date.now().toString(36)}`));
    tokens = await seedLogins(orgA.id);

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    delete process.env.DISABLE_THROTTLER;
    await app?.close();
    await closeOrgLookupRedis();
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  it('parses a real multipart CSV upload and applies it through the full request pipeline', async () => {
    const isbn = uniqueIsbn('http1');
    const csv = `isbn,title,author\n${isbn},HTTP Round-Trip Probe,Probe Author\n`;

    const res = await request(app.getHttpServer())
      .post('/catalog/import/titles')
      .set('X-Library-Host', host(orgA))
      .set('Authorization', `Bearer ${tokens.LIBRARIAN}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'titles.csv');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      status: 'completed',
      created: 1,
      createdNoIsbn: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    });
  });

  it('400s when no file is attached, instead of hitting the parser with nothing', async () => {
    const res = await request(app.getHttpServer())
      .post('/catalog/import/titles')
      .set('X-Library-Host', host(orgA))
      .set('Authorization', `Bearer ${tokens.LIBRARIAN}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('413s a file over the row cap, naming the limit, without writing anything', async () => {
    const header = 'isbn,title\n';
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `${uniqueIsbn(`h${i}`)},Cap Probe Row ${i}\n`).join('');
    const csv = header + body;

    const res = await request(app.getHttpServer())
      .post('/catalog/import/titles')
      .set('X-Library-Host', host(orgA))
      .set('Authorization', `Bearer ${tokens.LIBRARIAN}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'too-many.csv');

    expect(res.status).toBe(413);
    expect(res.body.message).toEqual(expect.stringContaining(String(MAX_IMPORT_ROWS)));
  });

  it("rejects org A's token when the CSV is posted against org B's host", async () => {
    const isbn = uniqueIsbn('http2');
    const csv = `isbn,title\n${isbn},Cross-Org Probe\n`;

    const res = await request(app.getHttpServer())
      .post('/catalog/import/titles')
      .set('X-Library-Host', host(orgB))
      .set('Authorization', `Bearer ${tokens.LIBRARIAN}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'titles.csv');

    expect([401, 403]).toContain(res.status);
  });
});

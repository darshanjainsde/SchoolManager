import { Prisma, type LibraryTx } from '@library/db';
import {
  ImportService,
  MAX_IMPORT_ROWS,
  applyChunk,
  mapImportRow,
  resolvePrepass,
} from './import.service';

describe('mapImportRow', () => {
  it('maps a fully-populated row', () => {
    const result = mapImportRow(
      {
        isbn: '9780140328721',
        title: 'Fantastic Mr Fox',
        subtitle: 'A Fable',
        author: 'Dahl, Roald',
        publisher: 'Puffin',
        publishedyear: '1988',
        edition: '2nd',
        language: 'en',
        callnumber: 'F DAH',
        category: 'Fiction',
      },
      1,
    );

    expect(result).toEqual({
      data: {
        isbn13: '9780140328721',
        isbn10: undefined,
        title: 'Fantastic Mr Fox',
        subtitle: 'A Fable',
        author: 'Dahl, Roald',
        publisher: 'Puffin',
        publishedYear: 1988,
        edition: '2nd',
        language: 'en',
        callNumber: 'F DAH',
        category: 'Fiction',
      },
    });
  });

  it('accepts a 10-digit isbn (with a trailing check-digit X) into isbn10, not isbn13', () => {
    const result = mapImportRow({ isbn: '014032872X', title: 'T' }, 2);
    expect(result).toEqual({ data: expect.objectContaining({ isbn13: undefined, isbn10: '014032872X' }) });
  });

  it('strips hyphens and whitespace from the isbn before validating', () => {
    const result = mapImportRow({ isbn: '978-0-14-032872-1', title: 'T' }, 1);
    expect(result).toEqual({ data: expect.objectContaining({ isbn13: '9780140328721' }) });
  });

  it('ACCEPTS a row with no isbn at all — a blank cell is a deliberate omission, not an error', () => {
    // Policy: a school library holds plenty of items with no ISBN (older
    // stock, local-language titles, donations, pamphlets), so rejecting them
    // would make bulk import useless for exactly the collections that most
    // need it. Such a row is never matched against an existing Title, so it
    // creates every time — surfaced to the caller as `createdNoIsbn` rather
    // than being a silent surprise on re-run.
    expect(mapImportRow({ title: 'No ISBN' }, 7)).toEqual({
      data: expect.objectContaining({ title: 'No ISBN', isbn13: undefined, isbn10: undefined }),
    });
  });

  it('still errors on a PRESENT but malformed isbn — that is a typo, not an omission', () => {
    expect(mapImportRow({ isbn: '12345', title: 'Typo ISBN' }, 8)).toEqual({
      error: { row: 8, field: 'isbn', message: 'isbn must be 10 or 13 characters' },
    });
  });

  it('errors with row + field when isbn is the wrong length', () => {
    expect(mapImportRow({ isbn: '123', title: 'Bad ISBN' }, 3)).toEqual({
      error: { row: 3, field: 'isbn', message: 'isbn must be 10 or 13 characters' },
    });
  });

  it('errors with row + field when title is missing', () => {
    expect(mapImportRow({ isbn: '9780140328721' }, 4)).toEqual({
      error: { row: 4, field: 'title', message: 'title is required' },
    });
  });

  it('errors with row + field when publishedYear is not a valid integer', () => {
    expect(mapImportRow({ isbn: '9780140328721', title: 'T', publishedyear: 'not-a-year' }, 5)).toEqual({
      error: { row: 5, field: 'publishedYear', message: 'publishedYear must be an integer between 0 and 3000' },
    });
  });

  it('errors with row + field when publishedYear is out of range', () => {
    expect(mapImportRow({ isbn: '9780140328721', title: 'T', publishedyear: '4000' }, 6)).toEqual({
      error: { row: 6, field: 'publishedYear', message: 'publishedYear must be an integer between 0 and 3000' },
    });
  });

  it('leaves optional fields undefined rather than empty strings when the CSV cell is blank', () => {
    const result = mapImportRow({ isbn: '9780140328721', title: 'T', subtitle: '' }, 1);
    expect(result).toEqual({ data: expect.objectContaining({ subtitle: undefined }) });
  });
});

describe('ImportService.importTitles — row cap', () => {
  // orgId is deliberately NOT a UUID here, so that if the cap check is ever
  // wrong, the test finds out from the cap check itself rather than from
  // however `withOrg`/Postgres happens to react — `withOrg` synchronously
  // rejects a non-UUID orgId (see `packages/library-db/src/index.ts`)
  // before it ever opens a connection, so both assertions below are
  // provably about `importTitles`'s own cap check, not a side effect of
  // whatever database happens to be reachable from this test run.
  const NOT_A_UUID = 'not-a-real-org-id';

  it('rejects a request over MAX_IMPORT_ROWS with a 413 naming the limit, before touching the database', async () => {
    const service = new ImportService();
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ({ isbn: '9780140328721', title: 'T' }));

    await expect(service.importTitles(NOT_A_UUID, tooMany)).rejects.toMatchObject({
      status: 413,
      message: expect.stringContaining(String(MAX_IMPORT_ROWS)),
    });
  });

  it('does not reject on the cap check for a file of exactly MAX_IMPORT_ROWS', async () => {
    const service = new ImportService();
    const exactly = Array.from({ length: MAX_IMPORT_ROWS }, () => ({ isbn: '9780140328721', title: 'T' }));

    // Falls through the (now-passed) cap check into withOrg, which rejects
    // for the deterministic "not a UUID" reason instead — proving the cap
    // check was not what rejected this call.
    await expect(service.importTitles(NOT_A_UUID, exactly)).rejects.toThrow('withOrg: orgId must be a UUID');
  });
});

// ---------------------------------------------------------------------------
// applyRows — driven directly against a hand-built fake `tx`, no database.
//
// `applyRows` is exported as a standalone function (not a class method,
// exactly like `mapImportRow` above) specifically so these tests can drive
// it against an in-memory stand-in for Category/Author/Title instead of a
// real Postgres connection. It models just enough of Prisma's delegate
// contract (`findMany`/`createMany`/`create`/`update`/`findFirst`, and — for
// the race test — a real `Prisma.PrismaClientKnownRequestError` with code
// 'P2002', the same shape prisma-errors.spec.ts already uses) to prove three
// things the code review called out:
//   1. category/author resolution is BATCHED — one findMany + one createMany
//      per distinct-name-set for the whole file, not one lookup per row.
//   2. a row whose title already exists never triggers category/author
//      resolution at all (the update path doesn't need it).
//   3. a category name collision (Finding 2) and an isbn13 create-create
//      race (Finding 3) both recover instead of aborting the file.
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string;
  orgId: string;
  [key: string]: unknown;
}

/**
 * Composes the two halves `importTitles` runs for a single chunk —
 * `resolvePrepass` then `applyChunk` — so these tests drive the REAL
 * functions while keeping the raw-record call shape they were written
 * against. The production path splits those two steps so the pre-pass runs
 * ONCE for the whole file rather than per chunk; a one-chunk test is the
 * degenerate case where composing them is equivalent.
 *
 * A validation failure here is a broken fixture, not a behaviour under test
 * (`mapImportRow` has its own tests above), so it throws loudly instead of
 * being silently dropped into the skipped count.
 */
async function applyRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  orgId: string,
  records: Record<string, string>[],
) {
  const valid = records.map((record, i) => {
    const mapped = mapImportRow(record, i + 1);
    if ('error' in mapped) {
      throw new Error(`fixture row ${i + 1} is invalid: ${mapped.error.field} — ${mapped.error.message}`);
    }
    return { rowNum: i + 1, data: mapped.data };
  });
  const prepass = await resolvePrepass(tx, orgId, valid, { dryRun: false });
  return applyChunk(tx, orgId, valid, prepass);
}

interface CallCounts {
  findMany: number;
  createMany: number;
}

/** A find-or-create-by-unique-field model (Category/Author), matching the
 *  subset of the Prisma delegate contract `resolveByUniqueName` calls. */
function makeUniqueNameModel(store: Map<string, FakeRow>, uniqueField: string, calls: CallCounts) {
  let seq = 0;
  return {
    findMany: async ({ where }: { where: Record<string, { in: string[] }> }) => {
      calls.findMany++;
      const names = where[uniqueField].in;
      return [...store.values()].filter((r) => names.includes(r[uniqueField] as string));
    },
    createMany: async ({ data, skipDuplicates }: { data: FakeRow[]; skipDuplicates?: boolean }) => {
      calls.createMany++;
      for (const row of data) {
        const alreadyExists = [...store.values()].some((r) => r[uniqueField] === row[uniqueField]);
        if (alreadyExists) {
          if (skipDuplicates) continue;
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        const id = `${uniqueField}-${++seq}`;
        store.set(id, { ...row, id });
      }
    },
  };
}

/** A fake Title model. `createBehavior` lets a test inject a P2002 on the
 *  first create for a given isbn13, to prove the retry-to-update path. */
function makeTitleModel(store: Map<string, FakeRow>, createBehavior?: (data: FakeRow) => 'throw-p2002' | 'ok') {
  let seq = 0;
  return {
    findMany: async ({ where }: { where: { OR: Record<string, { in: string[] }>[] } }) => {
      const isbn13In = where.OR.find((c) => 'isbn13' in c)?.isbn13?.in ?? [];
      const isbn10In = where.OR.find((c) => 'isbn10' in c)?.isbn10?.in ?? [];
      return [...store.values()].filter(
        (t) => (t.isbn13 && isbn13In.includes(t.isbn13 as string)) || (t.isbn10 && isbn10In.includes(t.isbn10 as string)),
      );
    },
    findFirst: async ({ where }: { where: { isbn13?: string; isbn10?: string } }) => {
      const found = [...store.values()].find(
        (t) => (where.isbn13 && t.isbn13 === where.isbn13) || (where.isbn10 && t.isbn10 === where.isbn10),
      );
      return found ? { id: found.id } : null;
    },
    create: async ({ data }: { data: FakeRow }) => {
      if (createBehavior?.(data) === 'throw-p2002') {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`orgId`,`isbn13`)', {
          code: 'P2002',
          clientVersion: '5.22.0',
        });
      }
      const id = `title-${++seq}`;
      store.set(id, { ...data, id });
      return { ...data, id };
    },
    update: async ({ where, data }: { where: { id: string }; data: FakeRow }) => {
      const existing = store.get(where.id);
      if (!existing) throw new Error(`fake title.update: no row ${where.id}`);
      store.set(where.id, { ...existing, ...data });
      return store.get(where.id);
    },
  };
}

function makeFakeTx(opts: { createBehavior?: (data: FakeRow) => 'throw-p2002' | 'ok' } = {}) {
  const categories = new Map<string, FakeRow>();
  const authors = new Map<string, FakeRow>();
  const titles = new Map<string, FakeRow>();
  const categoryCalls: CallCounts = { findMany: 0, createMany: 0 };
  const authorCalls: CallCounts = { findMany: 0, createMany: 0 };

  const tx = {
    category: makeUniqueNameModel(categories, 'name', categoryCalls),
    author: makeUniqueNameModel(authors, 'sortName', authorCalls),
    title: makeTitleModel(titles, opts.createBehavior),
  } as unknown as LibraryTx;

  return { tx, categories, authors, titles, categoryCalls, authorCalls };
}

const ORG_ID = '11111111-1111-4111-8111-111111111111';

describe('applyRows', () => {
  it('creates a title, and resolves its category/author with exactly one lookup+create+re-read each', async () => {
    const { tx, categories, authors, categoryCalls, authorCalls } = makeFakeTx();

    const result = await applyRows(tx, ORG_ID, [
      { isbn: '9780140328721', title: 'Fantastic Mr Fox', author: 'Dahl, Roald', category: 'Fiction' },
    ]);

    expect(result).toEqual({ created: 1, createdNoIsbn: 0, updated: 0 });
    expect(categories.size).toBe(1);
    expect(authors.size).toBe(1);
    expect(categoryCalls).toEqual({ findMany: 2, createMany: 1 }); // initial read + re-read after create
    expect(authorCalls).toEqual({ findMany: 2, createMany: 1 });
  });

  it('batches category/author resolution across many rows into ONE query + ONE createMany each, not one per row', async () => {
    const { tx, categories, authors, categoryCalls, authorCalls } = makeFakeTx();

    const rows = [
      { isbn: '9780140000001', title: 'Row 1', author: 'Author A', category: 'Fiction' },
      { isbn: '9780140000002', title: 'Row 2', author: 'Author A', category: 'Fiction' }, // repeats both
      { isbn: '9780140000003', title: 'Row 3', author: 'Author B', category: 'Non-Fiction' },
    ];

    const result = await applyRows(tx, ORG_ID, rows);

    expect(result).toEqual({ created: 3, createdNoIsbn: 0, updated: 0 });
    expect(categories.size).toBe(2); // Fiction, Non-Fiction — not 3
    expect(authors.size).toBe(2); // Author A, Author B — not 3
    // ONE findMany + ONE createMany call for the whole file's distinct
    // names, regardless of row count (Finding 1: this is the change that
    // takes round trips from O(rows) to O(1) for category/author work).
    expect(categoryCalls).toEqual({ findMany: 2, createMany: 1 });
    expect(authorCalls).toEqual({ findMany: 2, createMany: 1 });
  });

  it('never resolves category/author for a row whose title already exists — the update path does not need them', async () => {
    const { tx, titles, categoryCalls, authorCalls } = makeFakeTx();
    titles.set('existing-1', {
      id: 'existing-1',
      orgId: ORG_ID,
      isbn13: '9780140328721',
      title: 'Old Title',
    });

    const result = await applyRows(tx, ORG_ID, [
      { isbn: '9780140328721', title: 'New Title', author: 'Some Author', category: 'Some Category' },
    ]);

    expect(result).toEqual({ created: 0, createdNoIsbn: 0, updated: 1 });
    expect(titles.get('existing-1')?.title).toBe('New Title'); // scalar update applied
    // Zero category/author round trips at all — Finding 3's "wasted work"
    // for an update row is not just discarded, it is never done.
    expect(categoryCalls).toEqual({ findMany: 0, createMany: 0 });
    expect(authorCalls).toEqual({ findMany: 0, createMany: 0 });
  });

  it(
    'a concurrent import racing on the same isbn13 (P2002 on create) recovers by updating the winner\'s row, ' +
      'instead of aborting the whole file (Finding 3)',
    async () => {
      const racedIsbn = '9780140999999';
      let createAttempts = 0;
      const { tx, titles } = makeFakeTx({
        createBehavior: (data) => {
          if (data.isbn13 === racedIsbn) {
            createAttempts++;
            // Simulate the concurrent transaction's row landing between our
            // Pass-2 read (which found nothing) and our create — exactly
            // the Trap 3 scenario: two transactions both `BEGIN` before
            // either commits, so neither sees the other's row until the
            // unique index enforces it at write time.
            titles.set('winner-1', { id: 'winner-1', orgId: ORG_ID, isbn13: racedIsbn, title: 'Other Import Won' });
            return 'throw-p2002';
          }
          return 'ok';
        },
      });

      const result = await applyRows(tx, ORG_ID, [{ isbn: racedIsbn, title: 'Our Import Lost The Race' }]);

      expect(createAttempts).toBe(1);
      // NOT an error, NOT an abort of the whole (one-row) file: the row is
      // counted as an update against the row that won the race.
      expect(result).toEqual({ created: 0, createdNoIsbn: 0, updated: 1 });
      expect(titles.get('winner-1')?.title).toBe('Our Import Lost The Race'); // our data applied on top
      expect(titles.size).toBe(1); // not two rows for one isbn13
    },
  );

  it('a category-name collision between the read and the create (Finding 2) does not abort the file', async () => {
    const { tx, categories, categoryCalls } = makeFakeTx();

    // Seed the category as if a concurrent, truly-simultaneous import
    // already created it AFTER our findMany read but BEFORE our createMany
    // write — Trap 3 again. `skipDuplicates` must turn this into a no-op,
    // not a thrown P2002 that would abort the transaction/file the way the
    // old bare `create` did.
    const originalCreateMany = tx.category.createMany.bind(tx.category);
    let sawTheRace = false;
    (tx.category as unknown as { createMany: typeof tx.category.createMany }).createMany = (async (args: unknown) => {
      if (!sawTheRace) {
        sawTheRace = true;
        categories.set('raced-in', { id: 'raced-in', orgId: ORG_ID, name: 'Fiction' });
      }
      return originalCreateMany(args as never);
    }) as typeof tx.category.createMany;

    const result = await applyRows(tx, ORG_ID, [
      { isbn: '9780140777777', title: 'Category Race Probe', category: 'Fiction' },
    ]);

    expect(sawTheRace).toBe(true);
    // Under the chunked design a chunk reports failure by THROWING (importTitles
    // catches it, rolls that chunk back and records the row) — so "the P2002 did
    // not abort the file" is proven by this call having resolved at all. Reaching
    // this line is the assertion; the shape below just pins what it resolved to.
    expect(result).toEqual({ created: 1, createdNoIsbn: 0, updated: 0 });
    expect(categories.size).toBe(1); // exactly one "Fiction" row — the racing insert's, not a duplicate
    expect(categoryCalls.createMany).toBe(1);
  });
});

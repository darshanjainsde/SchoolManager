import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { CopiesService } from '../src/modules/catalog/internal/copies.service';
import { SearchService } from '../src/modules/catalog/internal/search.service';
import { TitlesService } from '../src/modules/catalog/internal/titles.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * `Title.replacementPrice` — what a parent is asked to pay for a lost book.
 *
 * Against real Postgres rather than a mocked `tx`, because every property
 * proven here is a property of the DATABASE, not of application code:
 *   - the `Title_replacementPrice_nonnegative` CHECK, which a mock cannot have;
 *   - the one-way seed's race-freedom, which is a `WHERE ... IS NULL` predicate
 *     re-evaluated under READ COMMITTED after a concurrent commit (LIBRARY-TRAPS
 *     #3 — a transaction gives atomicity, not mutual exclusion, so a mock that
 *     echoes back whatever it is told proves nothing here);
 *   - that `PATCH { replacementPrice: null }` really clears the column, which
 *     depends on class-validator, Prisma and Postgres all agreeing;
 *   - the wire shape of a `numeric` column on both read paths.
 */
describeLive('catalogue — replacement price', () => {
  const titles = new TitlesService();
  const copies = new CopiesService();
  const search = new SearchService();

  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`replprice-${Date.now().toString(36)}`));
  });

  afterAll(async () => {
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  describe('setting and clearing', () => {
    it('round-trips a price through create, and reads it back as an exact decimal', async () => {
      const created = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.create(tx, orgA.id, { title: 'Priced On Create', replacementPrice: 299.5 }),
      );

      // Decimal, not float: 299.5 must come back as exactly 299.50, because
      // this number becomes a bill to a parent.
      expect(created!.replacementPrice?.toString()).toBe('299.5');

      const read = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.get(tx, created!.id, 'LIBRARIAN'),
      );
      expect(priceOn(read)).toBe('299.5');
    });

    it('leaves the price alone on a PATCH that does not mention it', async () => {
      const created = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.create(tx, orgA.id, { title: 'Untouched By Patch', replacementPrice: 250 }),
      );

      await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.update(tx, created!.id, { callNumber: '823.914' }),
      );

      const after = await getPrice(created!.id);
      expect(after?.toString()).toBe('250');
    });

    it('clears the price when PATCHed with null — "no price on record" is reachable', async () => {
      // A librarian who typed ₹2999 by mistake must be able to get back to
      // unset, not merely to another guess. This works only because
      // @IsOptional() skips null, Prisma treats null as "set to NULL" (and
      // undefined as "leave alone"), and the column is nullable — three
      // libraries agreeing. If any of them changed, this test is what says so.
      const created = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.create(tx, orgA.id, { title: 'Cleared By Patch', replacementPrice: 2999 }),
      );

      await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.update(tx, created!.id, { replacementPrice: null }),
      );

      expect(await getPrice(created!.id)).toBeNull();
    });

    it('rejects a negative price at the DATABASE, not merely at the DTO', async () => {
      // The DTO's @Min(0) never runs here — this call bypasses the
      // ValidationPipe entirely, which is the point: a future import, admin
      // script or hand-written UPDATE must not be able to credit a parent for
      // losing a book either.
      await expect(
        withOrg(orgA.id, (tx: LibraryTx) =>
          titles.create(tx, orgA.id, { title: 'Negative Probe', replacementPrice: -1 }),
        ),
      ).rejects.toThrow(/Title_replacementPrice_nonnegative|check constraint/i);
    });

    it('accepts zero — a book written off as out of print is settled at ₹0 deliberately', async () => {
      const created = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.create(tx, orgA.id, { title: 'Zero Probe', replacementPrice: 0 }),
      );
      expect(created!.replacementPrice?.toString()).toBe('0');
    });
  });

  describe('the one-way seed from adding copies', () => {
    it('seeds the title price from the first copy that carries an acquisition cost', async () => {
      const title = await createTitle(orgA.id, 'Seed From First Copy');
      expect(await getPrice(title.id)).toBeNull();

      await addCopy(orgA.id, title.id, `SEED-A-${Date.now()}`, 399);

      expect((await getPrice(title.id))?.toString()).toBe('399');
    });

    it('never overwrites a price a librarian has already set', async () => {
      // The seed is one-way. A librarian who priced this at ₹450 because that
      // is the edition in print must not have it silently reset to ₹399 by
      // someone shelving another copy from an old purchase.
      const title = await createTitle(orgA.id, 'Seed Never Overwrites', 450);

      await addCopy(orgA.id, title.id, `SEED-B-${Date.now()}`, 399);

      expect((await getPrice(title.id))?.toString()).toBe('450');
    });

    it('refuses to seed a price the API itself would reject', async () => {
      // The seed made add-copy the widest write path to a parent's bill: every
      // direct path caps at ₹100000, while an unbounded acquisitionCost of
      // 5000000 seeded replacementPrice = 5000000.00 — a value no endpoint
      // accepts and no console field can produce. Bounded in the DTO AND here,
      // because this service method is reachable without the ValidationPipe.
      const title = await createTitle(orgA.id, 'Absurd Cost Probe');

      await addCopy(orgA.id, title.id, `ABSURD-${Date.now()}`, 5_000_000);

      // The copy is still recorded — the price is the part we decline to guess.
      expect(await getPrice(title.id)).toBeNull();
    });

    it('records the copy instead of 500ing when the cost is negative', async () => {
      // `Copy` has no CHECK, so the insert succeeds; an unguarded seed then
      // violated Title_replacementPrice_nonnegative, which Prisma raises
      // WITHOUT a `.code`, so mapPrismaError rethrows it as a 500 — and the
      // rollback took the copy with it, on a request that used to return 201.
      const title = await createTitle(orgA.id, 'Negative Cost Probe');
      const accessionNumber = `NEG-${Date.now()}`;

      await expect(addCopy(orgA.id, title.id, accessionNumber, -1)).resolves.toBeDefined();

      expect(await getPrice(title.id)).toBeNull();
      const copy = await getLibraryPlatformPrisma().copy.findUnique({
        where: { orgId_accessionNumber: { orgId: orgA.id, accessionNumber } },
      });
      expect(copy).not.toBeNull(); // survived, rather than vanishing in a rollback
    });

    it('does not seed 0 when a copy is added with no acquisition cost', async () => {
      // A 0 would read as "this book is free to replace", which is far worse
      // than leaving it unset and asking a human.
      const title = await createTitle(orgA.id, 'Seed Skips Missing Cost');

      await addCopy(orgA.id, title.id, `SEED-C-${Date.now()}`, undefined);

      expect(await getPrice(title.id)).toBeNull();
    });

    it('survives two concurrent copy adds: both copies land, exactly one price wins', async () => {
      // Honest about what this does and does not prove. It proves the seed
      // never turns a legitimate concurrent second copy into a failed request,
      // and never leaves a partially-applied or absent price. It does NOT
      // discriminate between the conditional UPDATE and a naive
      // read-then-write — both leave one of the two costs. The test below is
      // the one that discriminates.
      //
      // Two SIMULTANEOUS connections are required for this to race at all
      // (LIBRARY-TRAPS #13 — a connection_limit=1 URL makes this hang rather
      // than fail).
      const title = await createTitle(orgA.id, 'Seed Race Probe');
      const stamp = Date.now();

      const results = await Promise.allSettled([
        addCopy(orgA.id, title.id, `SEED-RACE-1-${stamp}`, 100),
        addCopy(orgA.id, title.id, `SEED-RACE-2-${stamp}`, 200),
      ]);

      // Both copy inserts must succeed — the seed must never turn a legitimate
      // second copy into a failure.
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);

      // Exactly one of the two costs won, and the value is one of them — not a
      // sum, not null, not a partially-applied write.
      const price = (await getPrice(title.id))?.toString();
      expect(['100', '200']).toContain(price);
    });

    it('READ COMMITTED re-evaluates the seed predicate after a concurrent commit', async () => {
      // Scope, stated honestly: this exercises the POSTGRES SEMANTICS the seed
      // depends on, with the interleaving forced rather than hoped for. It runs
      // the same statement Prisma emits for `updateMany` rather than calling
      // `seedReplacementPrice`, so it does NOT by itself prove the production
      // path still uses that statement — the sequential "never overwrites a
      // price a librarian has already set" test above is what catches the
      // predicate being dropped from the real code.
      //
      // What it does prove, and what nothing else here can: a read-then-write
      // seed would read NULL *before* the librarian's PATCH commits, decide
      // "unset, I may write", and put 399 over the 450 the librarian just
      // chose. The conditional UPDATE cannot, because its predicate is
      // re-evaluated against the committed row once it stops waiting on the row
      // lock. That is a claim about the engine, and LIBRARY-TRAPS #15 forbids
      // asserting an engine's behaviour from memory.
      const title = await createTitle(orgA.id, 'Clobber Probe');
      const prisma = getLibraryPlatformPrisma();

      let librarianHasWritten!: () => void;
      const written = new Promise<void>((resolve) => {
        librarianHasWritten = resolve;
      });
      let librarianMayCommit!: () => void;
      const mayCommit = new Promise<void>((resolve) => {
        librarianMayCommit = resolve;
      });

      const librarian = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`
            UPDATE "Title" SET "replacementPrice" = 450 WHERE id = ${title.id}::uuid`;
          librarianHasWritten();
          await mayCommit;
        },
        { timeout: 20_000, maxWait: 10_000 },
      );

      // Only once the librarian's UPDATE has taken the row lock — so the seed
      // below is guaranteed to meet it, with no sleep and no flake.
      await written;

      // Byte-for-byte the statement `seedReplacementPrice` issues.
      const seeded = prisma.$executeRaw`
        UPDATE "Title" SET "replacementPrice" = 399
        WHERE id = ${title.id}::uuid AND "replacementPrice" IS NULL`;

      librarianMayCommit();
      await librarian;

      expect(await seeded).toBe(0); // zero rows — it saw the committed 450, not a stale NULL
      expect((await getPrice(title.id))?.toString()).toBe('450');
    });
  });

  describe('visibility', () => {
    it('omits the price from a MEMBER search, and keeps it for staff', async () => {
      const title = await createTitle(orgA.id, 'Visibility Probe Zzyzx', 399);

      const [asMember] = await withOrg(orgA.id, (tx: LibraryTx) =>
        search.searchTitles(tx, orgA.id, 'Zzyzx', 'MEMBER'),
      );
      const [asLibrarian] = await withOrg(orgA.id, (tx: LibraryTx) =>
        search.searchTitles(tx, orgA.id, 'Zzyzx', 'LIBRARIAN'),
      );

      expect(asMember.id).toBe(title.id);
      expect(hasPrice(asMember)).toBe(false);
      expect(priceOn(asLibrarian)).toBe('399');
    });

    it('omits the price from a MEMBER read of a single title', async () => {
      const title = await createTitle(orgA.id, 'Single Read Visibility', 399);

      const asMember = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.get(tx, title.id, 'MEMBER'),
      );
      expect(hasPrice(asMember)).toBe(false);
    });

    it("does not hand a MEMBER the copies' acquisitionCost either — the price is one join away", async () => {
      // The leak that stripping the title's own column does NOT close. On any
      // title with no replacementPrice — the default for a school onboarding
      // four thousand books — `Copy.acquisitionCost` is step 3 of the resolver,
      // i.e. the number the loss screen will actually suggest. Shipping it
      // inside `copies[]` would let a child read their likely bill off the
      // catalogue, which is the whole thing the strip exists to prevent.
      const title = await createTitle(orgA.id, 'Copy Cost Leak Probe');
      await addCopy(orgA.id, title.id, `LEAK-${Date.now()}`, 45);

      const asMember = (await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.get(tx, title.id, 'MEMBER'),
      )) as { copies: Array<Record<string, unknown>> };

      expect(asMember.copies).toHaveLength(1);
      expect('acquisitionCost' in asMember.copies[0]).toBe(false);
      // Nor the rest of the staff bookkeeping that rides along with `copies: true`.
      for (const staffOnly of ['acquiredAt', 'condition', 'branchId', 'orgId']) {
        expect(staffOnly in asMember.copies[0]).toBe(false);
      }
      // What a student legitimately needs — is one on the shelf, and where.
      expect(asMember.copies[0]).toMatchObject({ status: 'AVAILABLE' });
      expect('accessionNumber' in asMember.copies[0]).toBe(true);
    });

    it('still gives staff the full copy record, including what the school paid', async () => {
      const title = await createTitle(orgA.id, 'Copy Cost Staff Probe');
      await addCopy(orgA.id, title.id, `STAFF-${Date.now()}`, 45);

      const asLibrarian = (await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.get(tx, title.id, 'LIBRARIAN'),
      )) as { copies: Array<Record<string, unknown>> };

      expect(asLibrarian.copies[0].acquisitionCost?.toString()).toBe('45');
    });

    it('serialises as a decimal STRING over the wire, on both read paths', async () => {
      // The console types this as `Money` (`string | number`) and normalises
      // through `rupees()` precisely because of this. If a future Prisma ever
      // returned a JSON number here, this is what would say so.
      const title = await createTitle(orgA.id, 'Wire Shape Qqxyw', 399);

      const viaClient = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.get(tx, title.id, 'LIBRARIAN'),
      );
      const [viaRaw] = await withOrg(orgA.id, (tx: LibraryTx) =>
        search.searchTitles(tx, orgA.id, 'Qqxyw', 'LIBRARIAN'),
      );

      expect(JSON.parse(JSON.stringify(viaClient)).replacementPrice).toBe('399');
      expect(JSON.parse(JSON.stringify(viaRaw)).replacementPrice).toBe('399');
    });
  });

  describe('tenancy', () => {
    it("a price set in one org is invisible from the other org's search", async () => {
      const title = await createTitle(orgA.id, 'Cross Tenant Wibblewobble', 399);

      const fromB = await withOrg(orgB.id, (tx: LibraryTx) =>
        search.searchTitles(tx, orgB.id, 'Wibblewobble', 'LIBRARIAN'),
      );

      expect(fromB.map((h) => h.id)).not.toContain(title.id);
    });
  });

  // ---- helpers -------------------------------------------------------------

  /**
   * Reads `replacementPrice` off a response whose static type is deliberately a
   * union of "has the field" and "does not" — that union IS the protection, so
   * the tests reach past it through `unknown` rather than weakening it.
   */
  function priceOn(row: unknown): string | undefined {
    return (row as Record<string, { toString(): string } | null>).replacementPrice?.toString();
  }

  function hasPrice(row: unknown): boolean {
    return 'replacementPrice' in (row as Record<string, unknown>);
  }

  /** Reads the raw column through the BYPASSRLS platform client, so an
   *  assertion about what is stored never depends on the same read path the
   *  test is trying to prove. */
  async function getPrice(titleId: string) {
    const row = await getLibraryPlatformPrisma().title.findUnique({
      where: { id: titleId },
      select: { replacementPrice: true },
    });
    return row!.replacementPrice;
  }

  function createTitle(orgId: string, title: string, replacementPrice?: number) {
    return withOrg(orgId, (tx: LibraryTx) =>
      titles.create(tx, orgId, { title, replacementPrice }),
    ) as Promise<{ id: string }>;
  }

  function addCopy(
    orgId: string,
    titleId: string,
    accessionNumber: string,
    acquisitionCost: number | undefined,
  ) {
    const branchId = orgId === orgA.id ? orgA.branchId : orgB.branchId;
    return withOrg(orgId, (tx: LibraryTx) =>
      copies.add(tx, orgId, titleId, { branchId, accessionNumber, acquisitionCost }),
    );
  }
});

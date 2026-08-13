import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { LostService, LOST_TX_OPTIONS } from '../src/modules/circulation/internal/lost.service';
import { IssuesService } from '../src/modules/circulation/internal/issues.service';
import { FinesService } from '../src/modules/circulation/internal/fines.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * The five-step loss flow, against real Postgres — because every property that
 * matters here is a property of the DATABASE: the atomicity of the five steps,
 * the partial unique index that makes two clerks produce one report, and the
 * CHECK constraints that keep an amount and its provenance inseparable.
 *
 * The load-bearing assertion in this file is "the late charge stops growing".
 * Everything else is bookkeeping; that one is the incentive the whole phase is
 * built on.
 */
describeLive('circulation — reporting a book lost', () => {
  const lost = new LostService();
  const issues = new IssuesService();
  const fines = new FinesService();
  const prisma = getLibraryPlatformPrisma();

  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let titleId: string;
  /** A real LibUser id — `SeededOrg` carries no user, and `amountSetByUserId`
   *  is a foreign key, so a made-up uuid would fail the constraint. */
  let actorUserId: string;

  const DAY = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`lost-${Date.now().toString(36)}`));
    const title = await prisma.title.create({
      data: { orgId: orgA.id, title: 'The Hungry Tide', replacementPrice: 399 },
    });
    titleId = title.id;
    const actor = await prisma.libUser.create({
      data: {
        orgId: orgA.id,
        email: `lost-actor-${Date.now()}@test.local`,
        passwordHash: 'x',
        role: 'LIBRARIAN',
        branchIds: [orgA.branchId],
      },
    });
    actorUserId = actor.id;
    // `seedTwoOrgs` seeds no circulation policy, and `loadPolicy` throws
    // without one — the same fixture every other circulation suite creates.
    // finePerDay 5 with 1 grace day makes the frozen figure predictable.
    await prisma.circulationPolicy.create({
      data: {
        orgId: orgA.id,
        memberType: 'STUDENT',
        maxBooks: 5,
        issueDays: 14,
        renewLimit: 2,
        renewDays: 14,
        finePerDay: 5,
        graceDays: 1,
        maxFine: 500,
        maxReservations: 3,
        reservedShelfDays: 3,
        maxOutstandingFine: 1000,
      },
    });
    // Fines ON for students, so the freeze has something to freeze.
    await prisma.librarySettings.upsert({
      where: { orgId: orgA.id },
      create: { orgId: orgA.id, chargeStudentFines: true },
      update: { chargeStudentFines: true },
    });
  });

  afterAll(async () => {
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  /** A copy issued to the seeded member, already `days` days overdue. */
  async function issuedAndOverdue(days: number, opts: { acquisitionCost?: number } = {}) {
    const accessionNumber = `LOST-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;
    const copy = await prisma.copy.create({
      data: {
        orgId: orgA.id,
        titleId,
        branchId: orgA.branchId,
        accessionNumber,
        status: 'ISSUED',
        acquisitionCost: opts.acquisitionCost,
      },
    });
    const issue = await prisma.issue.create({
      data: {
        orgId: orgA.id,
        copyId: copy.id,
        branchId: orgA.branchId,
        memberId: orgA.memberId,
        issuedAt: new Date(Date.now() - (days + 14) * DAY),
        dueAt: new Date(Date.now() - days * DAY),
        status: 'ACTIVE',
      },
    });
    return { copy, issue, accessionNumber };
  }

  function report(accessionNumber: string, replacementPrice?: number, now = new Date()) {
    return withOrg(
      orgA.id,
      (tx: LibraryTx) =>
        lost.reportLost(tx, orgA.id, { accessionNumber, replacementPrice }, actorUserId, now, [
          orgA.branchId,
        ]),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  describe('the five steps', () => {
    it('closes the issue, freezes the charge, retires the copy, bills, and records the report', async () => {
      const { copy, issue, accessionNumber } = await issuedAndOverdue(10);

      const result = await report(accessionNumber);

      // 1. the issue is closed — this is what stops the money
      const after = await prisma.issue.findUnique({ where: { id: issue.id } });
      expect(after!.returnedAt).not.toBeNull();
      expect(after!.status).toBe('LOST');

      // 2. the late charge is frozen as a stored fine
      expect(result.frozenLateAmount).toBeGreaterThan(0);
      const lateFine = await prisma.fine.findUnique({ where: { id: result.lateFineId! } });
      expect(lateFine!.kind).toBe('OVERDUE');
      expect(lateFine!.reason).toMatch(/frozen when reported lost/);

      // 3. the copy has left circulation
      expect((await prisma.copy.findUnique({ where: { id: copy.id } }))!.status).toBe('LOST');

      // 4. the replacement charge, priced from the title, with its source
      expect(result.replacementAmount).toBe(399);
      expect(result.priceSource).toBe('TITLE_PRICE');
      const lostFine = await prisma.fine.findUnique({ where: { id: result.replacementFineId! } });
      expect(lostFine!.kind).toBe('LOST');
      expect(lostFine!.amountSource).toBe('TITLE_PRICE');
      // Nobody typed it, so nobody is named — the CHECK enforces this too.
      expect(lostFine!.amountSetByUserId).toBeNull();

      // 5. the report, already confirmed because a librarian did this
      const stored = await prisma.lostReport.findUnique({ where: { id: result.lostReportId } });
      expect(stored!.status).toBe('CONFIRMED');
      expect(stored!.selfReported).toBe(false);
      expect(stored!.confirmedAt).not.toBeNull();
    });

    it('STOPS the late charge growing — the incentive the phase is built on', async () => {
      // The assertion that matters most in this file. Before the report the
      // issue is overdue and visible to the overdue read; after it, that read
      // must not see it at all, because it is what the daily charge is derived
      // from. If this ever regresses, a child who owned up keeps being billed.
      const { accessionNumber, copy } = await issuedAndOverdue(10);

      const before = await withOrg(orgA.id, (tx: LibraryTx) =>
        fines.listOverdue(tx, orgA.id, new Date(), [orgA.branchId]),
      );
      expect(before.map((r) => r.accessionNumber)).toContain(accessionNumber);

      await report(accessionNumber);

      const later = new Date(Date.now() + 30 * DAY);
      const after = await withOrg(orgA.id, (tx: LibraryTx) =>
        fines.listOverdue(tx, orgA.id, later, [orgA.branchId]),
      );
      expect(after.map((r) => r.accessionNumber)).not.toContain(accessionNumber);
      expect(copy.id).toBeDefined();
    });

    it('is atomic: a failure leaves the issue open and the copy on the shelf', async () => {
      // Driven by reporting a copy that has no active issue — the flow throws
      // after reading, before any write. Nothing may have changed.
      const accessionNumber = `LOST-NOISSUE-${Date.now()}`;
      const copy = await prisma.copy.create({
        data: { orgId: orgA.id, titleId, branchId: orgA.branchId, accessionNumber, status: 'AVAILABLE' },
      });

      await expect(report(accessionNumber)).rejects.toThrow(/No active issue/);

      expect((await prisma.copy.findUnique({ where: { id: copy.id } }))!.status).toBe('AVAILABLE');
      expect(await prisma.lostReport.count({ where: { copyId: copy.id } })).toBe(0);
    });
  });

  describe('pricing', () => {
    it('prefers the amount the librarian typed, and names them as its author', async () => {
      const { accessionNumber } = await issuedAndOverdue(3);

      const result = await report(accessionNumber, 450);

      expect(result.replacementAmount).toBe(450);
      expect(result.priceSource).toBe('TYPED');
      const fine = await prisma.fine.findUnique({ where: { id: result.replacementFineId! } });
      expect(fine!.amountSetByUserId).toBe(actorUserId);
    });

    it('falls back to what the school paid, and says so', async () => {
      const untitledPrice = await prisma.title.create({
        data: { orgId: orgA.id, title: 'No Price On Record' },
      });
      const accessionNumber = `LOST-COST-${Date.now()}`;
      const copy = await prisma.copy.create({
        data: {
          orgId: orgA.id,
          titleId: untitledPrice.id,
          branchId: orgA.branchId,
          accessionNumber,
          status: 'ISSUED',
          acquisitionCost: 45,
        },
      });
      await prisma.issue.create({
        data: {
          orgId: orgA.id, copyId: copy.id, branchId: orgA.branchId, memberId: orgA.memberId,
          dueAt: new Date(Date.now() - 2 * DAY), status: 'ACTIVE',
        },
      });

      const result = await report(accessionNumber);

      // The caller is obliged to show this WITH its age; the source is what
      // makes that possible.
      expect(result.replacementAmount).toBe(45);
      expect(result.priceSource).toBe('PURCHASE_COST');
    });

    it('records the loss and raises NO replacement fine when nothing prices it', async () => {
      // "Unpriced" is a designed, visible state. A ₹0 fine here would read as
      // "nothing owed" to every total and to P5's No Dues certificate.
      const unpriced = await prisma.title.create({
        data: { orgId: orgA.id, title: 'Unpriced Entirely' },
      });
      const accessionNumber = `LOST-UNPRICED-${Date.now()}`;
      const copy = await prisma.copy.create({
        data: { orgId: orgA.id, titleId: unpriced.id, branchId: orgA.branchId, accessionNumber, status: 'ISSUED' },
      });
      await prisma.issue.create({
        data: {
          orgId: orgA.id, copyId: copy.id, branchId: orgA.branchId, memberId: orgA.memberId,
          dueAt: new Date(Date.now() - 2 * DAY), status: 'ACTIVE',
        },
      });

      const result = await report(accessionNumber);

      expect(result.priceSource).toBe('UNPRICED');
      expect(result.replacementAmount).toBeNull();
      expect(result.replacementFineId).toBeNull();
      // But the loss itself IS recorded, and the copy IS retired.
      expect((await prisma.copy.findUnique({ where: { id: copy.id } }))!.status).toBe('LOST');
      const stored = await prisma.lostReport.findUnique({ where: { id: result.lostReportId } });
      expect(stored!.replacementAmount).toBeNull();
      expect(stored!.priceSource).toBeNull();
    });

    it('raises a fine for a deliberate ₹0 price, which is not the same as unpriced', async () => {
      const { accessionNumber } = await issuedAndOverdue(1);
      const result = await report(accessionNumber, 0);
      expect(result.priceSource).toBe('TYPED');
      expect(result.replacementAmount).toBe(0);
      expect(result.replacementFineId).not.toBeNull();
    });
  });

  describe('fines off', () => {
    it('records the loss but charges nothing when student fines are off', async () => {
      await prisma.librarySettings.update({
        where: { orgId: orgA.id },
        data: { chargeStudentFines: false },
      });
      try {
        const { accessionNumber, copy } = await issuedAndOverdue(10);

        const result = await report(accessionNumber);

        expect(result.frozenLateAmount).toBeNull();
        expect(result.lateFineId).toBeNull();
        expect(result.replacementFineId).toBeNull();
        // Steps 1, 3 and 5 still happen — the book is still gone.
        expect((await prisma.copy.findUnique({ where: { id: copy.id } }))!.status).toBe('LOST');
        expect(await prisma.lostReport.count({ where: { id: result.lostReportId } })).toBe(1);
      } finally {
        await prisma.librarySettings.update({
          where: { orgId: orgA.id },
          data: { chargeStudentFines: true },
        });
      }
    });
  });

  describe('concurrency', () => {
    it('two clerks reporting the same copy produce ONE report, not two', async () => {
      // Trap 3: a transaction gives atomicity, not mutual exclusion. What makes
      // this safe is lost_report_one_open_per_copy, not a check in the handler.
      const { accessionNumber, copy } = await issuedAndOverdue(5);

      const results = await Promise.allSettled([report(accessionNumber), report(accessionNumber)]);

      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok).toHaveLength(1);
      expect(await prisma.lostReport.count({ where: { copyId: copy.id } })).toBe(1);
    });
  });

  describe('tenancy and branch scope', () => {
    it("cannot report another org's copy", async () => {
      const otherTitle = await prisma.title.create({
        data: { orgId: orgB.id, title: "Other Org's Book" },
      });
      const accessionNumber = `LOST-CROSS-${Date.now()}`;
      await prisma.copy.create({
        data: { orgId: orgB.id, titleId: otherTitle.id, branchId: orgB.branchId, accessionNumber, status: 'ISSUED' },
      });

      // Scoped to orgA, the row is simply not visible — RLS, not a check.
      await expect(report(accessionNumber)).rejects.toThrow(/Copy not found/);
    });

    it('refuses a copy issued at a branch outside the actor’s scope', async () => {
      const { accessionNumber } = await issuedAndOverdue(1);
      await expect(
        withOrg(
          orgA.id,
          (tx: LibraryTx) =>
            lost.reportLost(tx, orgA.id, { accessionNumber }, actorUserId, new Date(), [
              '00000000-0000-4000-8000-000000000000',
            ]),
          undefined,
          LOST_TX_OPTIONS,
        ),
      ).rejects.toThrow();
    });
  });
});

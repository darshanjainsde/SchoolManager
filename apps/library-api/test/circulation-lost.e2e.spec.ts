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

/**
 * Self-report -> confirm -> reject.
 *
 * The assertion this file exists for is the NEGATIVE one: between a child
 * tapping "I lost it" and a librarian confirming, no Fine row exists and no
 * total moves. That is what keeps a nine-year-old from creating a bill to their
 * parent with no adult in the loop, and it is why FineStatus has no PENDING.
 */
describeLive('circulation — a child reports their own book lost', () => {
  const lost = new LostService();
  const fines = new FinesService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let titleId: string;
  let librarianId: string;
  /** A LibUser with role MEMBER, linked to the seeded member — this is what a
   *  child's login actually is. */
  let childUserId: string;
  let childMemberId: string;
  let classmateUserId: string;

  const DAY = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`selflost-${Date.now().toString(36)}`));
    titleId = (
      await prisma.title.create({
        data: { orgId: org.id, title: 'Panchatantra', replacementPrice: 195 },
      })
    ).id;
    librarianId = (
      await prisma.libUser.create({
        data: {
          orgId: org.id, email: `sl-lib-${Date.now()}@t.local`, passwordHash: 'x',
          role: 'LIBRARIAN', branchIds: [org.branchId],
        },
      })
    ).id;
    childMemberId = org.memberId;
    childUserId = (
      await prisma.libUser.create({
        data: {
          orgId: org.id, email: `sl-child-${Date.now()}@t.local`, passwordHash: 'x',
          role: 'MEMBER', branchIds: [org.branchId], memberId: childMemberId,
        },
      })
    ).id;
    const classmate = await prisma.member.create({
      data: { orgId: org.id, code: `CM-${Date.now()}`, firstName: 'Class', lastName: 'Mate' },
    });
    classmateUserId = (
      await prisma.libUser.create({
        data: {
          orgId: org.id, email: `sl-mate-${Date.now()}@t.local`, passwordHash: 'x',
          role: 'MEMBER', branchIds: [org.branchId], memberId: classmate.id,
        },
      })
    ).id;
    await prisma.circulationPolicy.create({
      data: {
        orgId: org.id, memberType: 'STUDENT', maxBooks: 5, issueDays: 14, renewLimit: 2,
        renewDays: 14, finePerDay: 5, graceDays: 1, maxFine: 500, maxReservations: 3,
        reservedShelfDays: 3, maxOutstandingFine: 1000,
      },
    });
    await prisma.librarySettings.upsert({
      where: { orgId: org.id },
      create: { orgId: org.id, chargeStudentFines: true },
      update: { chargeStudentFines: true },
    });
  });

  afterAll(async () => {
    await cleanupOrgs([org.id, other.id]);
  });

  async function issuedToChild(days: number) {
    const accessionNumber = `SL-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;
    const copy = await prisma.copy.create({
      data: { orgId: org.id, titleId, branchId: org.branchId, accessionNumber, status: 'ISSUED' },
    });
    const issue = await prisma.issue.create({
      data: {
        orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId: childMemberId,
        issuedAt: new Date(Date.now() - (days + 14) * DAY),
        dueAt: new Date(Date.now() - days * DAY), status: 'ACTIVE',
      },
    });
    return { copy, issue, accessionNumber };
  }

  const selfReport = (accessionNumber: string, asUserId = childUserId) =>
    withOrg(
      org.id,
      (tx: LibraryTx) => lost.selfReportLost(tx, org.id, accessionNumber, asUserId, new Date()),
      undefined,
      LOST_TX_OPTIONS,
    );

  it('freezes the charge and retires the copy, but creates NO fine', async () => {
    const { copy, issue, accessionNumber } = await issuedToChild(6);
    const owedBefore = await prisma.fine.count({ where: { memberId: childMemberId } });

    const result = await selfReport(accessionNumber);

    // The incentive works from the tap: the clock has stopped.
    expect((await prisma.issue.findUnique({ where: { id: issue.id } }))!.returnedAt).not.toBeNull();
    expect((await prisma.copy.findUnique({ where: { id: copy.id } }))!.status).toBe('LOST');
    expect(result.frozenLateAmount).toBeGreaterThan(0);

    // But no money exists yet — the whole point of the confirm step.
    expect(await prisma.fine.count({ where: { memberId: childMemberId } })).toBe(owedBefore);
    const report = await prisma.lostReport.findUnique({ where: { id: result.lostReportId } });
    expect(report!.status).toBe('REPORTED');
    expect(report!.selfReported).toBe(true);
    expect(report!.confirmedAt).toBeNull();
    // And nothing is priced yet — that is the librarian's call, with the book
    // in front of them.
    expect(report!.replacementAmount).toBeNull();
  });

  it("refuses to report a classmate's book", async () => {
    const { accessionNumber } = await issuedToChild(2);
    // Same 404 as an unknown copy, deliberately — this route must not be usable
    // to discover what other children are holding.
    await expect(selfReport(accessionNumber, classmateUserId)).rejects.toThrow(
      /No active issue for this copy/,
    );
  });

  it('confirm creates both fines FROM THE FROZEN FIGURES, not recomputed', async () => {
    const { accessionNumber } = await issuedToChild(6);
    const reported = await selfReport(accessionNumber);
    const frozen = reported.frozenLateAmount!;

    // Days pass before the librarian gets to it. The charge must not move.
    const muchLater = new Date(Date.now() + 30 * DAY);
    const confirmed = await withOrg(
      org.id,
      (tx: LibraryTx) =>
        lost.confirmLost(tx, org.id, reported.lostReportId, undefined, librarianId, muchLater, [
          org.branchId,
        ]),
      undefined,
      LOST_TX_OPTIONS,
    );

    expect(confirmed.frozenLateAmount).toBe(frozen);
    const lateFine = await prisma.fine.findUnique({ where: { id: confirmed.lateFineId! } });
    expect(Number(lateFine!.amount)).toBe(frozen);
    // Priced from the title at confirm time, with its source recorded.
    expect(confirmed.replacementAmount).toBe(195);
    expect(confirmed.priceSource).toBe('TITLE_PRICE');
  });

  it('confirm accepts a typed price and names who typed it', async () => {
    const { accessionNumber } = await issuedToChild(1);
    const reported = await selfReport(accessionNumber);

    const confirmed = await withOrg(
      org.id,
      (tx: LibraryTx) =>
        lost.confirmLost(tx, org.id, reported.lostReportId, 260, librarianId, new Date(), [org.branchId]),
      undefined,
      LOST_TX_OPTIONS,
    );

    expect(confirmed.replacementAmount).toBe(260);
    expect(confirmed.priceSource).toBe('TYPED');
    const fine = await prisma.fine.findUnique({ where: { id: confirmed.replacementFineId! } });
    expect(fine!.amountSetByUserId).toBe(librarianId);
  });

  it('confirming twice is refused', async () => {
    const { accessionNumber } = await issuedToChild(1);
    const reported = await selfReport(accessionNumber);
    const confirm = () =>
      withOrg(
        org.id,
        (tx: LibraryTx) =>
          lost.confirmLost(tx, org.id, reported.lostReportId, undefined, librarianId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );
    await confirm();
    await expect(confirm()).rejects.toThrow(/not awaiting confirmation/);
  });

  describe('reject — the book turned up that afternoon', () => {
    it('restores the issue and the copy exactly, with no money anywhere', async () => {
      const { copy, issue, accessionNumber } = await issuedToChild(4);
      const reported = await selfReport(accessionNumber);

      await withOrg(
        org.id,
        (tx: LibraryTx) =>
          lost.rejectLost(tx, org.id, reported.lostReportId, 'Found on the returns trolley', librarianId, new Date(), [
            org.branchId,
          ]),
        undefined,
        LOST_TX_OPTIONS,
      );

      const restored = await prisma.issue.findUnique({ where: { id: issue.id } });
      expect(restored!.returnedAt).toBeNull();
      expect(restored!.status).toBe('ACTIVE');
      expect(restored!.returnedByUserId).toBeNull();
      expect((await prisma.copy.findUnique({ where: { id: copy.id } }))!.status).toBe('ISSUED');
      expect(await prisma.fine.count({ where: { issueId: issue.id } })).toBe(0);

      // The report survives as history — never deleted.
      const report = await prisma.lostReport.findUnique({ where: { id: reported.lostReportId } });
      expect(report!.status).toBe('REJECTED');
      expect(report!.rejectedReason).toMatch(/returns trolley/);
    });

    it('the late clock resumes across the gap — a false report buys no free days', async () => {
      const { accessionNumber, issue } = await issuedToChild(10);
      const reported = await selfReport(accessionNumber);
      await withOrg(
        org.id,
        (tx: LibraryTx) =>
          lost.rejectLost(tx, org.id, reported.lostReportId, 'Turned up', librarianId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      // Back on the overdue list, counted from the ORIGINAL dueAt.
      const overdue = await withOrg(org.id, (tx: LibraryTx) =>
        fines.listOverdue(tx, org.id, new Date(), [org.branchId]),
      );
      const row = overdue.find((r) => r.accessionNumber === accessionNumber);
      expect(row).toBeDefined();
      expect(row!.daysOverdue).toBeGreaterThanOrEqual(10);
      expect(issue.id).toBeDefined();
    });

    it('a confirmed report can no longer be rejected', async () => {
      const { accessionNumber } = await issuedToChild(1);
      const reported = await selfReport(accessionNumber);
      await withOrg(
        org.id,
        (tx: LibraryTx) =>
          lost.confirmLost(tx, org.id, reported.lostReportId, undefined, librarianId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      await expect(
        withOrg(
          org.id,
          (tx: LibraryTx) =>
            lost.rejectLost(tx, org.id, reported.lostReportId, 'too late', librarianId, new Date(), [org.branchId]),
          undefined,
          LOST_TX_OPTIONS,
        ),
      ).rejects.toThrow(/only a report awaiting confirmation/);
    });
  });
});

/**
 * Settlement A — the family paid, or the book was written off.
 *
 * Both close the report AND every open fine on it together, which is the
 * property worth pinning: a settled loss that leaves an OPEN fine behind would
 * keep a parent on the dues list forever, and a closed fine under an unsettled
 * report would make the lost-books panel disagree with the money.
 */
describeLive('circulation — settling a lost book', () => {
  const lost = new LostService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let titleId: string;
  let staffId: string;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`settle-${Date.now().toString(36)}`));
    titleId = (
      await prisma.title.create({ data: { orgId: org.id, title: 'Malgudi Days', replacementPrice: 299 } })
    ).id;
    staffId = (
      await prisma.libUser.create({
        data: {
          orgId: org.id, email: `settle-${Date.now()}@t.local`, passwordHash: 'x',
          role: 'LIBRARIAN', branchIds: [org.branchId],
        },
      })
    ).id;
    await prisma.circulationPolicy.create({
      data: {
        orgId: org.id, memberType: 'STUDENT', maxBooks: 5, issueDays: 14, renewLimit: 2,
        renewDays: 14, finePerDay: 5, graceDays: 1, maxFine: 500, maxReservations: 3,
        reservedShelfDays: 3, maxOutstandingFine: 1000,
      },
    });
    await prisma.librarySettings.upsert({
      where: { orgId: org.id },
      create: { orgId: org.id, chargeStudentFines: true },
      update: { chargeStudentFines: true },
    });
  });

  afterAll(async () => {
    await cleanupOrgs([org.id, other.id]);
  });

  /** A confirmed loss with both fines raised: 4 days late + a 299 book. */
  async function confirmedLoss() {
    const DAY = 24 * 60 * 60 * 1000;
    const accessionNumber = `SET-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;
    const copy = await prisma.copy.create({
      data: { orgId: org.id, titleId, branchId: org.branchId, accessionNumber, status: 'ISSUED' },
    });
    await prisma.issue.create({
      data: {
        orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId: org.memberId,
        dueAt: new Date(Date.now() - 4 * DAY), status: 'ACTIVE',
      },
    });
    return withOrg(
      org.id,
      (tx: LibraryTx) =>
        lost.reportLost(tx, org.id, { accessionNumber }, staffId, new Date(), [org.branchId]),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  describe('pay', () => {
    it('closes the report and EVERY open fine on it, recording how it was paid', async () => {
      const loss = await confirmedLoss();

      const paid = await withOrg(
        org.id,
        (tx: LibraryTx) => lost.payLost(tx, org.id, loss.lostReportId, 'CASH', 'slip 42', staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      // Both fines, not just the book — a leftover OPEN row keeps a parent on
      // the dues list forever.
      expect(paid.paidFineIds).toHaveLength(2);
      expect(paid.totalPaid).toBe(299 + 15); // 299 book + 3 billable days at 5 (1 grace)
      for (const id of paid.paidFineIds) {
        const fine = await prisma.fine.findUnique({ where: { id } });
        expect(fine!.status).toBe('PAID');
        expect(Number(fine!.paidAmount)).toBe(Number(fine!.amount));
        expect(fine!.paidMethod).toBe('CASH');
        expect(fine!.paymentNote).toBe('slip 42');
        expect(fine!.paidByUserId).toBe(staffId);
      }
      const report = await prisma.lostReport.findUnique({ where: { id: loss.lostReportId } });
      expect(report!.status).toBe('SETTLED_PAID');
      expect(report!.settledByUserId).toBe(staffId);
    });

    it('refuses to settle the same loss twice', async () => {
      const loss = await confirmedLoss();
      const pay = () =>
        withOrg(
          org.id,
          (tx: LibraryTx) => lost.payLost(tx, org.id, loss.lostReportId, 'UPI', undefined, staffId, new Date(), [org.branchId]),
          undefined,
          LOST_TX_OPTIONS,
        );
      await pay();
      await expect(pay()).rejects.toThrow(/only a confirmed loss can be settled/);
    });

    it('leaves the copy retired — paying for a book does not put it back on the shelf', async () => {
      const loss = await confirmedLoss();
      const report = await prisma.lostReport.findUnique({ where: { id: loss.lostReportId } });
      await withOrg(
        org.id,
        (tx: LibraryTx) => lost.payLost(tx, org.id, loss.lostReportId, 'CASH', undefined, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );
      expect((await prisma.copy.findUnique({ where: { id: report!.copyId } }))!.status).toBe('LOST');
    });
  });

  describe('write-off', () => {
    it('forgives every open fine with the mechanical reason code, and records the approver', async () => {
      const loss = await confirmedLoss();

      const written = await withOrg(
        org.id,
        (tx: LibraryTx) =>
          lost.writeOffLost(
            tx, org.id, loss.lostReportId,
            'Principal Mrs Rao, note dated 12 Aug', 'Out of print since 1998',
            staffId, new Date(), [org.branchId],
          ),
        undefined,
        LOST_TX_OPTIONS,
      );

      expect(written.waivedFineIds).toHaveLength(2);
      for (const id of written.waivedFineIds) {
        const fine = await prisma.fine.findUnique({ where: { id } });
        expect(fine!.status).toBe('WAIVED');
        // The CODE is what the collections dashboard aggregates on; the free
        // text alone could not answer "where did each rupee go".
        expect(fine!.waiverReasonCode).toBe('WRITTEN_OFF_UNREPLACEABLE');
        expect(fine!.waivedReason).toMatch(/Out of print/);
        expect(fine!.waivedByUserId).toBe(staffId);
      }
      const report = await prisma.lostReport.findUnique({ where: { id: loss.lostReportId } });
      expect(report!.status).toBe('WRITTEN_OFF');
      // The human who actually said yes, in words — there is no principal role
      // to gate on.
      expect(report!.approvedByNote).toMatch(/Principal Mrs Rao/);
    });

    it('cannot write off a loss that was already paid', async () => {
      const loss = await confirmedLoss();
      await withOrg(
        org.id,
        (tx: LibraryTx) => lost.payLost(tx, org.id, loss.lostReportId, 'CASH', undefined, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );
      await expect(
        withOrg(
          org.id,
          (tx: LibraryTx) =>
            lost.writeOffLost(tx, org.id, loss.lostReportId, 'x', 'y', staffId, new Date(), [org.branchId]),
          undefined,
          LOST_TX_OPTIONS,
        ),
      ).rejects.toThrow(/only a confirmed loss can be settled/);
    });
  });
});

/**
 * Settlement B — a replacement copy, the original turning up, and a book that
 * simply is not on the shelf.
 *
 * The two assertions worth the file: a REPLACEMENT gets a new number and a null
 * acquisitionCost, while a FOUND book keeps its old one — and a stock-take loss
 * can never be attached to a child.
 */
describeLive('circulation — replacement, found, and missing at stock take', () => {
  const lost = new LostService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let titleId: string;
  let staffId: string;
  const DAY = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`settleb-${Date.now().toString(36)}`));
    titleId = (
      await prisma.title.create({
        data: { orgId: org.id, title: 'Swami and Friends', replacementPrice: 275, publisher: 'Indian Thought' },
      })
    ).id;
    staffId = (
      await prisma.libUser.create({
        data: {
          orgId: org.id, email: `sb-${Date.now()}@t.local`, passwordHash: 'x',
          role: 'LIBRARIAN', branchIds: [org.branchId],
        },
      })
    ).id;
    await prisma.circulationPolicy.create({
      data: {
        orgId: org.id, memberType: 'STUDENT', maxBooks: 5, issueDays: 14, renewLimit: 2,
        renewDays: 14, finePerDay: 5, graceDays: 1, maxFine: 500, maxReservations: 3,
        reservedShelfDays: 3, maxOutstandingFine: 1000,
      },
    });
    await prisma.librarySettings.upsert({
      where: { orgId: org.id },
      create: { orgId: org.id, chargeStudentFines: true },
      update: { chargeStudentFines: true },
    });
  });

  afterAll(async () => {
    await cleanupOrgs([org.id, other.id]);
  });

  async function confirmedLoss() {
    const accessionNumber = `SB-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;
    const copy = await prisma.copy.create({
      data: {
        orgId: org.id, titleId, branchId: org.branchId, accessionNumber,
        status: 'ISSUED', shelf: 'A-3',
      },
    });
    await prisma.issue.create({
      data: {
        orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId: org.memberId,
        dueAt: new Date(Date.now() - 4 * DAY), status: 'ACTIVE',
      },
    });
    const loss = await withOrg(
      org.id,
      (tx: LibraryTx) => lost.reportLost(tx, org.id, { accessionNumber }, staffId, new Date(), [org.branchId]),
      undefined,
      LOST_TX_OPTIONS,
    );
    return { ...loss, copy, accessionNumber };
  }

  describe('replacement in kind', () => {
    it('clones the book onto a NEW number, with no acquisition cost', async () => {
      const loss = await confirmedLoss();
      const newNumber = `SB-NEW-${Date.now()}`;

      const result = await withOrg(
        org.id,
        (tx: LibraryTx) =>
          lost.replaceInKind(tx, org.id, loss.lostReportId, newNumber, undefined, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      const created = await prisma.copy.findUnique({ where: { id: result.newCopyId } });
      expect(created!.accessionNumber).toBe(newNumber);
      expect(created!.titleId).toBe(titleId); // cloned — publisher, price etc. come with it
      expect(created!.shelf).toBe('A-3');
      expect(created!.status).toBe('AVAILABLE');
      // GOOD, not NEW: a parent's replacement is usually second-hand.
      expect(created!.condition).toBe('GOOD');
      // The school paid nothing. A figure here would fake the register's
      // "Price paid" column AND plant a false PURCHASE_COST for the resolver.
      expect(created!.acquisitionCost).toBeNull();

      // The old copy keeps its number and stays retired, so the register shows
      // both: one lost, one added.
      const old = await prisma.copy.findUnique({ where: { id: loss.copy.id } });
      expect(old!.status).toBe('LOST');
      expect(old!.accessionNumber).toBe(loss.accessionNumber);
    });

    it('clears the BOOK charge in kind but leaves the late charge standing', async () => {
      const loss = await confirmedLoss();
      const result = await withOrg(
        org.id,
        (tx: LibraryTx) =>
          lost.replaceInKind(tx, org.id, loss.lostReportId, `SB-NEW2-${Date.now()}`, undefined, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      expect(result.clearedFineIds).toEqual([loss.replacementFineId]);
      const book = await prisma.fine.findUnique({ where: { id: loss.replacementFineId! } });
      expect(book!.status).toBe('WAIVED');
      // MECHANICAL — the school lost nothing, so collections must exclude it
      // from "let off".
      expect(book!.waiverReasonCode).toBe('REPLACED_IN_KIND');

      // They were still late.
      const late = await prisma.fine.findUnique({ where: { id: loss.lateFineId! } });
      expect(late!.status).toBe('OPEN');
    });

    it('refuses a number already in the register — including the lost book’s own', async () => {
      const loss = await confirmedLoss();
      await expect(
        withOrg(
          org.id,
          (tx: LibraryTx) =>
            lost.replaceInKind(tx, org.id, loss.lostReportId, loss.accessionNumber, undefined, staffId, new Date(), [org.branchId]),
          undefined,
          LOST_TX_OPTIONS,
        ),
      ).rejects.toThrow(/already in the register/);
    });
  });

  describe('found', () => {
    it('puts the book back on the shelf AT ITS OLD NUMBER', async () => {
      const loss = await confirmedLoss();

      const result = await withOrg(
        org.id,
        (tx: LibraryTx) => lost.foundLost(tx, org.id, loss.lostReportId, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      // The same physical object, with that number already in ink inside its
      // cover. "A retired number never returns" is about REPLACEMENTS.
      expect(result.accessionNumber).toBe(loss.accessionNumber);
      const copy = await prisma.copy.findUnique({ where: { id: loss.copy.id } });
      expect(copy!.status).toBe('AVAILABLE');
      expect(copy!.accessionNumber).toBe(loss.accessionNumber);
    });

    it('clears the book charge but KEEPS the late charge frozen', async () => {
      const loss = await confirmedLoss();
      await withOrg(
        org.id,
        (tx: LibraryTx) => lost.foundLost(tx, org.id, loss.lostReportId, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      const book = await prisma.fine.findUnique({ where: { id: loss.replacementFineId! } });
      expect(book!.status).toBe('WAIVED');
      expect(book!.waiverReasonCode).toBe('BOOK_FOUND');

      // Un-freezing this would make "Found it" a button nobody presses.
      const late = await prisma.fine.findUnique({ where: { id: loss.lateFineId! } });
      expect(late!.status).toBe('OPEN');
      expect(Number(late!.amount)).toBe(loss.frozenLateAmount);
    });

    it('frees the copy for a FUTURE loss report — lost, found, lost again', async () => {
      const loss = await confirmedLoss();
      await withOrg(
        org.id,
        (tx: LibraryTx) => lost.foundLost(tx, org.id, loss.lostReportId, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );
      // The partial unique index only covers OPEN statuses, so a terminal
      // report must not block a new one years later.
      const again = await withOrg(
        org.id,
        (tx: LibraryTx) => lost.reportMissing(tx, org.id, loss.accessionNumber, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );
      expect(again.lostReportId).toBeDefined();
      expect(await prisma.lostReport.count({ where: { copyId: loss.copy.id } })).toBe(2);
    });
  });

  describe('missing at stock take', () => {
    it('records a loss with NO member and NO issue, and charges nobody', async () => {
      const accessionNumber = `SB-MISS-${Date.now()}`;
      const copy = await prisma.copy.create({
        data: { orgId: org.id, titleId, branchId: org.branchId, accessionNumber, status: 'AVAILABLE' },
      });

      const result = await withOrg(
        org.id,
        (tx: LibraryTx) => lost.reportMissing(tx, org.id, accessionNumber, staffId, new Date(), [org.branchId]),
        undefined,
        LOST_TX_OPTIONS,
      );

      const report = await prisma.lostReport.findUnique({ where: { id: result.lostReportId } });
      // The whole point: nobody had it, so nobody is on the hook. Without this
      // route a librarian has to invent a fake issue to a child.
      expect(report!.memberId).toBeNull();
      expect(report!.issueId).toBeNull();
      expect(report!.status).toBe('CONFIRMED');
      expect(report!.frozenLateAmount).toBeNull();
      expect((await prisma.copy.findUnique({ where: { id: copy.id } }))!.status).toBe('LOST');
      expect(await prisma.fine.count({ where: { orgId: org.id, reason: { contains: accessionNumber } } })).toBe(0);
    });

    it('refuses a copy somebody actually has — that is a different flow', async () => {
      const accessionNumber = `SB-HELD-${Date.now()}`;
      const copy = await prisma.copy.create({
        data: { orgId: org.id, titleId, branchId: org.branchId, accessionNumber, status: 'ISSUED' },
      });
      await prisma.issue.create({
        data: {
          orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId: org.memberId,
          dueAt: new Date(Date.now() + DAY), status: 'ACTIVE',
        },
      });

      await expect(
        withOrg(
          org.id,
          (tx: LibraryTx) => lost.reportMissing(tx, org.id, accessionNumber, staffId, new Date(), [org.branchId]),
          undefined,
          LOST_TX_OPTIONS,
        ),
      ).rejects.toThrow(/issued to a member/);
    });
  });
});

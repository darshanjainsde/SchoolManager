import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { MeService } from '../src/modules/me/internal/me.service';
import { LostService, LOST_TX_OPTIONS } from '../src/modules/circulation/internal/lost.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * A borrower's own account.
 *
 * The assertions that matter here are NEGATIVE: what a child must not be able
 * to see, and what they must not be able to reach. A price is the thing — the
 * only party that tells a child what they owe for a lost book is the library,
 * after a librarian has confirmed it.
 */
describeLive('me — a borrower sees their own account, and nothing else', () => {
  const me = new MeService();
  const lost = new LostService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let titleId: string;
  let childUserId: string;
  let classmateUserId: string;
  let classmateMemberId: string;
  let staffOnlyUserId: string;
  const DAY = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`me-${Date.now().toString(36)}`));
    titleId = (await prisma.title.create({
      data: { orgId: org.id, title: 'The Hungry Tide', replacementPrice: 399 },
    })).id;
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

    childUserId = (await prisma.libUser.create({
      data: {
        orgId: org.id, email: `me-child-${Date.now()}@t.local`, passwordHash: 'x',
        role: 'MEMBER', branchIds: [], memberId: org.memberId,
      },
    })).id;

    const classmate = await prisma.member.create({
      data: { orgId: org.id, code: `MATE-${Date.now()}`, firstName: 'Class', lastName: 'Mate' },
    });
    classmateMemberId = classmate.id;
    classmateUserId = (await prisma.libUser.create({
      data: {
        orgId: org.id, email: `me-mate-${Date.now()}@t.local`, passwordHash: 'x',
        role: 'MEMBER', branchIds: [], memberId: classmate.id,
      },
    })).id;

    // A librarian who does not borrow — no member row at all.
    staffOnlyUserId = (await prisma.libUser.create({
      data: {
        orgId: org.id, email: `me-staff-${Date.now()}@t.local`, passwordHash: 'x',
        role: 'LIBRARIAN', branchIds: [org.branchId],
      },
    })).id;
  });

  afterAll(async () => { await cleanupOrgs([org.id, other.id]); });

  async function issueTo(memberId: string, daysOverdue: number) {
    const accessionNumber = `ME-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`;
    const copy = await prisma.copy.create({
      data: {
        orgId: org.id, titleId, branchId: org.branchId, accessionNumber,
        status: 'ISSUED', acquisitionCost: 45,
      },
    });
    const issue = await prisma.issue.create({
      data: {
        orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId,
        issuedAt: new Date(Date.now() - (daysOverdue + 14) * DAY),
        dueAt: new Date(Date.now() - daysOverdue * DAY),
        status: 'ACTIVE',
      },
    });
    return { copy, issue, accessionNumber };
  }

  it('lists only their OWN books, never a classmate’s', async () => {
    const mine = await issueTo(org.memberId, 2);
    await issueTo(classmateMemberId, 2);

    const rows = await withOrg(org.id, (tx: LibraryTx) =>
      me.myIssues(tx, org.id, childUserId, new Date()));

    expect(rows.map((r) => r.accessionNumber)).toContain(mine.accessionNumber);
    expect(rows).toHaveLength(1);
  });

  it('never carries a price — not the title’s, not what the school paid', async () => {
    await issueTo(org.memberId, 1);
    const rows = await withOrg(org.id, (tx: LibraryTx) =>
      me.myIssues(tx, org.id, childUserId, new Date()));

    // The copies behind these DO carry both (399 and 45).
    //
    // What actually protects a borrower here is that the service BUILDS a
    // narrow `MyIssue` rather than returning rows — the `select` is only
    // defence in depth, and widening it alone does not leak (verified by
    // doing exactly that and watching this still pass). So the assertion
    // that carries weight is the EXACT KEY SET: if a future refactor spreads
    // a Copy or Title row into the response, extra keys appear and this fails,
    // whatever they happen to be called.
    const json = JSON.stringify(rows);
    expect(json).not.toMatch(/replacementPrice|acquisitionCost/);

    // The price check reads VALUES, not the serialized blob. It used to be
    // `expect(json).not.toContain('399')`, which failed on a run where a row's
    // uuid happened to be `37639928-b84b-...` — the digits 3-9-9 sit inside it.
    // Every row carries a uuid and two ISO timestamps, so a bare three-digit
    // substring check collides at a few percent per run: a guard that cries
    // wolf gets deleted, and this one is guarding money reaching a child.
    // Reading the values instead still catches a price surfacing under ANY key
    // name, which is the thing actually worth catching.
    const values = rows.flatMap((row) => Object.values(row));
    expect(values).not.toContain(399); // Title.replacementPrice
    expect(values).not.toContain(45); // Copy.acquisitionCost
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'accessionNumber', 'daysLeft', 'dueAt', 'id', 'issuedAt',
        'lateChargeSoFar', 'renewCount', 'title',
      ]);
    }
  });

  it('shows what is owed on a late book right now, computed not stored', async () => {
    const rows = await withOrg(org.id, (tx: LibraryTx) =>
      me.myIssues(tx, org.id, childUserId, new Date()));
    const late = rows.find((r) => r.daysLeft < 0);
    expect(late).toBeDefined();
    expect(late!.lateChargeSoFar).toBeGreaterThan(0);
  });

  it('charges a student nothing when fines are off — the default', async () => {
    await prisma.librarySettings.update({
      where: { orgId: org.id }, data: { chargeStudentFines: false },
    });
    try {
      const rows = await withOrg(org.id, (tx: LibraryTx) =>
        me.myIssues(tx, org.id, childUserId, new Date()));
      for (const r of rows) expect(r.lateChargeSoFar).toBe(0);
    } finally {
      await prisma.librarySettings.update({
        where: { orgId: org.id }, data: { chargeStudentFines: true },
      });
    }
  });

  describe('dues', () => {
    it('shows a charge that exists, by book name, with no price of the book', async () => {
      const { issue } = await issueTo(org.memberId, 5);
      await prisma.fine.create({
        data: {
          orgId: org.id, memberId: org.memberId, issueId: issue.id,
          kind: 'OVERDUE', status: 'OPEN', amount: 20, reason: '4 day(s) late',
        },
      });

      const dues = await withOrg(org.id, (tx: LibraryTx) => me.myDues(tx, childUserId));
      const row = dues.find((d) => d.amount === '20');
      expect(row).toBeDefined();
      expect(row!.book).toBe('The Hungry Tide');
      expect(JSON.stringify(dues)).not.toMatch(/replacementPrice|acquisitionCost/);
      // Same reasoning as myIssues: the key set is what catches a raw row.
      expect(Object.keys(row!).sort()).toEqual([
        'amount', 'book', 'createdAt', 'id', 'kind', 'paidAmount', 'reason',
        'status', 'waivedAmount',
      ]);
    });

    it('shows NOTHING for a self-reported loss a librarian has not confirmed', async () => {
      // The charge does not exist yet, and inventing a number for the child is
      // the exact thing the confirm step exists to prevent.
      const { accessionNumber } = await issueTo(org.memberId, 3);
      await withOrg(org.id, (tx: LibraryTx) =>
        lost.selfReportLost(tx, org.id, accessionNumber, childUserId, new Date()),
        undefined, LOST_TX_OPTIONS);

      const dues = await withOrg(org.id, (tx: LibraryTx) => me.myDues(tx, childUserId));
      expect(JSON.stringify(dues)).not.toContain('399');
      // and no LOST charge has appeared
      expect(dues.filter((d) => d.kind === 'LOST')).toHaveLength(0);
    });
  });

  describe('availability', () => {
    it('answers "is it on the shelf" with counts, never a list of copies', async () => {
      const result = await withOrg(org.id, (tx: LibraryTx) =>
        me.availability(tx, org.id, titleId));

      expect(result.title).toBe('The Hungry Tide');
      expect(typeof result.availableNow).toBe('number');
      expect(typeof result.totalCopies).toBe('number');
      // A copy list would hand out accession numbers and acquisition costs for
      // no reason a reader has.
      expect(JSON.stringify(result)).not.toMatch(/accessionNumber|acquisitionCost|replacementPrice/);
    });

    it("cannot see another org's title", async () => {
      const outsider = await prisma.title.create({
        data: { orgId: other.id, title: 'Not Yours' },
      });
      await expect(
        withOrg(org.id, (tx: LibraryTx) => me.availability(tx, org.id, outsider.id)),
      ).rejects.toThrow(/Title not found/);
    });
  });

  describe('history', () => {
    it('lists their own borrowing, most recent first', async () => {
      const rows = await withOrg(org.id, (tx: LibraryTx) => me.myHistory(tx, childUserId, 50));
      expect(rows.length).toBeGreaterThan(0);
      const times = rows.map((r) => r.issuedAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
      expect(JSON.stringify(rows)).not.toMatch(/replacementPrice|acquisitionCost/);
    });

    it("does not include a classmate's borrowing", async () => {
      const mine = await withOrg(org.id, (tx: LibraryTx) => me.myHistory(tx, childUserId, 200));
      const theirs = await withOrg(org.id, (tx: LibraryTx) => me.myHistory(tx, classmateUserId, 200));
      const overlap = mine.filter((m) => theirs.some((t) => t.id === m.id));
      expect(overlap).toHaveLength(0);
    });
  });

  it('a staff login with no membership gets a clean 404, not somebody else’s data', async () => {
    await expect(
      withOrg(org.id, (tx: LibraryTx) => me.myIssues(tx, org.id, staffOnlyUserId, new Date())),
    ).rejects.toThrow(/no library membership/);
  });
});

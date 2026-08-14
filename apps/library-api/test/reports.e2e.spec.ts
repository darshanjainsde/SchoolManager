import { getLibraryPlatformPrisma, withOrg } from '@library/db';
import { ReportsService } from '../src/modules/reports';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;
const DAY = 86_400_000;

/**
 * P6 reports. The assertions worth writing are the exclusions — a report that
 * over-counts is merely wrong, but "who has read nothing" naming a child who
 * left in April, or who read three books last week, is the kind of wrong that
 * gets a report quietly ignored by the staff it was built for.
 */
describeLive('reports', () => {
  const reports = new ReportsService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;

  const from = new Date(Date.now() - 30 * DAY);
  const to = new Date(Date.now() + DAY);

  let reader: string;
  let silent: string;
  let departed: string;
  let titleId: string;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`rep-${Date.now().toString(36)}`));

    const mk = async (code: string, first: string, classRef: string, status: 'ACTIVE' | 'SUSPENDED') =>
      (await prisma.member.create({
        data: {
          orgId: org.id, homeBranchId: org.branchId, code, firstName: first, lastName: 'Test',
          memberType: 'STUDENT', classRef, status,
        } as never,
        select: { id: true },
      })).id;

    reader = await mk(`R-${Date.now()}`, 'Meera', '6-B', 'ACTIVE');
    silent = await mk(`S-${Date.now()}`, 'Kabir', '6-B', 'ACTIVE');
    // SUSPENDED, because MemberStatus is PENDING | ACTIVE | SUSPENDED and there
    // is NO value meaning "left the school" — see the test below for why that
    // matters and what it does not prove.
    departed = await mk(`D-${Date.now()}`, 'Anya', '6-B', 'SUSPENDED');

    const title = await prisma.title.create({
      data: { orgId: org.id, title: 'The Hungry Tide' },
      select: { id: true },
    });
    titleId = title.id;

    // TWO authors, deliberately. Authors are many-to-many through TitleAuthor,
    // so a naive join fans one issue out into one row per author and doubles
    // the borrow count. Two authors is what makes that bug visible.
    for (const name of ['Amitav Ghosh', 'A Co-Author']) {
      const a = await prisma.author.create({
        data: { orgId: org.id, name, sortName: name.toLowerCase() },
        select: { id: true },
      });
      await prisma.titleAuthor.create({ data: { titleId, authorId: a.id } });
    }

    // Meera reads twice and brings both back late, so she lands in three of the
    // four reports and in none of `readNothing`.
    for (let n = 0; n < 2; n++) {
      const copy = await prisma.copy.create({
        data: {
          orgId: org.id, titleId, branchId: org.branchId,
          accessionNumber: `REP-${Date.now()}-${n}`, status: 'AVAILABLE',
        },
        select: { id: true },
      });
      await prisma.issue.create({
        data: {
          orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId: reader,
          issuedAt: new Date(Date.now() - 10 * DAY),
          dueAt: new Date(Date.now() - 5 * DAY),
          returnedAt: new Date(Date.now() - 2 * DAY), // 3 days late
          status: 'RETURNED',
        } as never,
      });
    }
  });

  afterAll(async () => { await cleanupOrgs([org.id, other.id]); });

  it('counts issues per class, and how many DISTINCT children read', async () => {
    // Forty issues from four children is a different class from forty from
    // thirty-eight, and a raw total cannot tell them apart.
    const rows = await withOrg(org.id, (tx) =>
      reports.issuesPerClass(tx, org.id, from, to, []),
    );
    const sixB = rows.find((r) => r.classRef === '6-B');
    expect(sixB?.issues).toBe(2);
    expect(sixB?.readers).toBe(1);
  });

  it('ranks most-read by TITLE, not by copy', async () => {
    // Six copies of one book are one book as far as "what do children want" goes.
    const rows = await withOrg(org.id, (tx) => reports.mostRead(tx, org.id, from, to, [], 10));
    const top = rows.find((r) => r.titleId === titleId);
    expect(top?.title).toBe('The Hungry Tide');
    // TWO, not four. This title has two authors; counting the join rows instead
    // of distinct issues would double it, and the doubled figure is the one a
    // school would order stock from.
    expect(top?.issues).toBe(2);
    expect(rows.filter((r) => r.titleId === titleId)).toHaveLength(1);
    expect(top?.author).toContain('Amitav Ghosh');
  });

  describe('who has read nothing this term', () => {
    it('lists the child who borrowed nothing', async () => {
      const rows = await withOrg(org.id, (tx) => reports.readNothing(tx, org.id, from, to, null));
      expect(rows.map((r) => r.memberId)).toContain(silent);
    });

    it('never lists a child who DID read', async () => {
      const rows = await withOrg(org.id, (tx) => reports.readNothing(tx, org.id, from, to, null));
      expect(rows.map((r) => r.memberId)).not.toContain(reader);
    });

    it('never lists a member who is not ACTIVE', async () => {
      // A child who left in April is not a non-reader. Listing them is how a
      // report stops being trusted, and an untrusted report is not read at all.
      const rows = await withOrg(org.id, (tx) => reports.readNothing(tx, org.id, from, to, null));
      expect(rows.map((r) => r.memberId)).not.toContain(departed);
    });

    it('KNOWN GAP: a child who left is still ACTIVE, so they DO appear', async () => {
      // Stated as a test rather than left as a surprise. MemberStatus is
      // PENDING | ACTIVE | SUSPENDED — there is no LEFT or TRANSFERRED, which
      // the spec already lists as design debt ("a departed child inflates owed
      // forever"). Nothing marks a leaver, so unless a school suspends them by
      // hand they stay ACTIVE and this report names them as a non-reader.
      //
      // This test passes today and MUST be rewritten — not deleted — when
      // MemberStatus gains a leaver value. Asserting the wrong-but-true
      // behaviour is what makes the gap visible in review instead of being
      // discovered by a head of school reading a list of children who left.
      const stillEnrolled = await prisma.member.create({
        data: {
          orgId: org.id, homeBranchId: org.branchId, code: `L-${Date.now()}`,
          firstName: 'Left', lastName: 'InApril', memberType: 'STUDENT',
          classRef: '6-B', status: 'ACTIVE',
        } as never,
        select: { id: true },
      });

      const rows = await withOrg(org.id, (tx) => reports.readNothing(tx, org.id, from, to, null));
      expect(rows.map((r) => r.memberId)).toContain(stillEnrolled.id);
    });

    it('counts a child who read OUTSIDE the window as having read nothing IN it', async () => {
      // The window is the whole point: "this term" excludes last term's reading.
      const lastTerm = { from: new Date(Date.now() - 400 * DAY), to: new Date(Date.now() - 300 * DAY) };
      const rows = await withOrg(org.id, (tx) =>
        reports.readNothing(tx, org.id, lastTerm.from, lastTerm.to, null),
      );
      expect(rows.map((r) => r.memberId)).toContain(reader);
    });

    it('narrows to one class when asked', async () => {
      const rows = await withOrg(org.id, (tx) => reports.readNothing(tx, org.id, from, to, '6-B'));
      expect(rows.every((r) => r.classRef === '6-B')).toBe(true);
      const none = await withOrg(org.id, (tx) =>
        reports.readNothing(tx, org.id, from, to, 'no-such-class'),
      );
      expect(none).toEqual([]);
    });
  });

  describe('chronic late returners', () => {
    it('needs a HABIT, not one late return', async () => {
      // Everyone is late once. A report that flagged that would list the school
      // and be ignored — the same as not having it.
      const strict = await withOrg(org.id, (tx) =>
        reports.chronicLateReturners(tx, org.id, from, to, 3),
      );
      expect(strict.map((r) => r.memberId)).not.toContain(reader); // only 2 late

      const loose = await withOrg(org.id, (tx) =>
        reports.chronicLateReturners(tx, org.id, from, to, 2),
      );
      const row = loose.find((r) => r.memberId === reader);
      expect(row?.lateReturns).toBe(2);
      expect(row?.worstDaysLate).toBe(3);
    });

    it('ignores a book still out — that is the not-returned list, a different screen', async () => {
      const copy = await prisma.copy.create({
        data: {
          orgId: org.id, titleId, branchId: org.branchId,
          accessionNumber: `REP-OUT-${Date.now()}`, status: 'ISSUED',
        },
        select: { id: true },
      });
      await prisma.issue.create({
        data: {
          orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId: silent,
          issuedAt: new Date(Date.now() - 20 * DAY),
          dueAt: new Date(Date.now() - 15 * DAY),
          returnedAt: null,
          status: 'ACTIVE',
        } as never,
      });

      const rows = await withOrg(org.id, (tx) =>
        reports.chronicLateReturners(tx, org.id, from, to, 1),
      );
      expect(rows.map((r) => r.memberId)).not.toContain(silent);
    });
  });

  it('shows another org nothing', async () => {
    // Every report is a cross-tenant leak waiting to happen: they are all
    // aggregates, and an aggregate that quietly spans two schools looks like a
    // plausible number rather than an error.
    const rows = await withOrg(other.id, (tx) =>
      reports.issuesPerClass(tx, other.id, from, to, []),
    );
    expect(rows).toEqual([]);

    const silentRows = await withOrg(other.id, (tx) =>
      reports.readNothing(tx, other.id, from, to, null),
    );
    expect(silentRows.map((r) => r.memberId)).not.toContain(silent);
  });
});

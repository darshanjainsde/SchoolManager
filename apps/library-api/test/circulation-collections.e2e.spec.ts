import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { FinesService } from '../src/modules/circulation/internal/fines.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Collections.
 *
 * The assertion this file exists for is the MECHANICAL EXCLUSION. "The book was
 * found" and "the family replaced it" are waivers in the database — the fine
 * closes without money — but the school lost nothing either time. Counting them
 * as "let off" would inflate a school's apparent generosity with book-keeping
 * and make the figure useless for the only question it is asked: how much did
 * we actually forgive?
 */
describeLive('circulation — collections', () => {
  const fines = new FinesService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let staffId: string;

  /** Today in the ORG's timezone, which is what the report windows on. */
  let today: string;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`coll-${Date.now().toString(36)}`));
    staffId = (
      await prisma.libUser.create({
        data: {
          orgId: org.id, email: `coll-${Date.now()}@t.local`, passwordHash: 'x',
          role: 'LIBRARIAN', branchIds: [org.branchId],
        },
      })
    ).id;
    const [row] = await prisma.$queryRaw<Array<{ d: string }>>`
      SELECT to_char((now() AT TIME ZONE o."timezone")::date, 'YYYY-MM-DD') AS d
      FROM "LibraryOrg" o WHERE o."id" = ${org.id}::uuid`;
    today = row.d;

    const now = new Date();
    const fine = (data: Record<string, unknown>) =>
      prisma.fine.create({
        data: { orgId: org.id, memberId: org.memberId, kind: 'LOST', amount: 0, ...data } as never,
      });

    // Collected: 299 cash + 100 UPI.
    await fine({ kind: 'LOST', amount: 299, status: 'PAID', paidAmount: 299, paidAt: now, paidMethod: 'CASH', paidByUserId: staffId });
    await fine({ kind: 'OVERDUE', amount: 100, status: 'PAID', paidAmount: 100, paidAt: now, paidMethod: 'UPI', paidByUserId: staffId });

    // GENUINELY let off: 50 hardship + 25 library error = 75.
    await fine({ kind: 'OVERDUE', amount: 50, status: 'WAIVED', waivedAmount: 50, waivedAt: now, waiverReasonCode: 'HARDSHIP', waivedByUserId: staffId });
    await fine({ kind: 'OVERDUE', amount: 25, status: 'WAIVED', waivedAmount: 25, waivedAt: now, waiverReasonCode: 'LIBRARY_ERROR', waivedByUserId: staffId });

    // MECHANICAL — the school lost nothing. 195 found + 275 replaced = 470.
    await fine({ kind: 'LOST', amount: 195, status: 'WAIVED', waivedAmount: 195, waivedAt: now, waiverReasonCode: 'BOOK_FOUND', waivedByUserId: staffId });
    await fine({ kind: 'LOST', amount: 275, status: 'WAIVED', waivedAmount: 275, waivedAt: now, waiverReasonCode: 'REPLACED_IN_KIND', waivedByUserId: staffId });

    // Still owed: 60.
    await fine({ kind: 'OVERDUE', amount: 60, status: 'OPEN' });
  });

  afterAll(async () => {
    await cleanupOrgs([org.id, other.id]);
  });

  const report = () =>
    withOrg(org.id, (tx: LibraryTx) => fines.collections(tx, org.id, { from: today, to: today }, []));

  it('counts what was actually collected, and how it crossed the counter', async () => {
    const r = await report();
    expect(r.collected).toBe(399);

    const byMethod = Object.fromEntries(r.byMethod.map((m) => [m.method, m.collected]));
    expect(byMethod.CASH).toBe(299);
    expect(byMethod.UPI).toBe(100);
  });

  it('EXCLUDES mechanical waivers from "let off" and reports them separately', async () => {
    const r = await report();

    // 50 hardship + 25 library error. NOT the 195 found or the 275 replaced.
    expect(r.letOff).toBe(75);
    // Visible, but never mistaken for generosity.
    expect(r.clearedInKind).toBe(470);
  });

  it('reports what is still owed as a position, not a flow', async () => {
    const r = await report();
    expect(r.stillOwed).toBe(60);
    expect(r.membersOwing).toBe(1);
  });

  it('reconciles: every tile matches the raw fine rows', async () => {
    const r = await report();
    const all = await prisma.fine.findMany({ where: { orgId: org.id } });

    const collected = all.reduce((s, f) => s + Number(f.paidAmount), 0);
    const mechanical = all
      .filter((f) => f.waiverReasonCode === 'BOOK_FOUND' || f.waiverReasonCode === 'REPLACED_IN_KIND')
      .reduce((s, f) => s + Number(f.waivedAmount ?? 0), 0);
    const forgiven = all
      .filter((f) => f.waivedAmount && f.waiverReasonCode !== 'BOOK_FOUND' && f.waiverReasonCode !== 'REPLACED_IN_KIND')
      .reduce((s, f) => s + Number(f.waivedAmount ?? 0), 0);
    const owed = all
      .filter((f) => f.status === 'OPEN' || f.status === 'PARTIAL')
      .reduce((s, f) => s + Number(f.amount) - Number(f.paidAmount) - Number(f.waivedAmount ?? 0), 0);

    expect(r.collected).toBe(collected);
    expect(r.letOff).toBe(forgiven);
    expect(r.clearedInKind).toBe(mechanical);
    expect(r.stillOwed).toBe(owed);
  });

  it('breaks collections down by why the money was owed', async () => {
    const r = await report();
    const byKind = Object.fromEntries(r.byReason.map((k) => [k.kind, k]));
    expect(byKind.LOST.collected).toBe(299);
    expect(byKind.OVERDUE.collected).toBe(100);
    expect(byKind.OVERDUE.owed).toBe(60);
  });

  it("cannot see another org's money", async () => {
    await prisma.fine.create({
      data: {
        orgId: other.id, memberId: other.memberId, kind: 'LOST', amount: 9999,
        status: 'PAID', paidAmount: 9999, paidAt: new Date(), paidMethod: 'CASH',
      },
    });
    const r = await report();
    expect(r.collected).toBe(399);
  });

  describe('waiver log', () => {
    it('lists every waiver with its reason, and FLAGS the mechanical ones', async () => {
      const log = await withOrg(org.id, (tx: LibraryTx) => fines.waiverLog(tx, org.id, 50, []));

      expect(log).toHaveLength(4);
      const byCode = Object.fromEntries(log.map((w) => [w.reasonCode, w]));
      // Included in the log — "the book was found" belongs in the audit trail,
      // it just does not belong in "how much did we forgive".
      expect(byCode.BOOK_FOUND.mechanical).toBe(true);
      expect(byCode.REPLACED_IN_KIND.mechanical).toBe(true);
      expect(byCode.HARDSHIP.mechanical).toBe(false);
      expect(byCode.LIBRARY_ERROR.mechanical).toBe(false);
      expect(byCode.HARDSHIP.waivedByUserId).toBe(staffId);
    });
  });
});

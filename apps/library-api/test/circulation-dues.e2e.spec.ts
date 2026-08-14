import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { FinesService } from '../src/modules/circulation/internal/fines.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * The member-shaped dues list.
 *
 * The property this file protects is the SPLIT: a teacher's debt must never
 * appear inside a figure a principal reads as "what the children owe". The
 * approved prototype's tile says "Students owing", and that is only truthful if
 * the query can separate them.
 */
describeLive('circulation — dues, one row per member', () => {
  const fines = new FinesService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let student: string;
  let teacher: string;
  let settled: string;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`dues-${Date.now().toString(36)}`));

    const mk = async (memberType: 'STUDENT' | 'TEACHER', first: string, classRef?: string) =>
      (
        await prisma.member.create({
          data: {
            orgId: org.id, code: `${first}-${Date.now()}`, firstName: first, lastName: 'Owes',
            memberType, classRef,
          },
        })
      ).id;

    student = await mk('STUDENT', 'Meera', '6-B');
    teacher = await mk('TEACHER', 'Sunita');
    settled = await mk('STUDENT', 'Paid', '6-B');

    const fine = (memberId: string, amount: number, kind: 'OVERDUE' | 'LOST', extra = {}) =>
      prisma.fine.create({
        data: { orgId: org.id, memberId, kind, status: 'OPEN', amount, ...extra },
      });

    // Meera: two fines, two reasons — 6 late + 195 book.
    await fine(student, 6, 'OVERDUE');
    await fine(student, 195, 'LOST');
    // Sunita the teacher: 300.
    await fine(teacher, 300, 'OVERDUE');
    // Fully paid and fully waived members must not appear at all.
    await fine(settled, 50, 'OVERDUE', { status: 'PAID', paidAmount: 50 });
    await fine(settled, 20, 'OVERDUE', { status: 'WAIVED', waivedAmount: 20, waiverReasonCode: 'HARDSHIP' });
  });

  afterAll(async () => {
    await cleanupOrgs([org.id, other.id]);
  });

  const dues = (memberType?: 'STUDENT' | 'TEACHER') =>
    withOrg(org.id, (tx: LibraryTx) => fines.listDues(tx, org.id, { memberType }, []));

  it('returns one row per member with what they owe and why', async () => {
    const rows = await dues();
    const meera = rows.find((r) => r.memberId === student);

    expect(meera).toBeDefined();
    expect(meera!.owed).toBe(201); // 6 + 195, summed in SQL
    expect(meera!.fineCount).toBe(2);
    expect(meera!.classRef).toBe('6-B');
    expect(meera!.kinds.sort()).toEqual(['LOST', 'OVERDUE']);
  });

  it("keeps a teacher's debt out of the students' figure", async () => {
    const students = await dues('STUDENT');
    const teachers = await dues('TEACHER');

    expect(students.map((r) => r.memberId)).toContain(student);
    expect(students.map((r) => r.memberId)).not.toContain(teacher);
    expect(teachers.map((r) => r.memberId)).toEqual([teacher]);

    // The number a principal would read.
    const studentTotal = students.reduce((sum, r) => sum + r.owed, 0);
    expect(studentTotal).toBe(201);
  });

  it('omits members who owe nothing — paid and waived both count as settled', async () => {
    const rows = await dues();
    expect(rows.map((r) => r.memberId)).not.toContain(settled);
  });

  it('subtracts what has been paid and waived, not just the original amount', async () => {
    const partly = await prisma.member.create({
      data: { orgId: org.id, code: `PART-${Date.now()}`, firstName: 'Part', lastName: 'Paid' },
    });
    await prisma.fine.create({
      data: {
        orgId: org.id, memberId: partly.id, kind: 'LOST', status: 'PARTIAL',
        amount: 300, paidAmount: 100,
      },
    });

    const row = (await dues()).find((r) => r.memberId === partly.id);
    expect(row!.owed).toBe(200);
  });

  it('orders by who owes the most, so the biggest problem is on screen first', async () => {
    const rows = await dues();
    const owed = rows.map((r) => r.owed);
    expect(owed).toEqual([...owed].sort((a, b) => b - a));
  });

  it("cannot see another org's dues", async () => {
    const outsider = await prisma.member.create({
      data: { orgId: other.id, code: `OUT-${Date.now()}`, firstName: 'Out', lastName: 'Sider' },
    });
    await prisma.fine.create({
      data: { orgId: other.id, memberId: outsider.id, kind: 'LOST', status: 'OPEN', amount: 999 },
    });

    const rows = await dues();
    expect(rows.map((r) => r.memberId)).not.toContain(outsider.id);
  });
});

/**
 * Paying an ordinary fine.
 *
 * The hole this fills: before it, `waive` was the only route that could close a
 * plain late-return fine, so a librarian who took ₹15 at the desk had to record
 * it as money LET OFF — and the collections screen then reported revenue as
 * forgiveness.
 */
describeLive('circulation — paying a fine at the counter', () => {
  const fines = new FinesService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let staffId: string;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`payfine-${Date.now().toString(36)}`));
    staffId = (await prisma.libUser.create({
      data: {
        orgId: org.id, email: `pf-${Date.now()}@t.local`, passwordHash: 'x',
        role: 'ASSISTANT', branchIds: [org.branchId],
      },
    })).id;
  });

  afterAll(async () => { await cleanupOrgs([org.id, other.id]); });

  const mkFine = (amount: number, extra: Record<string, unknown> = {}) =>
    prisma.fine.create({
      data: { orgId: org.id, memberId: org.memberId, kind: 'OVERDUE', status: 'OPEN', amount, ...extra } as never,
    });

  const pay = (id: string) =>
    withOrg(org.id, (tx: LibraryTx) =>
      fines.pay(tx, org.id, id, { method: 'CASH', note: 'slip 7' }, staffId, new Date(), []),
    );

  it('closes the fine and records how the money crossed the counter', async () => {
    const fine = await mkFine(15);

    const result = await pay(fine.id);

    expect(result.fine.status).toBe('PAID');
    expect(Number(result.fine.paidAmount)).toBe(15);
    expect(result.fine.paidMethod).toBe('CASH');
    expect(result.fine.paymentNote).toBe('slip 7');
    expect(result.fine.paidByUserId).toBe(staffId);
  });

  it('shows up as COLLECTED, not as let off — the whole point', async () => {
    const fine = await mkFine(40);
    await pay(fine.id);

    const [row] = await prisma.$queryRaw<Array<{ collected: unknown; letoff: unknown }>>`
      SELECT COALESCE(SUM("paidAmount"),0) AS collected,
             COALESCE(SUM("waivedAmount"),0) AS letoff
      FROM "Fine" WHERE "orgId" = ${org.id}::uuid AND "id" = ${fine.id}::uuid`;
    expect(Number(row.collected)).toBe(40);
    expect(Number(row.letoff)).toBe(0);
  });

  it('drops the member off the dues list', async () => {
    const fresh = await prisma.member.create({
      data: { orgId: org.id, code: `PF-${Date.now()}`, firstName: 'Pays', lastName: 'Up' },
    });
    const fine = await prisma.fine.create({
      data: { orgId: org.id, memberId: fresh.id, kind: 'OVERDUE', status: 'OPEN', amount: 25 },
    });
    const before = await withOrg(org.id, (tx: LibraryTx) => fines.listDues(tx, org.id, {}, []));
    expect(before.map((r) => r.memberId)).toContain(fresh.id);

    await pay(fine.id);

    const after = await withOrg(org.id, (tx: LibraryTx) => fines.listDues(tx, org.id, {}, []));
    expect(after.map((r) => r.memberId)).not.toContain(fresh.id);
  });

  it('pays only the remainder when part was already waived', async () => {
    const fine = await mkFine(100, { status: 'PARTIAL', waivedAmount: 30, waivedReason: 'partial', waiverReasonCode: 'HARDSHIP' });
    const result = await pay(fine.id);
    // 100 charged, 30 forgiven, so 70 crossed the counter — not 100.
    expect(Number(result.fine.paidAmount)).toBe(70);
  });

  it('two clerks taking the same payment do not double the recorded revenue', async () => {
    const fine = await mkFine(60);
    const results = await Promise.allSettled([pay(fine.id), pay(fine.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const after = await prisma.fine.findUnique({ where: { id: fine.id } });
    expect(Number(after!.paidAmount)).toBe(60);
  });

  it('refuses a fine with nothing left to pay', async () => {
    const fine = await mkFine(10, { status: 'PAID', paidAmount: 10 });
    await expect(pay(fine.id)).rejects.toThrow(/nothing left to pay/);
  });
});

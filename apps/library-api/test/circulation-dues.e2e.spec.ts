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

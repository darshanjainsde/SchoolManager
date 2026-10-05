import { PayLeaveService } from '../../src/modules/payroll/internal/pay-leave.service';
import { PayPackService } from '../../src/modules/payroll/internal/pay-pack.service';
import { PayPeopleService } from '../../src/modules/payroll/internal/pay-people.service';
import { PayRunService } from '../../src/modules/payroll/internal/pay-run.service';
import { Ctx } from './ctx';
import { SCHOOL } from './data';

const MONTHS = [4, 5, 6, 7, 8, 9] as const;
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const GRADES = [
  { name: 'Vice Principal', description: 'School leadership', min: 70_000, max: 100_000 },
  { name: 'PGT', description: 'Post-graduate teacher, classes XI–XII', min: 55_000, max: 80_000 },
  { name: 'TGT', description: 'Trained graduate teacher, classes VI–X', min: 40_000, max: 58_000 },
  { name: 'PRT', description: 'Primary and pre-primary teacher', min: 24_000, max: 42_000 },
  { name: 'Office & accounts', description: 'Administration, accounts and library', min: 22_000, max: 36_000 },
  { name: 'Support staff', description: 'Drivers, security and support', min: 12_000, max: 22_000 },
] as const;
const gradeOf = (designation: string, isTeacher: boolean, role = ''): string => {
  if (isTeacher) {
    if (designation.startsWith('Vice')) return 'Vice Principal';
    if (designation.startsWith('PGT')) return 'PGT';
    if (designation.startsWith('TGT')) return 'TGT';
    return 'PRT';
  }
  return ['OFFICE', 'ACCOUNTS', 'LIBRARIAN'].includes(role) ? 'Office & accounts' : 'Support staff';
};

/**
 * Salary for everyone, six months of it, through the REAL pay engine — the
 * same services the Pay desk calls — so every payslip carries genuine lines,
 * statutory deductions and leave-without-pay, not a hand-written imitation.
 *
 * April to August are paid; September is approved and waiting to be paid,
 * which is where a school is in the first days of October.
 */
export async function payroll(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const packs = new PayPackService();
  const people = new PayPeopleService(packs);
  const runs = new PayRunService(packs, people);
  const leave = new PayLeaveService();
  const actor = c.accountsUserId;

  await people.components(schoolId);
  await p.payGrade.createMany({
    data: GRADES.map((g, order) => ({ schoolId, name: g.name, description: g.description, bandMinMinor: g.min * 100, bandMaxMinor: g.max * 100, order })),
  });
  const grades = new Map((await p.payGrade.findMany({ where: { schoolId } })).map((g) => [g.name, g.id]));
  c.counts.PayGrade = GRADES.length;

  const pan = () => `ABCPX${r.int(1000, 9999)}${String.fromCharCode(65 + r.int(0, 25))}`;
  const bank = () => ({
    bankAccount: String(r.int(10_000_000_000, 99_999_999_999)),
    bankIfsc: `HDFC000${r.int(1000, 9999)}`, bankName: 'HDFC Bank',
  });
  const structure = async (kind: 'TEACHER' | 'STAFF', id: string, gross: number, joined: string, grade: string) => {
    const effectiveFrom = joined > SCHOOL.yearStart ? joined : SCHOOL.yearStart;
    const base = {
      personKind: kind, personId: id, effectiveFrom, monthlyGrossMinor: gross * 100,
      payGradeId: grades.get(grade), taxRegime: 'NEW' as const, joinedOn: joined, pan: pan(), uan: String(r.int(100_000_000_000, 999_999_999_999)),
      ...bank(),
    };
    try {
      await people.setStructure(schoolId, actor, base as never);
    } catch (e) {
      // The wage-share rule is a policy a school may choose to carry; the sample
      // school records that it does rather than dropping the person from payroll.
      if (!/WAGE_SHARE|wage/i.test(JSON.stringify((e as { response?: unknown }).response ?? (e as Error).message))) throw e;
      await people.setStructure(schoolId, actor, { ...base, acceptWageShare: true } as never);
    }
  };
  for (const t of c.teachers) await structure('TEACHER', t.id, t.grossRupees, t.joined, gradeOf(t.designation, true));
  for (const s of c.staff) await structure('STAFF', s.id, s.grossRupees, '2019-04-01', gradeOf('', false, s.role));
  c.counts.EmployeePay = c.teachers.length + c.staff.length;

  const created: { id: string; month: number }[] = [];
  for (const month of MONTHS) {
    const run = await runs.open(schoolId, actor, 2026, month);
    created.push({ id: run.id, month });

    // One-off lines a real month has: exam-duty pay in September, an advance being recovered in August.
    if (month === 9) {
      await p.payAdjustment.createMany({
        data: [3, 5, 10].map((i) => ({
          schoolId, personKind: 'TEACHER' as const, teacherId: c.teachers[i]!.id, periodYear: 2026, periodMonth: 9,
          label: 'Half-Yearly exam duty allowance', kind: 'EARNING' as const, amountMinor: 150_000, taxable: true, createdById: actor,
        })),
      });
    }
    if (month === 8) {
      await p.payAdjustment.create({
        data: {
          schoolId, personKind: 'STAFF', staffId: c.staff[7]!.id, periodYear: 2026, periodMonth: 8,
          label: 'Salary advance recovery', kind: 'DEDUCTION', amountMinor: 200_000, taxable: false, createdById: actor,
        },
      });
    }

    // Approved unpaid leave becomes leave-without-pay lines, the way the Pay desk proposes them.
    const proposals = await leave.month(schoolId, 2026, month);
    const todo = proposals.proposals.filter((x) => !x.applied).map((x) => x.personId);
    if (todo.length) await leave.apply(schoolId, actor, 2026, month, todo);

    await runs.calculate(schoolId, run.id);
    await runs.approve(schoolId, actor, run.id);
    if (month !== 9) {
      await runs.lock(schoolId, actor, run.id);
      await runs.markPaid(schoolId, run.id);
    }
  }

  // The engine stamps "now" on each step; a sample school should read as though
  // each month was run at its own month-end.
  for (const { id, month } of created) {
    const end = lastDay(2026, month);
    const at = (d: number, h = 10) => new Date(Date.UTC(2026, month - 1, d, h, 0, 0));
    const paid = new Date(Date.UTC(2026, month, 1, 10, 0, 0));
    await p.payRun.update({
      where: { id },
      data: {
        createdAt: at(Math.max(1, end - 6)), calculatedAt: at(end - 4), approvedAt: at(end - 3),
        lockedAt: month === 9 ? null : at(end - 2), paidAt: month === 9 ? null : paid,
      },
    });
  }
  const slips = await p.payslip.count({ where: { schoolId } });
  c.counts.PayRun = created.length;
  c.counts.Payslip = slips;
  void pad;
}

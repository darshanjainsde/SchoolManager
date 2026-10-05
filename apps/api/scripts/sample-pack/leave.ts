import type { Prisma } from '@skoolos/db';
import { workingDays } from './attendance';
import { Ctx, many } from './ctx';
import { D, iso } from './rng';

type Kind = 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID';

const REASONS: Record<Kind, string[]> = {
  SICK: ['Fever and cold', 'Viral infection, doctor advised rest', 'Stomach infection', 'Dental surgery', 'Migraine'],
  CASUAL: ['Family function', 'Personal work', 'Out-of-station travel', 'Child’s school event', 'Bank and property work'],
  EARNED: ['Planned family trip', 'Attending a wedding out of town', 'Pilgrimage with family'],
  UNPAID: ['Extended personal work', 'Family emergency out of town'],
};

/**
 * Leave policy, a year's allowance for every teacher, and about forty
 * applications — most decided, a few waiting — with the unpaid ones that make
 * the payroll deduct a day.
 */
export async function leave(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;

  await p.leaveTypeDef.createMany({
    data: [
      { schoolId, name: 'Sick Leave', builtin: 'SICK', isPaid: true, defaultAnnual: 10, defaultAnnualStaff: 8 },
      { schoolId, name: 'Casual Leave', builtin: 'CASUAL', isPaid: true, defaultAnnual: 12, defaultAnnualStaff: 10 },
      { schoolId, name: 'Earned Leave', builtin: 'EARNED', isPaid: true, defaultAnnual: 15, defaultAnnualStaff: 12, carryForwardCap: 30 },
      { schoolId, name: 'Leave Without Pay', builtin: 'UNPAID', isPaid: false, defaultAnnual: 0, defaultAnnualStaff: 0 },
    ],
  });
  const defs = new Map((await p.leaveTypeDef.findMany({ where: { schoolId } })).map((d) => [d.builtin as Kind, d]));

  const allocations: Prisma.LeaveAllocationCreateManyInput[] = [];
  for (const t of c.teachers) {
    for (const kind of ['SICK', 'CASUAL', 'EARNED'] as const) {
      const d = defs.get(kind)!;
      allocations.push({
        schoolId, teacherId: t.id, typeDefId: d.id, academicYearId: c.yearId,
        allotted: d.defaultAnnual, carriedIn: kind === 'EARNED' ? r.int(0, 4) : 0,
      });
    }
  }
  await many(c, 'LeaveAllocation', allocations, (b) => p.leaveAllocation.createMany({ data: b }));

  const pastDays = workingDays(c, '2026-04-06', '2026-09-26');
  const futureDays = workingDays(c, '2026-10-05', '2026-10-30');
  const taken = new Map<string, Set<string>>();
  const apps: Prisma.LeaveApplicationCreateManyInput[] = [];

  const add = (
    who: { id: string; kind: 'teacher' | 'staff' }, kind: Kind, days: string[], status: 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'PENDING',
    half = false,
  ) => {
    const mine = taken.get(who.id) ?? new Set<string>();
    if (days.some((d) => mine.has(d))) return;
    days.forEach((d) => mine.add(d));
    taken.set(who.id, mine);
    const def = defs.get(kind)!;
    const first = days[0]!;
    apps.push({
      schoolId, type: kind, typeDefId: def.id, startDate: D(first), endDate: D(days[days.length - 1]!), halfDay: half,
      reason: r.pick(REASONS[kind]), status,
      reviewedById: status === 'PENDING' ? null : c.officeUserId,
      reviewedAt: status === 'PENDING' ? null : new Date(new Date(`${first}T00:00:00Z`).getTime() - 20 * 3_600_000),
      createdAt: new Date(new Date(`${first}T00:00:00Z`).getTime() - r.int(1, 4) * 86_400_000),
      ...(who.kind === 'teacher' ? { teacherId: who.id } : { staffId: who.id }),
    });
    if (status === 'APPROVED' && !half) {
      const set = c.leaveDays.get(who.id) ?? new Set<string>();
      days.forEach((d) => set.add(d));
      c.leaveDays.set(who.id, set);
    }
    // A half day is still a day on the register: marked, but not "on leave" for the whole day.
  };

  // The unpaid leaves are placed by hand so the payroll's deduction is not left to chance.
  const T = c.teachers; const S = c.staff;
  add({ id: T[3]!.id, kind: 'teacher' }, 'UNPAID', ['2026-07-14', '2026-07-15'], 'APPROVED');
  add({ id: T[9]!.id, kind: 'teacher' }, 'UNPAID', ['2026-08-03'], 'APPROVED');
  add({ id: S[8]!.id, kind: 'staff' }, 'UNPAID', ['2026-08-20', '2026-08-21'], 'APPROVED');
  add({ id: T[13]!.id, kind: 'teacher' }, 'UNPAID', ['2026-09-08'], 'APPROVED', true);

  const people = [
    ...c.teachers.map((t) => ({ id: t.id, kind: 'teacher' as const, n: r.int(1, 5) })),
    ...c.staff.map((s) => ({ id: s.id, kind: 'staff' as const, n: r.int(0, 3) })),
  ];
  for (const who of people) {
    for (let k = 0; k < who.n; k += 1) {
      const kind = ((x) => (x < 0.42 ? 'SICK' : x < 0.88 ? 'CASUAL' : 'EARNED'))(r.next()) as Kind;
      const len = ((x) => (x < 0.6 ? 1 : x < 0.85 ? 2 : 3))(r.next());
      const at = r.int(0, pastDays.length - 4);
      const days = pastDays.slice(at, at + len);
      const status = ((x) => (x < 0.87 ? 'APPROVED' : x < 0.95 ? 'REJECTED' : 'CANCELLED'))(r.next()) as 'APPROVED' | 'REJECTED' | 'CANCELLED';
      add(who, kind, days, status, len === 1 && r.chance(0.2));
    }
  }
  // Applications still waiting for a decision.
  for (const who of r.shuffle(people).slice(0, 7)) {
    const at = r.int(0, futureDays.length - 3);
    add(who, r.chance(0.6) ? 'CASUAL' : 'SICK', futureDays.slice(at, at + r.int(1, 2)), 'PENDING');
  }

  await many(c, 'LeaveApplication', apps, (b) => p.leaveApplication.createMany({ data: b }));
  void iso;
}

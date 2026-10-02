import type { Prisma } from '@skoolos/db';
import { Ctx, many } from './ctx';
import { D, addDays, clamp, iso } from './rng';

/** Mon–Sat working days that are not holidays, between two ISO dates (inclusive). */
export function workingDays(c: Ctx, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = D(from); d <= D(to); d = addDays(d, 1)) {
    if (d.getUTCDay() === 0 || c.holidays.has(iso(d))) continue;
    out.push(iso(d));
  }
  return out;
}

/**
 * Four months of register, one row per child per teaching day.
 *
 * Not independent coin flips: a child who is away tends to stay away for a few
 * days (illness), Mondays and the day after a holiday are worse, a few rainy
 * days empty every class, and a handful of children are away far more than the
 * rest. That is what makes the attendance report and the "frequent absentees"
 * list look like a school rather than noise.
 */
export async function studentAttendance(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const days = c.schoolDays;
  const rain = new Set(r.shuffle(days.filter((d) => d >= '2026-07-01' && d <= '2026-09-10')).slice(0, 4));
  const dayFactor = new Map<string, number>();
  days.forEach((d, i) => {
    let f = 1;
    const dow = D(d).getUTCDay();
    if (dow === 1) f *= 1.25;
    const prev = days[i - 1];
    if (prev && (D(d).getTime() - D(prev).getTime()) / 86_400_000 > 1.5 && dow !== 1) f *= 1.2; // after a holiday
    if (rain.has(d)) f *= 2.4;
    dayFactor.set(d, f);
  });

  const sectionTeacher = new Map(c.sections.map((s) => [s.id, s.classTeacher.userId]));
  const away = new Set<string>();
  let batch: Prisma.AttendanceCreateManyInput[] = [];
  let total = 0;
  const flush = async () => {
    if (!batch.length) return;
    await p.attendance.createMany({ data: batch });
    total += batch.length;
    batch = [];
  };

  for (const d of days) {
    const f = dayFactor.get(d)!;
    for (const s of c.students) {
      const small = s.gradeIdx <= 2 ? 1.2 : 1;
      let status: 'PRESENT' | 'ABSENT' | 'LATE' = 'PRESENT';
      if (away.has(s.id)) {
        if (r.chance(0.4)) status = 'ABSENT';
        else away.delete(s.id);
      } else if (r.chance(clamp(s.absentRate * f * small * 0.7, 0, 0.9))) {
        status = 'ABSENT';
        away.add(s.id);
      }
      if (status === 'PRESENT' && r.chance(0.025)) status = 'LATE';
      if (status !== 'ABSENT') away.delete(s.id);
      batch.push({
        schoolId, studentId: s.id, classSectionId: s.sectionId, date: D(d), status,
        markedById: sectionTeacher.get(s.sectionId)!, createdAt: new Date(`${d}T04:15:00.000Z`),
      });
      if (batch.length >= 5000) await flush();
    }
  }
  await flush();
  c.counts.Attendance = total;
}

/** Teachers and staff: present, a little late now and then, and ON_LEAVE exactly when a leave was approved. */
export async function staffAttendance(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const rows: Prisma.StaffAttendanceCreateManyInput[] = [];
  const people = [
    ...c.teachers.map((t) => ({ kind: 'teacher' as const, id: t.id, joined: t.joined })),
    ...c.staff.map((s) => ({ kind: 'staff' as const, id: s.id, joined: '2000-01-01' })),
  ];
  for (const d of c.schoolDays) {
    for (const person of people) {
      if (person.joined > d) continue;
      let status: 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE' = 'PRESENT';
      if (c.leaveDays.get(person.id)?.has(d)) status = 'ON_LEAVE';
      else if (r.chance(0.006)) status = 'ABSENT';
      else if (r.chance(0.03)) status = 'LATE';
      rows.push({
        schoolId, date: D(d), status, markedById: c.officeUserId, createdAt: new Date(`${d}T03:45:00.000Z`),
        ...(person.kind === 'teacher' ? { teacherId: person.id } : { staffId: person.id }),
      });
    }
  }
  await many(c, 'StaffAttendance', rows, (b) => p.staffAttendance.createMany({ data: b }));
}

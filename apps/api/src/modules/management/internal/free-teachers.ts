import type { TenantTx } from '@skoolos/db';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { isoWeekdayOf, toDateStr } from './leave-dates';
import { liveSlotWhere } from './timetable-date';

export interface CoverCandidate {
  id: string;
  name: string;
  /** Teaches the gap's subject somewhere in the timetable live that date. */
  teachesSubject: boolean;
  /** Covers already given to them that date. */
  coversThatDay: number;
}

export interface CoverGap {
  id: string;
  date: Date;
  periodId: string;
  classSectionId: string;
  originalTeacherId: string;
}

type Db = Pick<TenantTx, 'timetableSlot' | 'substitution' | 'staffAttendance' | 'teacher'>;

/**
 * WHO IS FREE TO COVER THIS PERIOD — the only place that question is
 * answered. The console's dropdown, the WhatsApp list, the candidates
 * endpoint and `assign()`'s own check all call this, so they can never
 * disagree (the web page used to compute its own `busySet` from the whole
 * week's timetable and offer teachers who were on leave).
 *
 * Out: the teacher on leave; anyone with a slot LIVE that date in that
 * period; anyone already covering that period that date (another gap — this
 * gap's own substitute stays offered); anyone ON_LEAVE that date; inactive
 * teachers. Order: teaches this subject, then fewest covers that day, then
 * name. Works with a tenant tx or the platform client — every where names the
 * school.
 */
export async function freeTeachersFor(db: Db, schoolId: string, gap: CoverGap): Promise<CoverCandidate[]> {
  const dateStr = toDateStr(gap.date);
  const live = liveSlotWhere(dateStr);
  const weekday = isoWeekdayOf(dateStr);

  const [slot, busy, covering, onLeave, teachers, load] = await Promise.all([
    db.timetableSlot.findFirst({
      where: { schoolId, classSectionId: gap.classSectionId, periodId: gap.periodId, dayOfWeek: weekday, ...live },
      select: { subjectId: true },
    }),
    db.timetableSlot.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, dayOfWeek: weekday, periodId: gap.periodId, ...live },
      select: { teacherId: true },
    }),
    db.substitution.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, date: gap.date, periodId: gap.periodId, substituteTeacherId: { not: null }, NOT: { id: gap.id } },
      select: { substituteTeacherId: true },
    }),
    db.staffAttendance.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, date: gap.date, status: 'ON_LEAVE', teacherId: { not: null } },
      select: { teacherId: true },
    }),
    db.teacher.findMany({
      take: LIST_CEILING.STRUCTURE,
      where: { schoolId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
    db.substitution.groupBy({
      by: ['substituteTeacherId'],
      where: { schoolId, date: gap.date, substituteTeacherId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const out = new Set<string>(
    [gap.originalTeacherId, ...busy.map((b) => b.teacherId), ...covering.map((c) => c.substituteTeacherId), ...onLeave.map((o) => o.teacherId)].filter(
      (x): x is string => !!x,
    ),
  );
  const free = teachers.filter((t) => !out.has(t.id));

  const teaches = new Set<string>();
  if (slot?.subjectId && free.length > 0) {
    const rows = await db.timetableSlot.findMany({
      take: LIST_CEILING.ACTIVITY,
      where: { schoolId, subjectId: slot.subjectId, teacherId: { in: free.map((t) => t.id) }, ...live },
      select: { teacherId: true },
      distinct: ['teacherId'],
    });
    for (const r of rows) teaches.add(r.teacherId);
  }
  const coversOf = new Map(load.map((g) => [g.substituteTeacherId, g._count._all]));

  return free
    .map((t) => ({
      id: t.id,
      name: `${t.firstName} ${t.lastName ?? ''}`.trim(),
      teachesSubject: teaches.has(t.id),
      coversThatDay: coversOf.get(t.id) ?? 0,
    }))
    .sort((a, b) => Number(b.teachesSubject) - Number(a.teachesSubject) || a.coversThatDay - b.coversThatDay || a.name.localeCompare(b.name));
}

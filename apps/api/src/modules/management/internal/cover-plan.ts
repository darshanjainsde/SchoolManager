import type { TenantTx } from '@skoolos/db';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { resolveAsOfDate } from '../../../common/dates/timetable-date';
import { isoWeekdayOf, toDateStr } from './leave-dates';
import type { CoverGap } from './free-teachers';

/**
 * WHERE EACH TEACHER STANDS FOR EACH OF MANY PERIODS — the batch form of
 * `freeTeachersFor`.
 *
 * `freeTeachersFor` answers "who is free for THIS period" for one gap. "Give
 * Rahul the rest of Priya's leave" asks the other way round, for up to a few
 * hundred gaps, and running the single question per gap is seven queries a
 * gap. This reads the same facts ONCE for the whole set and applies the same
 * five rules, so a 60-day leave is still four queries.
 *
 * The rules, identical to freeTeachersFor's and kept identical by a parity
 * test that runs both over one in-memory school (cover-plan.spec.ts):
 *  · the teacher on leave cannot cover their own gap        → ORIGINAL
 *  · an inactive teacher is never offered                   → INACTIVE
 *  · a slot LIVE that date in that period                   → TEACHING
 *  · already covering another class that date and period    → COVERING
 *  · ON_LEAVE that date                                     → ON_LEAVE
 * The gap's own substitute is not "covering elsewhere" — they are this gap's.
 *
 * "Live that date" is liveSlotWhere's rule, applied in memory:
 * effectiveFrom <= the IST day AND (effectiveTo IS NULL OR effectiveTo > it).
 */
export type CoverStanding =
  | { status: 'FREE' }
  | { status: 'TEACHING'; classSectionId: string }
  | { status: 'COVERING'; classSectionId: string }
  | { status: 'ON_LEAVE' }
  | { status: 'ORIGINAL' }
  | { status: 'INACTIVE' };

type Db = Pick<TenantTx, 'timetableSlot' | 'substitution' | 'staffAttendance' | 'teacher'>;

export interface CoverPlans {
  /** standing(teacherId, gapId) — every teacher asked about, every gap given. */
  standing(teacherId: string, gapId: string): CoverStanding;
  /** Covers a teacher already holds on a date (YYYY-MM-DD), any class. */
  coversOn(teacherId: string, dateStr: string): number;
}

const key = (a: string, b: string, c: string) => `${a}|${b}|${c}`;

export async function coverPlans(db: Db, schoolId: string, teacherIds: string[], gaps: CoverGap[]): Promise<CoverPlans> {
  const ids = [...new Set(teacherIds)];
  const dateStrs = [...new Set(gaps.map((g) => toDateStr(g.date)))];
  const dates = dateStrs.map((d) => new Date(d));
  const periodIds = [...new Set(gaps.map((g) => g.periodId))];
  const weekdays = [...new Set(dateStrs.map(isoWeekdayOf))];
  const gapIds = new Set(gaps.map((g) => g.id));

  const empty = ids.length === 0 || gaps.length === 0;
  const [teachers, slots, covers, onLeave] = empty
    ? [[], [], [], []]
    : await Promise.all([
        db.teacher.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, id: { in: ids } }, select: { id: true, isActive: true } }),
        // Every slot these teachers have in these periods on these weekdays,
        // in ANY version of the timetable; liveness is judged per date below.
        db.timetableSlot.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, teacherId: { in: ids }, periodId: { in: periodIds }, dayOfWeek: { in: weekdays } },
          select: { teacherId: true, periodId: true, dayOfWeek: true, classSectionId: true, effectiveFrom: true, effectiveTo: true },
        }),
        db.substitution.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, substituteTeacherId: { in: ids }, date: { in: dates } },
          select: { id: true, date: true, periodId: true, classSectionId: true, substituteTeacherId: true },
        }),
        db.staffAttendance.findMany({
          take: LIST_CEILING.ACTIVITY,
          where: { schoolId, teacherId: { in: ids }, date: { in: dates }, status: 'ON_LEAVE' },
          select: { teacherId: true, date: true },
        }),
      ]);

  const active = new Map(teachers.map((t) => [t.id, t.isActive]));
  const leaveOn = new Set(onLeave.map((a) => `${a.teacherId}|${toDateStr(a.date)}`));
  const coverCount = new Map<string, number>();
  for (const c of covers) {
    const k = `${c.substituteTeacherId}|${toDateStr(c.date)}`;
    coverCount.set(k, (coverCount.get(k) ?? 0) + 1);
  }
  // (teacher, date, period) → the covers they hold then, by gap id.
  const coverAt = new Map<string, { id: string; classSectionId: string }[]>();
  for (const c of covers) {
    const k = key(c.substituteTeacherId!, toDateStr(c.date), c.periodId);
    coverAt.set(k, [...(coverAt.get(k) ?? []), { id: c.id, classSectionId: c.classSectionId }]);
  }
  const gapById = new Map(gaps.map((g) => [g.id, g]));

  const liveOn = (s: { effectiveFrom: Date; effectiveTo: Date | null }, dateStr: string) => {
    const asOf = resolveAsOfDate(dateStr, new Date()).getTime();
    return s.effectiveFrom.getTime() <= asOf && (s.effectiveTo === null || s.effectiveTo.getTime() > asOf);
  };

  return {
    standing(teacherId, gapId) {
      const g = gapById.get(gapId);
      if (!g || !gapIds.has(gapId)) throw new Error(`coverPlans: gap ${gapId} was not part of the plan`);
      if (teacherId === g.originalTeacherId) return { status: 'ORIGINAL' };
      if (active.get(teacherId) !== true) return { status: 'INACTIVE' };
      const dateStr = toDateStr(g.date);
      const weekday = isoWeekdayOf(dateStr);
      const teaching = slots.find((s) => s.teacherId === teacherId && s.periodId === g.periodId && s.dayOfWeek === weekday && liveOn(s, dateStr));
      if (teaching) return { status: 'TEACHING', classSectionId: teaching.classSectionId };
      const elsewhere = (coverAt.get(key(teacherId, dateStr, g.periodId)) ?? []).find((c) => c.id !== g.id);
      if (elsewhere) return { status: 'COVERING', classSectionId: elsewhere.classSectionId };
      if (leaveOn.has(`${teacherId}|${dateStr}`)) return { status: 'ON_LEAVE' };
      return { status: 'FREE' };
    },
    coversOn(teacherId, dateStr) {
      return coverCount.get(`${teacherId}|${dateStr}`) ?? 0;
    },
  };
}

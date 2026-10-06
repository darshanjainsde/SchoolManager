import type { TenantTx } from '@skoolos/db';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { dateRangeInclusive, isoWeekdayOf, toDateStr } from './leave-dates';

/**
 * WHEN THE SCHOOL IS OPEN — one answer, for every feature that asks.
 *
 * Two things decide it and they live in different places: `School.workingDays`
 * (ISO weekdays, 1 = Monday … 7 = Sunday) says which days of the week the
 * school runs, and the `Holiday` table says which of those are closed anyway.
 * Leave already combined the two to count a working day; the diary's month
 * grid needs the same combination to say WHY a day is empty. Two functions
 * computing "is this a school day" would drift — a school adds a Saturday and
 * one screen learns about it — so there is one.
 *
 * It answers with the REASON, not just a boolean, because that is what a
 * reader needs: "Sunday" and "Diwali break" are different answers to "why is
 * there nothing here", and "nothing was written" is a third.
 */
export interface SchoolCalendar {
  /** ISO weekdays the school runs. Defaults to Monday–Saturday. */
  working: Set<number>;
  /** Date (`YYYY-MM-DD`) → the holiday's name, for every day it covers. */
  holidayByDate: Map<string, string>;
}

const WEEKDAY_NAME = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type CalendarDb = Pick<TenantTx, 'school' | 'holiday'>;

/** Holiday rows overlapping [from, to] — a single-day holiday has a null endDate. */
function holidaysOverlapping(tx: Pick<TenantTx, 'holiday'>, schoolId: string, from: Date, to: Date) {
  return tx.holiday.findMany({
    take: LIST_CEILING.STRUCTURE,
    // A holiday overlaps the window when it starts on or before the end AND
    // ends on or after the start.
    where: { schoolId, startDate: { lte: to }, OR: [{ endDate: null }, { endDate: { gte: from } }] },
    select: { name: true, startDate: true, endDate: true },
  });
}

/**
 * The calendar for one date range. `from`/`to` are `YYYY-MM-DD`.
 *
 * A multi-day holiday is expanded to every date it covers, so a caller can ask
 * about one date without knowing the range it belongs to.
 */
export async function schoolCalendar(
  tx: CalendarDb,
  schoolId: string,
  from: string,
  to: string,
): Promise<SchoolCalendar> {
  const [school, holidays] = await Promise.all([
    tx.school.findUnique({ where: { id: schoolId }, select: { workingDays: true } }),
    holidaysOverlapping(tx, schoolId, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`)),
  ]);

  const holidayByDate = new Map<string, string>();
  for (const h of holidays) {
    for (const d of dateRangeInclusive(toDateStr(h.startDate), toDateStr(h.endDate ?? h.startDate))) {
      // First one wins: two holidays on one date is a data accident, and
      // naming the earlier-created one is stabler than naming whichever came
      // back last.
      if (!holidayByDate.has(d)) holidayByDate.set(d, h.name);
    }
  }

  return {
    working: new Set(school?.workingDays ?? [1, 2, 3, 4, 5, 6]),
    holidayByDate,
  };
}

/** Every holiday date (`YYYY-MM-DD`) inside [from, to], ranges expanded. */
export async function holidayDates(tx: Pick<TenantTx, 'holiday'>, schoolId: string, from: Date, to: Date): Promise<Set<string>> {
  const out = new Set<string>();
  for (const h of await holidaysOverlapping(tx, schoolId, from, to)) {
    for (const d of dateRangeInclusive(toDateStr(h.startDate), toDateStr(h.endDate ?? h.startDate))) out.add(d);
  }
  return out;
}

/**
 * The WORKING `YYYY-MM-DD` dates in [start, end], in order: inside
 * `School.workingDays` and not on a `Holiday`. What a leave is counted on and
 * what its cover is opened on — a Sunday or Diwali inside the span has no
 * class to cover and no attendance to mark.
 */
export async function workingDates(tx: CalendarDb, schoolId: string, start: string, end: string): Promise<string[]> {
  const cal = await schoolCalendar(tx, schoolId, start, end);
  return dateRangeInclusive(start, end).filter((d) => cal.working.has(isoWeekdayOf(d)) && !cal.holidayByDate.has(d));
}

/**
 * Why the school was shut on this date, or `null` when it was open.
 *
 * The holiday's own name beats the weekday, because "Diwali break" tells a
 * parent something and "Sunday" does not — and a holiday that falls on a
 * Sunday is still worth naming.
 */
export function offReason(cal: SchoolCalendar, dateStr: string): string | null {
  const named = cal.holidayByDate.get(dateStr);
  if (named) return named;
  if (!cal.working.has(isoWeekdayOf(dateStr))) return WEEKDAY_NAME[isoWeekdayOf(dateStr)];
  return null;
}

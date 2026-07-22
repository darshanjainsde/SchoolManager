/**
 * Pure date math for leave applications and the coverage gaps they generate.
 * Kept dependency-free (no Prisma, no NestJS) so it's unit-testable directly,
 * mirroring `timetable-date.ts`.
 *
 * `LeaveApplication.startDate`/`endDate` and `Substitution.date` are all
 * `@db.Date` columns — plain calendar dates with no time component — so
 * everything here works in UTC-anchored date arithmetic (`new Date(
 * "YYYY-MM-DDT00:00:00Z")`) rather than IST-instant math like
 * `timetable-date.ts`'s `effectiveFrom`/`effectiveTo`. That keeps a leave
 * request for "2026-07-21..2026-07-23" meaning exactly those three calendar
 * days regardless of the server's local timezone.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateStr(s: string): boolean {
  return DATE_RE.test(s);
}

/** `YYYY-MM-DD` for a `@db.Date` value as Prisma/pg hands it back. */
export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * ISO weekday (1=Mon … 7=Sun) of a `YYYY-MM-DD` date string — matches the
 * `TimetableSlot.dayOfWeek` / `School.workingDays` convention used across the
 * timetable feature. Computed in UTC so it never shifts with the server's
 * local timezone.
 */
export function isoWeekdayOf(dateStr: string): number {
  const js = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

/** Every `YYYY-MM-DD` date from `start` to `end` inclusive. Empty if `end < start`. */
export function dateRangeInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const last = new Date(`${end}T00:00:00Z`).getTime();
  let cur = new Date(`${start}T00:00:00Z`);
  while (cur.getTime() <= last) {
    out.push(toDateStr(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

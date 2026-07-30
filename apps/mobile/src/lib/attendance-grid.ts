import type { AttendanceSummary, AttendanceStatusValue } from '@skoolos/types';

export interface AttendanceCell {
  day: number | null;
  status: AttendanceStatusValue | null;
}

/**
 * Builds a 7-wide Monday-first month grid (column 0 = Monday … column 6 =
 * Sunday, matching the web portal's `apps/web/app/portal/attendance/
 * page.tsx` ordering) from `summary.days`.
 *
 * Day-of-week for the 1st is computed with `Date.UTC` to match
 * `AttendanceDay.date`, which is a `YYYY-MM-DD` slice of a UTC-midnight
 * `@db.Date` column — using a local-time `Date` here could shift the
 * leading offset by a day. `getUTCDay()` is Sun-first (0 = Sun … 6 = Sat);
 * `(jsDay + 6) % 7` remaps it to Mon-first (0 = Mon … 6 = Sun) — the same
 * remap the web page uses on its local-time `getDay()`.
 */
export function buildAttendanceGrid(summary: AttendanceSummary): AttendanceCell[] {
  const year = Number(summary.month.slice(0, 4));
  const monthIndex = Number(summary.month.slice(5, 7)) - 1;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const jsDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const leading = (jsDay + 6) % 7;
  const byDay = new Map(summary.days.map((d) => [Number(d.date.slice(8, 10)), d.status]));

  const cells: AttendanceCell[] = [];
  for (let i = 0; i < leading; i++) cells.push({ day: null, status: null });
  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, status: byDay.get(day) ?? null });
  return cells;
}

/**
 * Shifts a `YYYY-MM` key by `delta` months, wrapping the year — pure
 * integer arithmetic, no `Date` construction, so a January→December (or
 * December→January) rollover can't be shifted by local-timezone DST/offset
 * quirks the way reconstructing a `Date` and reading back its fields can.
 */
export function shiftMonthKey(key: string, delta: number): string {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1 + delta;
  const wrappedYear = year + Math.floor(monthIndex / 12);
  const wrappedMonth = ((monthIndex % 12) + 12) % 12;
  return `${wrappedYear}-${String(wrappedMonth + 1).padStart(2, '0')}`;
}

/** "July 2026" for a `YYYY-MM` key — display only, local reconstruction is fine here. */
export function monthKeyLabel(key: string): string {
  const year = Number(key.slice(0, 4));
  const monthIndex = Number(key.slice(5, 7)) - 1;
  return new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** `YYYY-MM` for the device's current local month — used to disable "Next" at the latest month. */
export function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

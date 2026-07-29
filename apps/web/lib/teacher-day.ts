import type { TeacherDayEntry } from '@skoolos/types';

/** Minutes past midnight for a `HH:MM` wall-clock string. */
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export interface CurrentEntry {
  /** Index into `entries`, or -1 when nothing is current. */
  index: number;
  entry: TeacherDayEntry | null;
  /** Minutes elapsed into the current entry; 0 when nothing is current. */
  elapsed: number;
  /** Length of the current entry in minutes; 0 when nothing is current. */
  total: number;
}

/**
 * Which entry of the teacher's day contains `nowMinutes`.
 *
 * A period owns its start minute and not its end minute, so back-to-back
 * periods never both claim the boundary. Before the first period, after the
 * last, and inside a gap between them, nothing is current — the caller shows
 * "school hasn't started" / "day finished" rather than guessing.
 *
 * Entries are matched in the order given, not sorted by time first — callers
 * (the TeacherDay API contract) are expected to supply a chronological day.
 * If entries are out of order, the first array element whose range contains
 * `nowMinutes` wins, which may not be the chronologically-first match; see
 * teacher-day.test.ts for the pinned behaviour.
 *
 * A zero-length entry (`startTime === endTime`) can never be current: the
 * range check below requires `nowMinutes < end` and `nowMinutes >= start`,
 * which is unsatisfiable when start === end. That also means this function
 * never divides by a zero-length total — `total` is 0 only via the "nothing
 * is current" default, not from evaluating `end - start` on a matched entry.
 *
 * `minutesOfDay` does not wrap around midnight, so an entry whose `endTime`
 * is numerically before its `startTime` (e.g. '23:30' -> '00:15') can also
 * never be current, for any `nowMinutes` — the TeacherDay model represents a
 * single calendar date and does not support periods crossing into the next
 * day, so this is an accepted limitation rather than a bug to route around.
 */
export function currentEntry(entries: TeacherDayEntry[], nowMinutes: number): CurrentEntry {
  const index = entries.findIndex(
    (e) => nowMinutes >= minutesOfDay(e.startTime) && nowMinutes < minutesOfDay(e.endTime),
  );
  if (index === -1) return { index: -1, entry: null, elapsed: 0, total: 0 };
  const entry = entries[index];
  const start = minutesOfDay(entry.startTime);
  return {
    index,
    entry,
    elapsed: nowMinutes - start,
    total: minutesOfDay(entry.endTime) - start,
  };
}

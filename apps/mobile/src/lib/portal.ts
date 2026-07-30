export type {
  Announcement,
  AttendanceDay,
  AttendanceSummary,
  Holiday,
  Profile as StudentProfile,
} from '@skoolos/types';

/**
 * Day-of-month + short weekday name for a `Holiday.startDate`, read in UTC.
 * `startDate` is a plain calendar date stored at UTC midnight (mirrors
 * `AttendanceDay.date` handling in `(family)/attendance.tsx`) — reading it
 * back in the device's LOCAL timezone could roll the day backward for any
 * timezone with a negative UTC offset, so both fields are pinned to UTC.
 */
export function holidayDateParts(iso: string): { day: string; weekday: string } {
  const d = new Date(iso);
  return {
    day: String(d.getUTCDate()),
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
  };
}

/**
 * Coarse "time ago" for a notice's `createdAt`. Good enough for a mobile
 * feed — falls back to a short date once it's more than a week old.
 */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

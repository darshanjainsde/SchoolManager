/**
 * Shared date formatting for notification payloads. `notification.types.ts`
 * requires every date-shaped field to already be a human-facing string by
 * the time it reaches a payload — this is the one place that turns a `Date`
 * into that string, so every caller renders it identically (and never leaks
 * a raw ISO/UTC timestamp like `2026-08-01T03:30:00.000Z` into a parent's
 * inbox).
 *
 * The deployment region is `bom1` (India), so both formatters render in
 * `Asia/Kolkata` regardless of the server's own OS timezone.
 */

const TIME_ZONE = 'Asia/Kolkata';

const DATE_TIME_PARTS_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * `Intl.DateTimeFormat('en-IN', ...).format()` punctuates oddly out of the
 * box (an extra comma after the month, lowercase "am"/"pm"), so both
 * formatters below assemble the string themselves from `formatToParts`
 * rather than trusting the locale's default joining.
 */
function partsToMap(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return map;
}

/**
 * Formats a `Date` as a human-facing IST date+time string, e.g.
 * `Sat, 1 Aug 2026, 2:30 PM`. Used wherever a payload needs both the day and
 * the time (TEST_SCHEDULED.scheduledAt, TEST_REMINDER.scheduledAt).
 */
export function formatDateTimeIST(date: Date): string {
  const p = partsToMap(DATE_TIME_PARTS_FORMATTER.formatToParts(date));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}

/**
 * Formats a `Date` as a human-facing IST date-only string, e.g.
 * `Tue, 21 Jul 2026`. Used wherever a payload only ever needed the day
 * (ABSENCE_NOTICE.date).
 */
export function formatDateIST(date: Date): string {
  const p = partsToMap(DATE_PARTS_FORMATTER.formatToParts(date));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

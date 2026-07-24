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

import type { NotificationMessage } from './notification.types';

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

/** A push notification's rendered text — short enough for a lock-screen banner. */
export interface NotificationText {
  title: string;
  body: string;
}

/**
 * Renders a `NotificationMessage` as push-notification title/body text.
 * Deliberately a condensed cousin of `MailService`'s subject/text pairs (same
 * facts, no HTML, no boilerplate sign-off) — `PushChannel` is the only
 * consumer today, but any future non-email channel that just needs
 * plain-text title/body can reuse this instead of writing its own switch.
 */
export function formatNotification(message: NotificationMessage): NotificationText {
  switch (message.kind) {
    case 'TEST_SCHEDULED':
      return {
        title: `New test scheduled: ${message.payload.examTitle}`,
        body: `${message.payload.subjectName} — ${message.payload.scheduledAt}`,
      };
    case 'TEST_REMINDER': {
      const { daysUntil } = message.payload;
      return {
        title: `Reminder: ${message.payload.examTitle} in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`,
        body: `${message.payload.subjectName} — ${message.payload.scheduledAt}`,
      };
    }
    case 'RESULTS_PUBLISHED':
      return {
        title: `Results published: ${message.payload.examTitle}`,
        body: `${message.payload.subjectName} results are ready to view.`,
      };
    case 'ABSENCE_NOTICE':
      return {
        title: `Absence notice: ${message.payload.studentName}`,
        body: `Marked absent on ${message.payload.date} at ${message.payload.schoolName}.`,
      };
    default: {
      // Exhaustiveness guard — a new NotificationKind must be handled above.
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

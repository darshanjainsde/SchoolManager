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
/**
 * Formats a `Date` as a human-facing IST date+time string, e.g.
 * `Sat, 1 Aug 2026, 2:30 PM`. Used wherever a payload needs both the day and
 * the time (TEST_SCHEDULED.scheduledAt, TEST_REMINDER.scheduledAt).
 */
export declare function formatDateTimeIST(date: Date): string;
/**
 * Formats a `Date` as a human-facing IST date-only string, e.g.
 * `Tue, 21 Jul 2026`. Used wherever a payload only ever needed the day
 * (ABSENCE_NOTICE.date).
 */
export declare function formatDateIST(date: Date): string;
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
export declare function formatNotification(message: NotificationMessage): NotificationText;
//# sourceMappingURL=format.d.ts.map
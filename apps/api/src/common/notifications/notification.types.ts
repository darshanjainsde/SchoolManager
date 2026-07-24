/**
 * Notification contracts. THIS FILE IS AUTHORITATIVE: the payload interface
 * for a `NotificationKind` is declared here and consumed unchanged by both
 * ends of the wire — callers (`ExamsService`, `AttendanceService`,
 * `ExamRemindersService`, `AnnouncementsService`) build it, and `EmailChannel` hands it straight to
 * the matching `MailService.send*` composer with no cast in between.
 *
 * Adding an event = add one `{ KIND: PayloadInterface }` entry to
 * `NotificationPayloadMap`; `NotificationKind` and `NotificationMessage`
 * derive from it, and every channel's `switch` fails to compile until the new
 * kind is handled.
 */

/** Payload for TEST_SCHEDULED — mirrors `MailService.sendTestScheduled`. */
export interface TestScheduledPayload {
  schoolName: string;
  subjectName: string;
  examTitle: string;
  /** Human-facing date string; already formatted by the caller. */
  scheduledAt: string;
  classSectionName?: string;
}

/** Payload for TEST_REMINDER — mirrors `MailService.sendTestReminder`. */
export interface TestReminderPayload {
  schoolName: string;
  subjectName: string;
  examTitle: string;
  scheduledAt: string;
  daysUntil: number;
}

/** Payload for RESULTS_PUBLISHED — mirrors `MailService.sendResultsPublished`. */
export interface ResultsPublishedPayload {
  schoolName: string;
  subjectName: string;
  examTitle: string;
}

/**
 * Payload for ABSENCE_NOTICE — mirrors `MailService.sendAbsenceNotice`.
 * `studentName` is PER RECIPIENT (one absent child per notified guardian),
 * which is why `NotificationService.notify()` takes a payload per recipient
 * rather than one shared payload for the whole fan-out.
 */
export interface AbsenceNoticePayload {
  schoolName: string;
  studentName: string;
  date: string;
}

/**
 * Payload for ANNOUNCEMENT — mirrors `MailService.sendAnnouncement` (fired
 * by `AnnouncementsService.create` for both SCHOOL_ADMIN and TEACHER
 * callers). `className` is `null` for a whole-school announcement and the
 * targeted section's display name (e.g. `"5-B"`) otherwise; a multi-class
 * fan-out sends one payload per targeted section so each recipient sees
 * their own child's class, not a merged list.
 */
export interface AnnouncementPayload {
  schoolName: string;
  title: string;
  body: string;
  className: string | null;
}

/** The single source of truth mapping each event to its payload shape. */
export interface NotificationPayloadMap {
  TEST_SCHEDULED: TestScheduledPayload;
  TEST_REMINDER: TestReminderPayload;
  RESULTS_PUBLISHED: ResultsPublishedPayload;
  ABSENCE_NOTICE: AbsenceNoticePayload;
  ANNOUNCEMENT: AnnouncementPayload;
}

/**
 * The set of events the platform can notify a recipient about. Derived from
 * `NotificationPayloadMap` so a kind can never exist without a payload type.
 */
export type NotificationKind = keyof NotificationPayloadMap;

/** The payload type required for one specific kind. */
export type PayloadFor<K extends NotificationKind> = NotificationPayloadMap[K];

/**
 * A ready-to-deliver message: a discriminated union on `kind`, so a channel's
 * `switch (message.kind)` narrows `message.payload` to exactly one payload
 * interface. This is what makes a caller/composer field mismatch a compile
 * error rather than the literal string "undefined" in a parent's inbox.
 */
export type NotificationMessage = {
  [K in NotificationKind]: { kind: K; payload: PayloadFor<K> };
}[NotificationKind];

/** One recipient of a `notify()` fan-out, with the payload meant for them. */
export interface NotificationRecipient<K extends NotificationKind> {
  email: string;
  payload: PayloadFor<K>;
}

/**
 * A delivery mechanism (email today, WhatsApp later). `NotificationService`
 * fans a `notify()` call out over every configured channel — a new channel
 * is wired in purely via `NOTIFICATION_CHANNELS` (see notification.module.ts)
 * and requires no change to `NotificationService` or any caller.
 */
export interface NotificationChannel {
  /** Short identifier used in logs, e.g. 'email', 'whatsapp'. */
  name: string;
  /**
   * Sends one message to one recipient. Must resolve to `true`/`false` and
   * should not throw for ordinary delivery failures (mirroring
   * `MailService.send`, which logs-but-never-throws) — `NotificationService`
   * also tolerates a throwing/rejecting channel defensively, but a
   * well-behaved channel resolves `false` instead.
   */
  send(to: string, message: NotificationMessage): Promise<boolean>;
}

export interface NotifySummary {
  sent: number;
  failed: number;
}

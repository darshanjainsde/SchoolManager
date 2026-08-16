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

/**
 * Payload STORED in a `NotificationOutbox` row for kind `EXAM_SCHEDULED`
 * (`@skoolos/types` `NotificationOutboxKind`). Denormalised at write time by
 * `ExamsService.create()`, inside the same transaction as the `Exam` row, so
 * `NotificationOutboxService`'s drain never joins back to `Subject`/
 * `ClassSection` to render a push. A superset of `TestScheduledPayload` (same
 * fields the push text actually renders) plus `classSectionName`/`maxMarks`
 * kept for operator visibility (`lastError` debugging) and future richer copy
 * — `classSectionName` is narrowed from optional to required here since the
 * write site always has it in hand.
 */
export interface ExamScheduledOutboxPayload extends TestScheduledPayload {
  classSectionName: string;
  maxMarks: number;
}

/**
 * Payload STORED in a `NotificationOutbox` row for kind `RESULT_PUBLISHED`.
 * See `ExamScheduledOutboxPayload` — same reasoning, denormalised by
 * `ExamsService.publish()`. A superset of `ResultsPublishedPayload` plus
 * `classSectionName`/`maxMarks`.
 */
export interface ResultPublishedOutboxPayload extends ResultsPublishedPayload {
  classSectionName: string;
  maxMarks: number;
}

/**
 * Payload STORED in a `NotificationOutbox` row for kind `ASSIGNMENT_POSTED`
 * (`@skoolos/types` `NotificationOutboxKind`). Denormalised at write time by
 * `AssignmentsService.create()`, inside the same transaction as the
 * `Assignment` row — see `ExamScheduledOutboxPayload`'s docstring for the
 * same reasoning (the drain never joins back to `Subject`/`ClassSection`).
 *
 * DELIBERATELY NOT a `NotificationKind` of its own (not added to
 * `NotificationPayloadMap` below) — `AssignmentsService` never calls
 * `NotificationService.notify()` directly (no best-effort real-time email
 * for an assignment posting, only the guaranteed outbox push — the spec
 * only asks for "push on new assignment"). `NotificationOutboxService`'s
 * drain instead maps this payload onto the EXISTING `'ANNOUNCEMENT'`
 * `NotificationMessage` shape to render the push text, the same "reuse an
 * existing template rather than invent a new one" move `toNotificationMessage`
 * already makes for `EXAM_SCHEDULED`/`RESULT_PUBLISHED` → `TEST_SCHEDULED`/
 * `RESULTS_PUBLISHED`.
 */
export interface AssignmentPostedOutboxPayload {
  schoolName: string;
  subjectName: string;
  assignmentTitle: string;
  /** Human-facing date string; already formatted by the caller (formatDateIST). */
  dueDate: string;
  classSectionName: string;
}

/**
 * Payload STORED in a `NotificationOutbox` row for kind `MESSAGE_RECEIVED`
 * (Phase 4 Task 5 / T17). Unlike the broadcast kinds above, this row also
 * carries a `targetUserId` (the recipient) so the drain pushes to ONE person,
 * not the whole class section. Denormalised at send time so the drain never
 * joins back to Message/MessageThread. Renders through the existing
 * `ANNOUNCEMENT` push template (no dedicated NotificationKind).
 */
/**
 * Payload STORED in a `NotificationOutbox` row for kind `LIBRARY_NOTICE`
 * (`@skoolos/types` `NotificationOutboxKind`). One generic shape covers every
 * library push (due-soon nudge, fine reminder) — the title/body are composed
 * at write time by the library module, and the drain renders through the
 * EXISTING 'ANNOUNCEMENT' template, the same reuse move as
 * ASSIGNMENT_POSTED/MESSAGE_RECEIVED below. Rows always target a single
 * reader via `targetUserId`.
 */
export interface LibraryNoticeOutboxPayload {
  schoolName: string;
  title: string;
  body: string;
}

export interface MessageReceivedOutboxPayload {
  schoolName: string;
  /** Display name of whoever sent the message (the OTHER party to the recipient). */
  senderName: string;
  subjectName: string;
  /** Short slice of the message body. */
  preview: string;
  threadId: string;
}

/**
 * Payload for DIARY_REMARK — mirrors `MailService.sendDiaryRemark` (Phase 5·3).
 * The red-ink remark ALWAYS reaches the parent by email, even when the child
 * signs it in the app, so `remark` carries the teacher's words verbatim: the
 * email is the record, not a "you have a notification" nudge.
 */
export interface DiaryRemarkPayload {
  schoolName: string;
  studentName: string;
  teacherName: string;
  className: string;
  /** Human-facing date string; already formatted by the caller. */
  date: string;
  /** The remark itself, quoted in full. */
  remark: string;
}

/**
 * Payload for LOW_ATTENDANCE — mirrors `MailService.sendLowAttendance`
 * (Phase 5·3, the attendance bar's one-tap nudge). Private by construction:
 * one email per family, naming only their own child, never a class list.
 */
export interface LowAttendancePayload {
  schoolName: string;
  studentName: string;
  className: string;
  percent: number;
  threshold: number;
  /** Human-facing window, e.g. `1 Jul 2026 – 2 Aug 2026`. */
  period: string;
}

/** The single source of truth mapping each event to its payload shape. */
export interface NotificationPayloadMap {
  TEST_SCHEDULED: TestScheduledPayload;
  TEST_REMINDER: TestReminderPayload;
  RESULTS_PUBLISHED: ResultsPublishedPayload;
  ABSENCE_NOTICE: AbsenceNoticePayload;
  ANNOUNCEMENT: AnnouncementPayload;
  DIARY_REMARK: DiaryRemarkPayload;
  LOW_ATTENDANCE: LowAttendancePayload;
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

/**
 * One recipient of a `notify()` fan-out, with the payload meant for them.
 *
 * `schoolId` is REQUIRED, not optional: `User.email` is only unique
 * `@@unique([schoolId, email])` (packages/db/prisma/schema.prisma), never
 * globally, so any channel that looks a recipient up by email alone (see
 * `PushChannel`) risks a cross-tenant delivery unless it is handed the
 * sending school explicitly. Every resolver in recipients.ts already knows
 * the `schoolId` it queried within — this just carries that value the rest
 * of the way to the channel.
 */
export interface NotificationRecipient<K extends NotificationKind> {
  email: string;
  schoolId: string;
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
   * Sends one message to one recipient of `schoolId`. Must resolve to
   * `true`/`false` and should not throw for ordinary delivery failures
   * (mirroring `MailService.send`, which logs-but-never-throws) —
   * `NotificationService` also tolerates a throwing/rejecting channel
   * defensively, but a well-behaved channel resolves `false` instead.
   *
   * `schoolId` is passed even to channels (like `EmailChannel`) that don't
   * need it, so every channel gets it consistently and none can "forget" to
   * ask for it later.
   */
  send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean>;
}

export interface NotifySummary {
  sent: number;
  failed: number;
}

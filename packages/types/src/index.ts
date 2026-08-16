// Cross-cutting types shared by api/web/worker.
// Each phase adds DTOs/enums here; in Phase 0 we only export the domain event base.

export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  name: TName;
  occurredAt: string;
  tenantId?: string;
  payload: TPayload;
}

export type EventHandler<TEvent extends DomainEvent = DomainEvent> = (
  event: TEvent,
) => void | Promise<void>;

// ── Portal contracts ────────────────────────────────────────────────────────
// One declaration per wire shape, imported by the API, the web app and the
// mobile app. Anything both clients render belongs here: a divergence then
// fails the build instead of shipping as two different products.

/** The only three states `PUT /manage/attendance` accepts. */
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE'] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

export interface AttendanceMark {
  studentId: string;
  status: AttendanceStatusValue;
}

export interface SaveAttendanceRequest {
  classSectionId: string;
  /** YYYY-MM-DD, the school's local calendar day. */
  date: string;
  marks: AttendanceMark[];
}

export interface SaveAttendanceResponse {
  saved: number;
  absentees: number;
}

export interface MyClassSection {
  classSectionId: string;
  name: string;
  studentCount: number;
  /** True when held only as a substitute on the queried date. */
  covering: boolean;
}

export interface ClassDayStatus {
  classSectionId: string;
  name: string;
  total: number;
  present: number;
  taken: boolean;
  markedBy: string | null;
  markedAt: string | null;
}

export interface TeacherDayEntry {
  periodId: string;
  label: string;
  /** "HH:MM", the school's local clock. */
  startTime: string;
  endTime: string;
  /** CLASS = a lesson the teacher holds; BREAK = a school break; FREE = a
   * teaching period the teacher has no class in (a free period). FREE and BREAK
   * both carry `slot: null` and `register: null`. */
  kind: 'CLASS' | 'BREAK' | 'FREE';
  slot: {
    classSectionId: string;
    className: string;
    subjectId: string;
    subjectName: string;
    covering: boolean;
    coveringFor: string | null;
  } | null;
  register: { taken: boolean; present: number; total: number; markedBy: string | null } | null;
}

export interface TeacherDay {
  date: string;
  /** 1 = Monday … 7 = Sunday, matching TimetableSlot.dayOfWeek. */
  dayOfWeek: number;
  entries: TeacherDayEntry[];
}

export interface ClassNoteRow {
  id: string;
  body: string;
  createdAt: string;
  authorTeacherId: string;
}

export interface ClassTodoRow extends ClassNoteRow {
  done: boolean;
}

// ── Notes & To-dos tab (per-class history) ───────────────────────────────────
// The live "Right now" panel shows one class+subject for TODAY; this tab lets a
// teacher browse every class they teach and its full notes/to-dos history, and
// add more any time. One entry per (classSection, subject) the teacher teaches
// on their own timetable — one-day substitution cover is NOT listed here (it
// only surfaces the live panel on the covered day).

/** One class the teacher may keep notes for — a (section, subject) pair they teach. */
export interface NoteClass {
  classSectionId: string;
  /** e.g. "8-A". */
  className: string;
  subjectId: string;
  /** e.g. "Mathematics". */
  subjectName: string;
  /** True when the caller is the section's class teacher (shown as a label). */
  isClassTeacher: boolean;
  /** Total notes kept against this (section, subject), across all dates. */
  noteCount: number;
  /** Open (not-done) to-dos against this (section, subject). */
  openTodoCount: number;
}

/** A note in the history view — same as ClassNoteRow plus the class-day it belongs to. */
export interface ClassLogNote extends ClassNoteRow {
  /** `YYYY-MM-DD` — the class day this entry was filed under. */
  date: string;
}
export interface ClassLogTodo extends ClassLogNote {
  done: boolean;
}
/** `GET /manage/class-log?classSectionId&subjectId` — one class+subject, all dates, newest day first. */
export interface ClassLog {
  notes: ClassLogNote[];
  todos: ClassLogTodo[];
}

/**
 * School-wide policy for who may read a class's notes/to-dos — set by
 * `SCHOOL_ADMIN` via `GET`/`PUT /manage/school/class-note-visibility`.
 * `ALL_TEACHERS` is the default: it is today's (Phase 1) behaviour, so no
 * existing school's access changes on deploy.
 */
export const CLASS_NOTE_VISIBILITIES = ['ALL_TEACHERS', 'SUBJECT_TEACHERS'] as const;
export type ClassNoteVisibilityValue = (typeof CLASS_NOTE_VISIBILITIES)[number];

export const REGISTER_CHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RegisterChangeStatusValue = (typeof REGISTER_CHANGE_STATUSES)[number];

export interface RegisterChangeRow {
  id: string;
  classSectionId: string;
  className: string;
  date: string;
  reason: string;
  status: RegisterChangeStatusValue;
  requestedByTeacherId: string;
  requestedByName: string | null;
  reviewedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// ── Holidays ─────────────────────────────────────────────────────────────────

/**
 * A school holiday. `startDate`/`endDate` are `@db.Date` columns serialised as
 * ISO timestamps at UTC midnight — plain calendar dates, so read them in UTC.
 * Reading them in the browser's local zone rolls the day backwards for any
 * negative UTC offset.
 */
export const HOLIDAY_TYPES = ['PUBLIC', 'FESTIVAL', 'SCHOOL'] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];

export interface Holiday {
  id: string;
  name: string;
  type: HolidayType;
  startDate: string;
  endDate: string | null;
}

// ── Teacher profile ──────────────────────────────────────────────────────────

/** Mirrors TeachersService.me — the caller's own Teacher row, `GET /manage/teachers/me`. */
export interface TeacherProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** Subject names from TeacherSubject, alphabetical. */
  subjects: string[];
  /** Sections where they are the class teacher, as "7-B". */
  classTeacherOf: string[];
  /** Resolved from `photoAssetId` → MediaAsset.url — same avatar pipeline as the student `Profile`. */
  photoUrl: string | null;
}

// ── Announcements ────────────────────────────────────────────────────────────

/** A posted Announcement row — `GET /me/announcements` (student) and the shape `POST /manage/announcements` accepts back. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  classSectionId: string | null;
  createdAt: string;
}

/**
 * One of the CALLER'S OWN posted Announcement rows —
 * `GET /manage/announcements/mine` (`TEACHER` only), newest first.
 *
 * `AnnouncementsService.create` writes one `Announcement` ROW PER TARGETED
 * CLASS SECTION (or a single row with `classSectionId: null` for a
 * whole-school post) — there is no grouping table joining multiple targets
 * back into one logical "announcement". `PATCH`/`DELETE
 * /manage/announcements/:id` likewise each act on exactly one row by `id`.
 * So `AnnouncementMine` mirrors that: ONE ENTRY PER ROW with a SINGULAR
 * `classSectionId`/`className`, not a grouped/plural shape — grouping rows
 * that share a title+body+createdAt into one list item would break the 1:1
 * a list row needs with the edit/delete endpoint it calls.
 */
export interface AnnouncementMine {
  id: string;
  title: string;
  body: string;
  /** Null = whole-school post. */
  classSectionId: string | null;
  /** "{grade}-{section}", e.g. "5-A" — matches `MyClassSection.name`. Null iff `classSectionId` is null. */
  className: string | null;
  createdAt: string;
}

// ── Student portal: profile, attendance, timetable, exams, results ─────────

/** Mirrors PortalService.profile — the caller's own Student row, `GET /me/profile`. */
export interface Profile {
  firstName: string;
  lastName: string;
  admissionNo: string;
  /** RAF-00042-style student code — the login identifier and the add-a-child
   *  key (Phase 5·1). Null until a login has been created. */
  code: string | null;
  rollNo: string | null;
  className: string | null;
  photoUrl: string | null;
}

export interface AttendanceDay {
  /** `YYYY-MM-DD` */
  date: string;
  status: AttendanceStatusValue;
}

/** Mirrors PortalService.attendance — `GET /me/attendance`. */
export interface AttendanceSummary {
  /** `YYYY-MM` — echoes back the month actually queried. */
  month: string;
  /**
   * `YYYY-MM` — the earliest month worth walking back to: the earlier of the
   * student's first attendance mark and their registration month (IST).
   * Clients disable "previous month" at this floor. Optional so an older API
   * (which omits it) keeps newer app builds working — no floor, old behaviour.
   */
  earliestMonth?: string;
  /** present / (present + absent + late) * 100, rounded. 0 with no records. */
  percent: number;
  present: number;
  absent: number;
  late: number;
  days: AttendanceDay[];
}

/** Mirrors PortalService.exams — `GET /me/exams`, the student's own upcoming tests. */
export interface UpcomingExam {
  id: string;
  title: string;
  subjectName: string;
  scheduledAt: string;
  maxMarks: number;
  syllabus: string | null;
}

/** Mirrors PortalService.results — `GET /me/results`, the student's own published results. */
export interface PublishedResult {
  examId: string;
  title: string;
  subjectName: string;
  scheduledAt: string;
  marks: number;
  maxMarks: number;
  /** Mean of every published Result for this exam — never an individual mark. */
  classAverage: number;
}

/**
 * What `GET /manage/timetable/mine` and `GET /manage/timetable?classSectionId=`
 * both return — TimetableService.SLOT_INCLUDE, shared by the teacher grid and
 * the student portal (`GET /me/timetable`, via `PortalService.timetable` ->
 * `TimetableService.listForClass`). One include, one contract, three callers.
 */
export interface TimetableSlot {
  id: string;
  /** 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  period: { id: string; label: string; order: number; startTime: string; endTime: string };
  subject: { id: string; name: string; code: string };
  teacher: { id: string; firstName: string; lastName: string };
  classSection: { id: string; name: string; grade: { name: string } };
}

// ── Leave applications ───────────────────────────────────────────────────────

export const LEAVE_TYPES = ['SICK', 'CASUAL', 'EARNED', 'UNPAID', 'OTHER'] as const;
export type LeaveTypeValue = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveStatusValue = (typeof LEAVE_STATUSES)[number];

/** Mirrors LeaveService.apply/mine — a teacher's own LeaveApplication rows, `GET/POST /manage/leave`. */
export interface LeaveApplication {
  id: string;
  type: LeaveTypeValue;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatusValue;
  createdAt: string;
}

// ── Exams and results ────────────────────────────────────────────────────────

/** Mirrors ExamsService's Exam row — `GET/POST /manage/exams`. */
export interface Exam {
  id: string;
  classSectionId: string;
  subjectId: string;
  title: string;
  scheduledAt: string;
  syllabus: string | null;
  maxMarks: number;
  createdById: string;
  createdAt: string;
}

/** `GET /manage/exams?classSectionId=` already splits the list for the caller. */
export interface ExamList {
  upcoming: Exam[];
  past: Exam[];
}

/** One stored mark for an exam — `GET /manage/exams/:id/results`. `publishedAt` is null until publish() runs. */
export interface SavedResult {
  studentId: string;
  marks: number;
  publishedAt: string | null;
}

/** `PUT /manage/exams/:id/results` */
export interface SaveResultsResponse {
  saved: number;
}

/** `POST /manage/exams/:id/publish` */
export interface PublishResultsResponse {
  published: number;
}

// ── Assignments (T21) ─────────────────────────────────────────────────────────

export const ASSIGNMENT_ATTACHMENT_KINDS = ['pdf', 'image'] as const;
export type AssignmentAttachmentKind = (typeof ASSIGNMENT_ATTACHMENT_KINDS)[number];

/**
 * One uploaded file on an Assignment — the exact shape
 * `POST /manage/assignments/upload` returns, and what `Assignment.attachments`
 * stores an array of. Uploaded via a thin endpoint that delegates to the
 * shared `StorageService` (S3/MinIO), NOT the CMS media service — see
 * `AssignmentsController`'s docstring.
 */
export interface AssignmentAttachment {
  url: string;
  name: string;
  kind: AssignmentAttachmentKind;
}

/**
 * Mirrors AssignmentsService's Assignment row — `GET`/`POST /manage/assignments`
 * (teacher-facing). `seenCount` is the count of `AssignmentSeen` rows for
 * this assignment (`_count`, v1's only tracking signal — no submission
 * uploads) and is always included in the list, never a separate round trip.
 */
export interface Assignment {
  id: string;
  classSectionId: string;
  subjectId: string;
  title: string;
  instructions: string;
  /** `YYYY-MM-DD` (`@db.Date`) — a plain calendar date, no time component. */
  dueDate: string;
  attachments: AssignmentAttachment[];
  createdByTeacherId: string;
  createdAt: string;
  seenCount: number;
}

/** `GET /manage/assignments?classSectionId=` already splits the list for the caller, same shape as `ExamList`. */
export interface AssignmentList {
  upcoming: Assignment[];
  past: Assignment[];
}

/** `POST /manage/assignments/upload`'s response — one uploaded attachment, ready to include in a create payload's `attachments` array. */
export type AssignmentUploadResponse = AssignmentAttachment;

/**
 * Mirrors PortalService.assignments — `GET /me/assignments`, the student's
 * own class section's assignments split upcoming/past by `dueDate` (today
 * counts as upcoming — a same-day due date has not passed yet). `subjectName`
 * is resolved server-side (a student has no `/manage/subjects` access, unlike
 * the teacher-facing `Assignment` above which leaves that to the caller).
 */
export interface StudentAssignment {
  id: string;
  subjectId: string;
  subjectName: string;
  title: string;
  instructions: string;
  dueDate: string;
  attachments: AssignmentAttachment[];
  createdAt: string;
}

/** `GET /me/assignments`'s response shape. */
export interface StudentAssignmentList {
  upcoming: StudentAssignment[];
  past: StudentAssignment[];
}

// ── Messaging (T17) ───────────────────────────────────────────────────────────
// A student asks one of the teachers who actually teaches them (a subject, from
// the timetable) a question; the teacher replies. One thread per
// (student, teacher, subject). All ids are entity ids: `teacherId` is a
// Teacher.id (matching TimetableSlot.teacherId), `studentId` a Student.id.

export type MessageSenderRole = 'STUDENT' | 'TEACHER';

/** Max length of a single message body, enforced by the DTO on both send paths. */
export const MESSAGE_BODY_MAX = 2000;

/**
 * A teacher a student is allowed to message: one who holds a timetable slot for
 * the student's section teaching this subject this week. Derived server-side
 * from the timetable — the student picks from this set, never a free id.
 */
export interface MessageableTeacher {
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
}

/** One message within a thread. */
export interface MessageRow {
  id: string;
  senderRole: MessageSenderRole;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp the OTHER side read this message, or null if unread. */
  readAt: string | null;
}

/**
 * A thread as it appears in a list, on either side. `unreadCount` counts
 * messages sent by the OTHER party that the caller has not read yet.
 * `lastMessagePreview` is a short slice of the newest message body.
 */
export interface MessageThreadRow {
  id: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  subjectId: string;
  subjectName: string;
  /** ISO — threads sort by this, newest first ("response at the top"). */
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unreadCount: number;
}

/** A thread opened for reading, with its messages in chronological (ascending) order. */
export interface MessageThreadDetail {
  thread: MessageThreadRow;
  messages: MessageRow[];
}

/** Student starts or continues a thread — `POST /me/messages`. */
export interface StudentSendMessageInput {
  teacherId: string;
  subjectId: string;
  body: string;
}

/** Teacher replies within an existing thread — `POST /manage/messages/:threadId`. */
export interface TeacherReplyInput {
  body: string;
}

// ── Notification outbox (S6/S7 wiring — push-on-publish) ─────────────────────
// `NotificationOutbox` (packages/db) is a transactional outbox: ExamsService
// writes one row per event INSIDE the same `withTenant` transaction as the
// exam/result write, and a cron drain (NotificationOutboxService) sends push
// and marks it sent. `kind` is a plain `String` column, not a Prisma enum —
// this union + guard is the single source of truth for which values are
// legal, validated at write time (mirrors AttendanceStatusValue/
// HolidayTypeValue above, both also String columns).

/** The events that write a `NotificationOutbox` row today. */
export const NOTIFICATION_OUTBOX_KINDS = ['RESULT_PUBLISHED', 'EXAM_SCHEDULED', 'ASSIGNMENT_POSTED', 'MESSAGE_RECEIVED', 'LIBRARY_NOTICE'] as const;
export type NotificationOutboxKind = (typeof NOTIFICATION_OUTBOX_KINDS)[number];

/**
 * `@IsIn`-style runtime guard for `NotificationOutbox.kind`. There is no DTO
 * class-validator round-trip here — the row is written directly inside
 * `ExamsService.create()`/`publish()`'s own transaction — so this assertion
 * is what actually stops a typo'd kind string from ever reaching the
 * database, narrowing `string` to `NotificationOutboxKind` for the caller.
 */
export function assertNotificationOutboxKind(
  kind: string,
): asserts kind is NotificationOutboxKind {
  if (!(NOTIFICATION_OUTBOX_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Invalid NotificationOutbox kind: "${kind}"`);
  }
}

// ── In-app notifications (the bell + unread count) ───────────────────────────
// The per-user inbox behind the notification bell in BOTH portals. A row is
// written in the same transaction as the matching NotificationOutbox row (push)
// via `emitNotifications`, so the persistent inbox and the fire-and-forget push
// stay consistent. `kind` is a plain String column validated by the guard below
// (same pattern as NotificationOutboxKind above).

/** The in-app notification kinds surfaced by the bell. */
export const NOTIFICATION_KINDS = [
  'MESSAGE',
  'EXAM',
  'RESULT',
  'ASSIGNMENT',
  'ANNOUNCEMENT',
  'REQUEST_DECISION',
  'DIARY',
  'ATTENDANCE',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Runtime guard for `Notification.kind` (mirrors `assertNotificationOutboxKind`). */
export function assertNotificationKind(kind: string): asserts kind is NotificationKind {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Invalid Notification kind: "${kind}"`);
  }
}

/** One row in the notification list (`GET /me/notifications`). */
export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** Optional deep-link the client resolves to a route by role. */
  linkType: string | null;
  linkId: string | null;
  readAt: string | null; // ISO
  createdAt: string; // ISO
}

/** `GET /me/notifications` — newest first, plus the unread total for the bell. */
export interface NotificationListResult {
  notifications: NotificationRow[];
  unreadCount: number;
}

/** `GET /me/notifications/unread-count` and the two badge count endpoints. */
export interface UnreadCountResult {
  count: number;
}

/** `POST /me/photo` — self-uploaded avatar (Phase 5·0d). The url is what every
 *  portal renders wherever this person appears; the asset id is what lands in
 *  the person row's `photoAssetId`. */
export interface AvatarUploadResponse {
  assetId: string;
  photoUrl: string;
}

// ── Classes, subjects, roster ────────────────────────────────────────────────

/**
 * The projection every non-admin caller of `GET /manage/classes` actually
 * uses (picking a class on the attendance/tests/results screens). The real
 * response carries more (classTeacher, student count) for the admin screen —
 * this is a deliberate subset, not the full row.
 */
export interface ClassSectionSummary {
  id: string;
  name: string;
  grade: { name: string };
}

/** `GET /manage/subjects`. */
export interface Subject {
  id: string;
  code: string;
  name: string;
}

/**
 * Mirrors StudentsService's `roster` projection — the four fields a TEACHER
 * may read next to a studentId (attendance / exam-result entry), deliberately
 * excluding the minor's PII. `GET /manage/students?classSectionId=`.
 */
export interface RosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  rollNo: string | null;
}

// ── The Daily Diary (Phase 5·3) ──────────────────────────────────────────────
// The wire contracts for the diary page a teacher writes and a family reads at
// home. `DiaryEntryKind`/`DiaryAudience` mirror the Prisma enums of the same
// names (packages/db/prisma/schema.prisma) — declared here as plain string
// unions so the mobile app and the web app can share them without depending on
// the Prisma client.

/** ITEM = the ordinary diary line. REMARK = red ink, always signed for. */
export const DIARY_ENTRY_KINDS = ['ITEM', 'REMARK'] as const;
export type DiaryEntryKind = (typeof DIARY_ENTRY_KINDS)[number];

/** ALL = the whole class. SELECTED = the students named in the picker. */
export const DIARY_AUDIENCES = ['ALL', 'SELECTED'] as const;
export type DiaryAudience = (typeof DIARY_AUDIENCES)[number];

/** Runtime guard for a `kind` arriving from the wire or the database. */
export function assertDiaryEntryKind(kind: string): asserts kind is DiaryEntryKind {
  if (!(DIARY_ENTRY_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Invalid DiaryEntry kind: "${kind}"`);
  }
}

/** One named child on an entry — the shape the token picker renders. */
export interface DiaryStudentRef {
  studentId: string;
  name: string;
}

/**
 * One diary line as the TEACHER sees it (`GET /manage/diary`). `signedCount`
 * and `seenCount` are the at-a-glance receipts on a REMARK — how many families
 * have actually opened and signed it.
 */
export interface DiaryEntryRow {
  id: string;
  date: string; // YYYY-MM-DD
  kind: DiaryEntryKind;
  audience: DiaryAudience;
  body: string;
  subjectId: string | null;
  subjectName: string | null;
  authorTeacherId: string;
  authorName: string;
  /** Empty for `audience: ALL` — that entry addresses the whole section. */
  students: DiaryStudentRef[];
  seenCount: number;
  signedCount: number;
  /** Recipients this entry is waiting on — `students.length` for a SELECTED
   *  entry, the section roster size for an ALL one. */
  recipientCount: number;
  createdAt: string; // ISO
  /** Same-day entries are still editable; past pages are read-only ink. */
  editable: boolean;
}

/** `GET /manage/diary?classSectionId=&date=` — one class's page for one day. */
export interface DiaryPageResult {
  date: string;
  classSectionId: string;
  className: string;
  entries: DiaryEntryRow[];
}

/**
 * One diary line as the FAMILY sees it (`GET /me/diary`). No receipts for other
 * children — a family only ever sees their own signature state.
 */
export interface StudentDiaryEntry {
  id: string;
  date: string; // YYYY-MM-DD
  kind: DiaryEntryKind;
  body: string;
  subjectName: string | null;
  teacherName: string;
  /** True when this line names this child specifically rather than the class. */
  personal: boolean;
  signedAt: string | null; // ISO
  signedName: string | null;
  createdAt: string; // ISO
}

/** `GET /me/diary?date=` — the child's page, newest day first when undated. */
export interface StudentDiaryResult {
  entries: StudentDiaryEntry[];
  /** REMARKs still waiting for a parent's signature — the red dot's count. */
  unsignedCount: number;
}

/** `POST /me/diary/:id/sign` — the signature a parent types in the margin. */
export interface DiarySignResult {
  id: string;
  signedAt: string;
  signedName: string;
  unsignedCount: number;
}

// ── The attendance bar (Phase 5·3) ───────────────────────────────────────────

/** One child's attendance record over the queried window. */
export interface AttendanceRateRow {
  studentId: string;
  name: string;
  rollNo: string | null;
  present: number;
  total: number;
  /** Rounded whole percent; 0 when nothing has been marked yet. */
  percent: number;
  /** ISO timestamp of the last low-attendance notice sent about this child,
   *  or null — what greys out the "tell the family" tap during a cooldown. */
  lastNoticeAt: string | null;
}

/** `GET /manage/attendance/rates?classSectionId=&from=&to=`. */
export interface AttendanceRatesResult {
  classSectionId: string;
  className: string;
  from: string;
  to: string;
  /** School days that had a register taken in the window. */
  daysMarked: number;
  students: AttendanceRateRow[];
}

/** `POST /manage/attendance/notify-low` — the one-tap private nudge. */
export interface NotifyLowAttendanceResult {
  notified: number;
  /** Students skipped because they were told within the cooldown window. */
  skippedInCooldown: number;
  /** Days a family must wait before the same nudge can be sent again. */
  cooldownDays: number;
}

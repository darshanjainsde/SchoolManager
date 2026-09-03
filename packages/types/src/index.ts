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

// ── Leave policy (types, allocations, balances) ──────────────────────────────

/** Mirrors LeavePolicyService.types — `GET /manage/leave-policy/types`. */
export interface LeaveTypeDefRow {
  id: string;
  name: string;
  /** The built-in enum value this row mirrors; null for a school's custom type. */
  builtin: LeaveTypeValue | null;
  isPaid: boolean;
  /** Days/year that "apply defaults" grants. 0 = no standing quota. */
  defaultAnnual: number;
  /** Max unused days that survive a year close. 0 = lapse. */
  carryForwardCap: number;
  isActive: boolean;
}

/** One cell of the admin allotment grid. `allotted: null` = no grant (untracked). */
export interface LeaveAllocationCell {
  typeDefId: string;
  allotted: number | null;
  carriedIn: number;
  /** Working days of APPROVED leave this year — derived, never stored. */
  used: number;
  remaining: number | null;
}

/** Mirrors LeavePolicyService.grid — `GET /manage/leave-policy/allocations`. */
export interface LeaveAllocationGrid {
  academicYear: { id: string; name: string };
  types: Pick<LeaveTypeDefRow, 'id' | 'name' | 'isPaid' | 'defaultAnnual' | 'carryForwardCap'>[];
  teachers: { id: string; name: string; cells: LeaveAllocationCell[] }[];
}

/** One row of a teacher's own balances — `GET /manage/leave-policy/my-balance`. */
export interface LeaveBalanceRow {
  typeDefId: string;
  name: string;
  builtin: LeaveTypeValue | null;
  isPaid: boolean;
  allotted: number | null;
  carriedIn: number;
  used: number;
  remaining: number | null;
}

export interface LeaveBalanceResponse {
  academicYear: { id: string; name: string };
  balances: LeaveBalanceRow[];
}

/** Per-PENDING-application approve context — `GET /manage/leave-policy/pending-context`. */
export type LeavePendingContext = Record<
  string,
  { requestedDays: number; remaining: number | null; typeName: string | null }
>;

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
  // The librarian asking a class teacher to chase books that have not come
  // back. It is a separate kind from ANNOUNCEMENT because it is addressed to
  // ONE teacher about THEIR class and links to their own library list — and
  // because a school that mutes announcements must not mute this.
  'LIBRARY',
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

// ── Exam Hall ───────────────────────────────────────────────────────────────
// The seating screen's wire shapes. The engine that produces a plan lives in
// the API (`seating-engine.ts`); these are only what crosses the network.

/** The four rules the office can switch on. Anything more waits for a school to ask. */
export interface SeatingRules {
  /** Classmates never sit adjacent — left, right, front or back. */
  noClassmates: boolean;
  /** Columns alternate between the room's two grades, so a neighbour writes a different paper. */
  alternateCols: boolean;
  /** Consecutive roll numbers in one class are never adjacent. */
  spreadRolls: boolean;
  /** The last row stays empty so the teacher can stand behind everyone. */
  backRowFree: boolean;
}

export const DEFAULT_SEATING_RULES: SeatingRules = {
  noClassmates: true,
  alternateCols: true,
  spreadRolls: true,
  backRowFree: true,
};

/** `GET /manage/rooms` — a room as the office described it. */
export interface RoomRow {
  id: string;
  name: string;
  rows: number;
  cols: number;
  /** 1 or 2. Two only where the desk is a bench. */
  seatsPerDesk: number;
  /** "row:col", 0-based, for grid positions that hold no desk. */
  removedDesks: string[];
  /** Seats a student can actually be put in, with the back row kept spare. */
  capacity: number;
  /** Seating plans made for this room — a room in use is not safe to delete. */
  planCount: number;
}

/** One placed student. `seat` is the position across the whole row, 0-based. */
export interface PlannedSeat {
  row: number;
  seat: number;
  desk: number;
  /** "R3·S07" — what the desk sticker, the door list and the chart all say. */
  code: string;
  studentId: string;
  studentName: string;
  classSectionId: string;
  classLabel: string;
  roll: number | null;
}

/** What the generator could and could not do, in the words the office reads. */
export interface SeatingReport {
  capacity: number;
  seated: number;
  unseated: number;
  clashes: number;
  bent: number;
  notes: string[];
}

/** `POST /manage/seating/preview` and the body of a saved plan. */
export interface SeatingPlanResult {
  roomId: string;
  roomName: string;
  title: string;
  classSectionIds: string[];
  rules: SeatingRules;
  seed: number;
  seats: PlannedSeat[];
  report: SeatingReport;
}

/** `GET /manage/seating` — the saved plans list, without the seats. */
export interface SeatingPlanSummary {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  classSectionIds: string[];
  seated: number;
  createdAt: string;
}

/** `GET /manage/seating/:id` — a saved plan, whole. */
export interface SavedSeatingPlan extends SeatingPlanResult {
  id: string;
  createdAt: string;
  room: { rows: number; cols: number; seatsPerDesk: number; removedDesks: string[] };
}

// ── The Press (report cards + certificates) ──────────────────────────────────
// Printed documents with a register. `PressIssue.type` is a plain String
// column (the NotificationOutbox.kind pattern); this union + guard is the
// single source of truth for legal values, enforced at write time. The
// snapshot interfaces below are EXACTLY what `PressIssue.payload` stores and
// exactly what the sheets render — a reprint renders the snapshot, never a
// fresh compile, so the drawer copy and the screen copy cannot disagree.

/** The documents the Press can issue today. Adding one is a template + an entry here. */
export const PRESS_DOC_TYPES = ['REPORT_CARD', 'TC', 'BONAFIDE', 'CHARACTER'] as const;
export type PressDocType = (typeof PRESS_DOC_TYPES)[number];

/** Certificate types — every Press document except the report card. */
export type PressCertificateType = Exclude<PressDocType, 'REPORT_CARD'>;

/** Runtime guard for `PressIssue.type` (mirrors `assertNotificationOutboxKind`). */
export function assertPressDocType(type: string): asserts type is PressDocType {
  if (!(PRESS_DOC_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Invalid Press document type: "${type}"`);
  }
}

/**
 * CBSE 8-point scale. Derived from a percentage at compile time and stored
 * only inside issued snapshots — never as a column (the late-fee rule applied
 * to marks: one computation, so no two screens can disagree).
 */
export type GradeBand = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'D' | 'E';

/** `GET /manage/press/windows` — one reporting period ("Term I"). */
export interface ReportWindowRow {
  id: string;
  academicYearId: string;
  academicYearName: string;
  name: string;
  /** ISO dates (yyyy-mm-dd). */
  startDate: string;
  endDate: string;
  /** Report cards already issued under this window, across all classes. */
  issuedCount: number;
}

/** The school masthead every sheet prints. Resolved once at compile/issue time. */
export interface PressSchoolHeader {
  name: string;
  logoUrl: string | null;
  /** "12 MG Road, Jaipur, Rajasthan" — assembled from SchoolProfile, or null. */
  addressLine: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * One subject line on a report card, aggregated over every exam of that
 * subject inside the window. `marks: null` means the student has NO result
 * rows for the subject — rendered as "—", never as a zero: an absence of data
 * must not read as a failed paper.
 */
export interface ReportSubjectLine {
  subjectId: string;
  subjectName: string;
  /** How many exams fed this line — the office sees "Maths (3 tests)". */
  examCount: number;
  marks: number | null;
  maxMarks: number;
  pct: number | null;
  grade: GradeBand | null;
}

/** One student's compiled card — everything the sheet needs except the batch-level header. */
export interface ReportCardStudent {
  studentId: string;
  studentName: string;
  rollNo: string | null;
  admissionNo: string;
  subjects: ReportSubjectLine[];
  /** Sums over subjects that HAVE marks; null grade when nothing was marked at all. */
  overall: { marks: number; maxMarks: number; pct: number | null; grade: GradeBand | null };
  /** Marked school days inside the window. `pct: null` when nothing was marked. */
  attendance: { present: number; total: number; pct: number | null };
  remark: string | null;
  /** Set when a card for this window is already in the register. */
  issued: { serial: string; issuedAt: string } | null;
}

/** `GET /manage/press/report-cards/:windowId/:classSectionId` — the whole batch. */
export interface ReportCardBatch {
  window: ReportWindowRow;
  classSection: { id: string; label: string; classTeacherName: string | null };
  school: PressSchoolHeader;
  /** Column order — the union of subjects examined in this window for this class. */
  subjects: { subjectId: string; subjectName: string }[];
  students: ReportCardStudent[];
  /** Result rows inside the window that are still UNPUBLISHED. The compile
   *  ignores them (the portal's invariant), but a dash caused by an
   *  unpublished mark looks identical to one caused by absence — the office
   *  is told which it is before printing. */
  unpublishedCount: number;
}

/** `PressIssue.payload` for a REPORT_CARD. */
export interface ReportCardSnapshot {
  kind: 'REPORT_CARD';
  school: PressSchoolHeader;
  windowName: string;
  academicYearName: string;
  classLabel: string;
  classTeacherName: string | null;
  student: {
    name: string;
    rollNo: string | null;
    admissionNo: string;
    dob: string | null;
    guardianName: string | null;
  };
  subjects: ReportSubjectLine[];
  overall: ReportCardStudent['overall'];
  attendance: ReportCardStudent['attendance'];
  remark: string | null;
}

/**
 * Certificate wording the office can edit before issuing. Everything is
 * optional at the wire level; the service fills sensible defaults and the
 * snapshot stores what was actually printed.
 */
export interface CertificateFields {
  /** TC + CHARACTER: "good" unless the office says otherwise. */
  conduct?: string;
  /** TC: reason for leaving, e.g. "Parent's transfer". */
  reason?: string;
  /** Attended from / to — ISO dates, editable because records predate the software. */
  fromDate?: string;
  toDate?: string;
  /** The class named on the certificate ("Class VIII"), editable for left students. */
  classLabel?: string;
  /** BONAFIDE: what the certificate is for, e.g. "bank account opening". */
  purpose?: string;
  /** One free extra line, printed verbatim when present. */
  note?: string;
}

/** `GET /manage/press/certificates/prepare/:studentId` — the form, prefilled. */
export interface CertificatePrepare {
  student: {
    id: string;
    name: string;
    admissionNo: string;
    rollNo: string | null;
    classLabel: string | null;
    dob: string | null;
    guardianName: string | null;
    gender: string | null;
    /** When the record was created — the default "attended from", always editable. */
    onRollSince: string;
  };
  /** Live fee-ledger balance in paise. Zero for schools that keep fees elsewhere. */
  duesMinor: number;
  /** Certificates already issued to this student — reprint instead of re-issue. */
  existing: { id: string; type: PressDocType; serial: string; issuedAt: string }[];
}

/** `PressIssue.payload` for TC / BONAFIDE / CHARACTER. */
export interface CertificateSnapshot {
  kind: 'CERTIFICATE';
  type: PressCertificateType;
  school: PressSchoolHeader;
  student: CertificatePrepare['student'];
  fields: Required<Pick<CertificateFields, 'conduct' | 'classLabel'>> & CertificateFields;
  /** The ledger balance at issue time, and whether a TC was issued over it. */
  duesMinor: number;
  duesOverride: boolean;
}

export type PressSnapshot = ReportCardSnapshot | CertificateSnapshot;

/** `POST /manage/press/report-cards/issue` — what happened, per student. */
export interface IssueReportCardsResponse {
  issued: { studentId: string; serial: string }[];
  /** e.g. a card already issued for this window — issuing is idempotent, never doubled. */
  skipped: { studentId: string; reason: string }[];
}

/** One register row — `GET /manage/press/register`. */
export interface PressIssueRow {
  id: string;
  type: PressDocType;
  serial: string;
  studentId: string;
  studentName: string;
  issuedAt: string;
  /** Set when the entry was voided — struck through, never erased. */
  voidedAt: string | null;
}

export interface PressRegisterPage {
  items: PressIssueRow[];
  nextCursor: string | null;
}

/** `GET /me/report-cards` — the family's own issued cards. */
export interface MyReportCard {
  id: string;
  serial: string;
  windowName: string;
  academicYearName: string;
  issuedAt: string;
}

// ── The Morning Bell ─────────────────────────────────────────────────────────
// The principal's first look of the day, composed LIVE from tables that
// already exist — no stored digest, no cron (the compute-don't-store rule).
// Every line links to the screen that fixes it: the Bell is a table of
// contents for the morning, not a report.

/** `GET /manage/bell` — one composed read, IST day. */
export interface MorningBell {
  /** "Tuesday, 2 September" — composed server-side in IST. */
  dateLabel: string;
  /** Who is not in today, from the staff-attendance register. */
  staffAbsent: { name: string; kind: 'TEACHER' | 'STAFF'; status: 'ABSENT' | 'ON_LEAVE' }[];
  /** Today's substitution gaps nobody has covered yet. */
  uncovered: { className: string; periodLabel: string; teacherName: string }[];
  /** Gaps in the next 30 days still without a substitute — the early warning
   *  the old dashboard alert carried; the Bell must not lose it. */
  upcomingUncovered: number;
  /** Student absence so far today. `worst` is the class that needs a call. */
  students: {
    absent: number;
    marked: number;
    worst: { className: string; absent: number } | null;
  };
  /** Null when the school does not run the FEES feature — the card omits the row. */
  fees: {
    yesterdayMinor: number;
    monthMinor: number;
    awaitingReview: number;
  } | null;
  /** What the day holds. */
  today: {
    holiday: string | null;
    events: { title: string; time: string }[];
  };
  /** Queues with somebody waiting in them. */
  waiting: {
    leave: number;
    registerChanges: number;
    enquiries: number;
  };
}

// ── Sckools TV ───────────────────────────────────────────────────────────────
// The reception-screen loop: any TV with a browser and one URL. A VIEW over
// data the school already maintains — the TV is never a thing to feed.

/** `GET /public/tv?key=…` — everything one rotation shows. */
export interface TvScreen {
  school: {
    name: string;
    logoUrl: string | null;
    /** The school's own two colours — the TV wears the website's identity. */
    ps1: string;
    ps2: string;
    /** Active festival name from the site's festive theme, for the frame. */
    festival: string | null;
  };
  dateLabel: string;
  holiday: string | null;
  /** School-wide notices, newest first. */
  announcements: { title: string; body: string; when: string }[];
  eventsToday: { title: string; time: string; venue: string | null }[];
  eventsUpcoming: { title: string; when: string; venue: string | null }[];
  /** First names + class — the lobby celebrates them, the way schools do. */
  birthdays: { name: string; className: string | null }[];
  /** Gallery picks for the ambient panel. */
  gallery: string[];
}

/** `GET /manage/tv` — the admin's switch. */
export interface TvStatus {
  enabled: boolean;
  /** Full display URL when enabled, ready to open on the TV. */
  url: string | null;
}

// ── The Front Desk (dashboard) ───────────────────────────────────────────────
// The command bar, the Student 360 report, and the pulse tiles. All three are
// composed LIVE (compute-don't-store); the bar's hits carry their own one-tap
// actions so finding is doing.

/** `GET /manage/search?q=` — the command bar's hits. */
export interface ConsoleSearch {
  students: {
    id: string;
    name: string;
    classLabel: string | null;
    admissionNo: string;
    rollNo: string | null;
    isActive: boolean;
    /** Live ledger balance in paise; 0 for schools without FEES. */
    feesDueMinor: number;
  }[];
  teachers: { id: string; name: string }[];
  staff: { id: string; name: string; role: string }[];
  /** Register serials (TC/2026/0041 …) that contain the query. */
  serials: { id: string; type: PressDocType; serial: string; studentId: string; studentName: string }[];
}

/** `GET /manage/students/:id/report` — everything about one child, composed. */
export interface StudentReport {
  student: {
    id: string;
    name: string;
    classLabel: string | null;
    rollNo: string | null;
    admissionNo: string;
    code: string | null;
    dob: string | null;
    gender: string | null;
    guardianName: string | null;
    guardianPhone: string | null;
    isActive: boolean;
    onRollSince: string;
  };
  /** Session-to-date. `last20`: newest last, only days with a mark. */
  attendance: {
    present: number;
    total: number;
    pct: number | null;
    last20: { date: string; status: 'PRESENT' | 'ABSENT' | 'LATE' }[];
  };
  /**
   * The latest report window's compile for THIS child — published marks only,
   * the same computation the printed card uses. Null when no window exists or
   * the child has no class.
   */
  academics: {
    windowName: string;
    academicYearName: string;
    subjects: ReportSubjectLine[];
    overall: ReportCardStudent['overall'];
    remark: string | null;
  } | null;
  /** Null for schools without the FEES feature. */
  fees: {
    billedMinor: number;
    paidMinor: number;
    dueMinor: number;
    /** Latest first, capped. */
    ledger: { narration: string; occurredAt: string; kind: 'DEBIT' | 'CREDIT'; amountMinor: number }[];
  } | null;
  /** Every register entry for this child, newest first. */
  documents: { id: string; type: PressDocType; serial: string; issuedAt: string; voided: boolean }[];
  /** Open first, then recent returns. */
  library: { title: string; issuedOn: string; dueOn: string; returnedOn: string | null }[];
  /** For the printed sheet's masthead. */
  school: PressSchoolHeader;
}

/** `GET /manage/pulse` — the dashboard's living tiles. */
export interface DashboardPulse {
  attendance: {
    todayPct: number | null;
    present: number;
    marked: number;
    /** Last 14 marked school days, oldest first. */
    series: { date: string; pct: number }[];
  };
  /** Null for schools without FEES. */
  fees: {
    billedMinor: number;
    collectedMinor: number;
    outstandingMinor: number;
    owingFamilies: number;
  } | null;
  enquiries: {
    last7: number;
    prev7: number;
    uncontacted: number;
    /** 7 daily counts, oldest first. */
    series: { date: string; count: number }[];
  };
  roll: { students: number; teachers: number; classes: number };
}

// ── Press Orders (print fulfilment) ──────────────────────────────────────────
// Request → quote (price + promised date) → confirm → printing → dispatched →
// delivered. TEXT unions validated at write time; every transition is an
// event row and the timeline IS the event log.

export const PRINT_ORDER_KINDS = ['REPORT_CARDS', 'UPLOAD'] as const;
export type PrintOrderKind = (typeof PRINT_ORDER_KINDS)[number];

export const PRINT_ORDER_STATUSES = [
  'REQUESTED', 'QUOTED', 'CONFIRMED', 'DECLINED', 'CANCELLED',
  'PRINTING', 'DISPATCHED', 'DELIVERED',
] as const;
export type PrintOrderStatus = (typeof PRINT_ORDER_STATUSES)[number];

export function assertPrintOrderStatus(s: string): asserts s is PrintOrderStatus {
  if (!(PRINT_ORDER_STATUSES as readonly string[]).includes(s)) {
    throw new Error(`Invalid PrintOrder status: "${s}"`);
  }
}

/** Paper + finish, chosen by the school, priced by us. */
export interface PrintSpec {
  size: 'A4' | 'A5' | 'A3' | 'CR80';
  colour: 'COLOUR' | 'BW';
  sides: 'SINGLE' | 'DOUBLE';
  gsm: number;
  finish: 'NONE' | 'STAPLE' | 'SPIRAL' | 'SADDLE' | 'LAMINATE';
}

export interface PrintOrderRow {
  id: string;
  kind: PrintOrderKind;
  title: string;
  quantity: number;
  spec: PrintSpec;
  status: PrintOrderStatus;
  neededBy: string | null;
  quote: { priceMinor: number; promisedBy: string; note: string | null; quotedAt: string } | null;
  createdAt: string;
}

export interface PrintOrderEventRow {
  at: string;
  actor: 'SCHOOL' | 'SCKOOLS';
  action: PrintOrderStatus;
  note: string | null;
  data: Record<string, unknown> | null;
}

/** `GET /manage/press/orders/:id` — the school's view, timeline included. */
export interface PrintOrderDetail extends PrintOrderRow {
  note: string | null;
  deliverTo: { schoolName: string; address: string; contactName: string; phone: string };
  source:
    | { kind: 'REPORT_CARDS'; windowName: string; classLabel: string; issuedCount: number; serialFrom: string; serialTo: string }
    | { kind: 'UPLOAD'; filename: string; bytes: number };
  events: PrintOrderEventRow[];
}

/** One row on the operator desk — every order across every school. */
export interface OperatorOrderRow extends PrintOrderRow {
  schoolName: string;
  schoolSlug: string;
  city: string | null;
  deliverTo: PrintOrderDetail['deliverTo'];
  source: PrintOrderDetail['source'];
  orderNote: string | null;
  /** Confidential uploads carry the lock. */
  confidential: boolean;
  daysLate: number | null;
}

/** `GET /owner/print-orders/:id/artifact` — what the operator prints.
 *  REPORT_CARDS: the register's frozen snapshots (never recompiled).
 *  UPLOAD: a short-lived private link to the school's PDF. */
export type OperatorOrderArtifact =
  | { kind: 'REPORT_CARDS'; sheets: { serial: string; snapshot: ReportCardSnapshot }[] }
  | { kind: 'UPLOAD'; filename: string; url: string; expiresInSeconds: number };

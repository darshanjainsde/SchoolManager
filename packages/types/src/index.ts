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
  kind: 'CLASS' | 'BREAK';
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

// ── Student portal: profile, attendance, timetable, exams, results ─────────

/** Mirrors PortalService.profile — the caller's own Student row, `GET /me/profile`. */
export interface Profile {
  firstName: string;
  lastName: string;
  admissionNo: string;
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

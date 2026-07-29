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

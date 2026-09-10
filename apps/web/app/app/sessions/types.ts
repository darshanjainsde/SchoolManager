/** Web mirrors of the /manage/sessions shapes (the web app cannot import API types). */

export interface YearRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  sections: number;
  students: number;
}

export type PlanStatus = 'DRAFT' | 'SCHEDULED' | 'STARTED' | 'CANCELLED';
export type RollPolicy = 'KEEP' | 'ALPHABETICAL' | 'ADMISSION_NO';

export interface PlanView {
  id: string;
  status: PlanStatus;
  version: number;
  fromYearId: string;
  toYearId: string;
  passMarkPct: number;
  countExamIds: string[];
  sectionMap: Record<string, string>;
  rollPolicy: RollPolicy;
  copyTimetable: boolean;
  carryLeave: boolean;
  scheduledFor: string | null;
  fromYear: { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean };
  toYear: { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean };
}

export interface Overview {
  years: YearRow[];
  plan: PlanView | null;
}

export type DecisionKind = 'PROMOTE' | 'STAY' | 'PASS_OUT' | 'LEAVE';

export interface SessionStudentRow {
  studentId: string;
  rollNo: string | null;
  name: string;
  admissionNo: string;
  attendancePct: number | null;
  resultsPct: number | null;
  review: boolean;
  joinedSincePlan: boolean;
  decision: DecisionKind | null;
  toSectionId: string | null;
  leaveStatus: 'TRANSFERRED' | 'LEFT' | null;
  leaveReason: string | null;
  note: string | null;
  defaultDecision: 'PROMOTE' | 'PASS_OUT';
  stayToSectionId: string | null;
}

export interface Target {
  id: string;
  label: string;
  gradeId: string;
}

export interface RowsResponse {
  section: { id: string; label: string; gradeId: string } | null;
  targets: Target[];
  exams: { id: string; title: string; maxMarks: number; scheduledAt: string; counted: boolean }[];
  rows: SessionStudentRow[];
}

export interface ReviewPayload {
  counts: { promote: number; stay: number; passOut: number; leave: number; newAdmissions: number; unplaced: number; undecided: number };
  alumniWithoutEmail: number;
  libraryIssuesOut: number;
  sectionsWithoutClassTeacher: string[];
  version: number;
  status: PlanStatus;
  scheduledFor: string | null;
  copyTimetable: boolean;
  carryLeave: boolean;
  rollPolicy: RollPolicy;
  fromYear: { id: string; name: string; endDate: string };
  toYear: { id: string; name: string; startDate: string };
}

export interface RegisterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  email: string | null;
  fromSection: string | null;
  toSection: string | null;
  decision: DecisionKind;
  leaveStatus: string | null;
  decidedBy: string | null;
  appliedAt: string | null;
}

export interface ClassRow {
  id: string;
  name: string;
  gradeId?: string;
  grade: { name: string };
  classTeacherId?: string | null;
  classTeacher?: { firstName: string; lastName: string } | null;
  academicYear?: { id: string; name: string; isCurrent: boolean };
  _count?: { students: number };
}

export const classLabel = (c: { name: string; grade: { name: string } }) => `${c.grade.name} ${c.name}`;

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** "2025-26" → "2026-27"; otherwise bump the first four-digit year. Mirrors the API's nextSessionDefaults. */
export function nextSessionDefaults(from: { name: string; endDate: string }): { name: string; startDate: string; endDate: string } {
  const end = new Date(from.endDate);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
  const next = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate() - 1));
  const m = from.name.match(/^(\d{4})-(\d{2})$/);
  const name = m ? `${Number(m[1]) + 1}-${String((Number(m[2]) + 1) % 100).padStart(2, '0')}` : from.name.replace(/\d{4}/, (y) => String(Number(y) + 1));
  return { name, startDate: start.toISOString().slice(0, 10), endDate: next.toISOString().slice(0, 10) };
}

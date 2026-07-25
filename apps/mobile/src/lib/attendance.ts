/** Mirrors AttendanceService.ClassDayStatus (apps/api/.../attendance.service.ts). */
export interface ClassDayStatus {
  classSectionId: string;
  name: string;
  total: number;
  present: number;
  taken: boolean;
  markedBy: string | null;
  markedAt: string | null;
}

/** Mirrors AttendanceService.MyClassSection. */
export interface MyClassSection {
  classSectionId: string;
  name: string;
  studentCount: number;
}

/**
 * Device-local YYYY-MM-DD — NOT `Date#toISOString()`, which reports the UTC
 * calendar date and would silently roll a late-evening local date back (or
 * forward) a day for any timezone that isn't UTC.
 */
export function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface RosterToggle {
  studentId: string;
  present: boolean;
}

export interface SaveAttendancePayload {
  classSectionId: string;
  date: string;
  marks: Array<{ studentId: string; status: 'PRESENT' | 'ABSENT' }>;
}

/** Shapes the take-attendance screen's roster toggles into the PUT /manage/attendance contract. */
export function buildMarksPayload(
  classSectionId: string,
  date: string,
  roster: RosterToggle[],
): SaveAttendancePayload {
  return {
    classSectionId,
    date,
    marks: roster.map((r) => ({
      studentId: r.studentId,
      status: r.present ? 'PRESENT' : 'ABSENT',
    })),
  };
}

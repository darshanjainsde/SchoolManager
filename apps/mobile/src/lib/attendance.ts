import type { AttendanceStatusValue, SaveAttendanceRequest } from '@skoolos/types';

export type { ClassDayStatus, MyClassSection } from '@skoolos/types';

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

export interface RosterMark {
  studentId: string;
  status: AttendanceStatusValue;
}

/** Shapes the take-attendance screen's roster into the PUT /manage/attendance contract. */
export function buildMarksPayload(
  classSectionId: string,
  date: string,
  roster: RosterMark[],
): SaveAttendanceRequest {
  return {
    classSectionId,
    date,
    marks: roster.map((r) => ({ studentId: r.studentId, status: r.status })),
  };
}

import type { Exam, ExamList, RosterStudent, SavedResult, Subject } from '@skoolos/types';

export type { Exam, ExamList, RosterStudent, SavedResult, Subject };

/** Default time for a newly-scheduled test, 24h `HH:MM`. */
export const DEFAULT_SCHEDULE_TIME = '09:00';

/**
 * Steps a 24h `HH:MM` time string by `minutes` (negative goes backward),
 * wrapping within a single day — the time-of-day counterpart to
 * `shiftISO`'s local-calendar-arithmetic style (`lib/attendance.ts`).
 */
export function shiftTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  let total = (h * 60 + m + minutes) % (24 * 60);
  if (total < 0) total += 24 * 60;
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}`;
}

/**
 * Combines a device-local `YYYY-MM-DD` date and 24h `HH:MM` time into an
 * ISO string. Mirrors the web's own `new Date(form.scheduledAt).toISOString()`
 * (apps/web/app/teacher/tests/page.tsx), where the browser's
 * `datetime-local` input is likewise interpreted in the browser's local
 * time — building the `Date` from parsed local y/m/d/h/m parts (never
 * routed through a UTC-reading helper) keeps this correct regardless of the
 * device's timezone.
 */
export function toScheduledAtISO(dateISO: string, time: string): string {
  const [y, mo, d] = dateISO.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

/**
 * `maxMarks` must be a positive integer — mirrors both the web's `canCreate`
 * check and the server's own validation in `ExamsService.create`. Blank
 * input is never valid (there is no such thing as a 0-length positive
 * integer), so this does not just delegate to `Number(raw) > 0`.
 */
export function isValidMaxMarks(raw: string): boolean {
  if (raw.trim() === '') return false;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0;
}

export interface ParsedMark {
  studentId: string;
  marks: number;
}

/**
 * Shapes the raw per-student entry strings (kept as strings so a
 * half-typed value like `"0"` mid-keystroke never becomes `NaN`) into the
 * `PUT /manage/exams/:id/results` payload. Mirrors the web's exact `parsed`
 * derivation (apps/web/app/teacher/results/page.tsx): a blank entry is
 * dropped entirely — "not entered", never "entered as 0" — so a partial
 * save only ever touches the rows the teacher actually typed into.
 */
export function buildResultsPayload(
  students: RosterStudent[],
  entries: Record<string, string>,
): ParsedMark[] {
  return students
    .map((s) => ({ studentId: s.id, raw: entries[s.id] ?? '' }))
    .filter((e) => e.raw.trim() !== '')
    .map((e) => ({ studentId: e.studentId, marks: Number(e.raw) }));
}

/**
 * Every parsed mark must be finite and fall within `0..maxMarks` inclusive,
 * and there must be at least one entered mark — mirrors the web's own
 * `valid` check, and the server's own VALIDATION rule in
 * `ExamsService.saveResults`. This is the client-side guard that blocks Save
 * before the request ever fires.
 */
export function marksValid(parsed: ParsedMark[], maxMarks: number): boolean {
  return (
    parsed.length > 0 &&
    parsed.every((m) => Number.isFinite(m.marks) && m.marks >= 0 && m.marks <= maxMarks)
  );
}

/**
 * True when one raw entry, on its own, would fail `marksValid`'s per-row
 * check — used to flag an individual bad input as the teacher types, rather
 * than only rejecting the whole batch once Save is pressed. A blank entry is
 * never "bad" — it simply is not sent.
 */
export function markOutOfRange(raw: string, maxMarks: number): boolean {
  if (raw.trim() === '') return false;
  const n = Number(raw);
  return !Number.isFinite(n) || n < 0 || n > maxMarks;
}

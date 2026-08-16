/**
 * Pure policy math for the Library Wing — limits, due dates and fine
 * arithmetic. Kept dependency-free (no Prisma, no NestJS) so every rule the
 * counter enforces can be unit tested against fixed dates, exactly like
 * `management/internal/timetable-date.ts`.
 *
 * All dates in here are IST calendar days as `YYYY-MM-DD` strings — the
 * timezone a school day is judged in. Prisma `@db.Date` columns come back as
 * UTC-midnight `Date`s; `dateOnlyISO` is the one sanctioned way to turn them
 * into these strings.
 */

export type BorrowerKind = 'STUDENT' | 'TEACHER';

/** The subset of `LibrarySettings` the policy math reads. */
export interface LibraryRules {
  studentLoanLimit: number;
  teacherLoanLimit: number;
  loanDays: number;
  finePerDayRupees: number;
  graceDays: number;
  lostFeeRupees: number;
  fineTeachers: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` of a Prisma `@db.Date` value (stored as UTC midnight). */
export function dateOnlyISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `iso + days`, in calendar days. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnlyISO(d);
}

/** Whole calendar days from `aISO` to `bISO` (positive when b is later). */
export function diffDays(aISO: string, bISO: string): number {
  return Math.round(
    (Date.parse(`${bISO}T00:00:00.000Z`) - Date.parse(`${aISO}T00:00:00.000Z`)) / 86_400_000,
  );
}

export function isDateISO(s: string | undefined): s is string {
  return !!s && DATE_RE.test(s);
}

export function loanLimitFor(rules: LibraryRules, kind: BorrowerKind): number {
  return kind === 'TEACHER' ? rules.teacherLoanLimit : rules.studentLoanLimit;
}

/** OFF ⇒ teachers never see or owe fines — late OR lost. */
export function finesApply(rules: LibraryRules, kind: BorrowerKind): boolean {
  return kind === 'STUDENT' || rules.fineTeachers;
}

export function dueOnFor(rules: LibraryRules, issuedOnISO: string): string {
  return addDaysISO(issuedOnISO, rules.loanDays);
}

/** Days past due (0 when on time or early). */
export function lateDays(dueOnISO: string, todayISO: string): number {
  return Math.max(0, diffDays(dueOnISO, todayISO));
}

/**
 * The fine a still-open (or just-returned) loan has earned by `todayISO`.
 * Zero within the grace window, then `finePerDayRupees` per day beyond it.
 * Never negative; zero for teachers while `fineTeachers` is off.
 */
export function accruedFineRupees(
  rules: LibraryRules,
  kind: BorrowerKind,
  dueOnISO: string,
  todayISO: string,
): number {
  if (!finesApply(rules, kind)) return 0;
  const late = lateDays(dueOnISO, todayISO);
  return Math.max(0, late - rules.graceDays) * rules.finePerDayRupees;
}

const ACCESSION_PREFIX = 'B-';

/**
 * Next `B-NNNNN` after `lastAccession` (the school's lexicographic max, or
 * null for the first copy). Same shape as `StudentsService.allocateCode`:
 * lexicographic max works while numbers share a width, and `padStart` only
 * ever grows past 99,999 copies.
 */
export function nextAccessionNo(lastAccession: string | null): string {
  const last = lastAccession?.startsWith(ACCESSION_PREFIX)
    ? parseInt(lastAccession.slice(ACCESSION_PREFIX.length), 10)
    : 0;
  const next = (Number.isFinite(last) ? last : 0) + 1;
  return `${ACCESSION_PREFIX}${String(next).padStart(5, '0')}`;
}

export { ACCESSION_PREFIX };

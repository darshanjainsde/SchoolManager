import type { GradeBand } from '@skoolos/types';

/**
 * The CBSE 8-point scale, the one every Indian school recognises on sight.
 *
 * Grades are DERIVED here at compile time and stored only inside issued
 * snapshots — never as a column. Same reasoning as `late-fee.ts`: one
 * computation, called everywhere a grade is shown, so the office screen, the
 * printed card and the parent's copy cannot disagree.
 *
 * Boundaries are inclusive at the bottom of each band (a 91.0 is an A1, a
 * 90.99 an A2), matching how CBSE tables read. 33 is the pass floor — below
 * it is E, which schools print as "Needs improvement", not as a mark of shame;
 * the label is the sheet's business, the band is ours.
 */
const BANDS: { min: number; grade: GradeBand }[] = [
  { min: 91, grade: 'A1' },
  { min: 81, grade: 'A2' },
  { min: 71, grade: 'B1' },
  { min: 61, grade: 'B2' },
  { min: 51, grade: 'C1' },
  { min: 41, grade: 'C2' },
  { min: 33, grade: 'D' },
  { min: 0, grade: 'E' },
];

/**
 * Percentage → band. Callers pass `null` straight through: a subject with no
 * marks has no grade, and "no data" must never round down to an E.
 */
export function gradeForPct(pct: number | null): GradeBand | null {
  if (pct === null || Number.isNaN(pct)) return null;
  const clamped = Math.min(100, Math.max(0, pct));
  return BANDS.find((b) => clamped >= b.min)!.grade;
}

/**
 * Marks/max → whole-number percentage, guarding the zero denominator. A
 * subject whose exams total 0 max marks (a data-entry accident) yields null
 * rather than Infinity — the sheet prints "—" and the office sees the gap.
 */
export function pctOf(marks: number | null, maxMarks: number): number | null {
  if (marks === null || maxMarks <= 0) return null;
  return Math.round((marks / maxMarks) * 100);
}

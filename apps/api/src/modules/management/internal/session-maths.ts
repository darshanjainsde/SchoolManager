/**
 * Pure year-end maths (Active Roster, Track C). No I/O, no dates from the
 * clock — everything a plan needs to propose defaults and to flag children is
 * computed here so the service stays a thin transaction around it and the
 * numbers can be checked in a spec without a database.
 */

/** "2025-26" → "2026-27"; any other name has its first 4-digit year bumped. Dates follow the old year end. */
export function nextSessionDefaults(from: { name: string; startDate: Date; endDate: Date }): { name: string; startDate: Date; endDate: Date } {
  const startDate = new Date(Date.UTC(from.endDate.getUTCFullYear(), from.endDate.getUTCMonth(), from.endDate.getUTCDate() + 1));
  const endDate = new Date(Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), startDate.getUTCDate() - 1));
  const m = from.name.match(/^(\d{4})-(\d{2})$/);
  const name = m
    ? `${Number(m[1]) + 1}-${String((Number(m[2]) + 1) % 100).padStart(2, '0')}`
    : from.name.replace(/\d{4}/, (y) => String(Number(y) + 1));
  return { name, startDate, endDate };
}

export type GradeLadder = { ok: true; ordered: string[] } | { ok: false; reason: 'DUPLICATE_ORDER' | 'EMPTY' };

/** Grades in climbing order. Two grades on the same rung make promotion ambiguous, so that is refused, not guessed. */
export function gradeLadder(grades: { id: string; order: number }[]): GradeLadder {
  if (grades.length === 0) return { ok: false, reason: 'EMPTY' };
  const orders = new Set(grades.map((g) => g.order));
  if (orders.size !== grades.length) return { ok: false, reason: 'DUPLICATE_ORDER' };
  return { ok: true, ordered: [...grades].sort((a, b) => a.order - b.order).map((g) => g.id) };
}

export type SectionRef = { id: string; gradeId: string; name: string };
export const PASS_OUT = 'PASS_OUT' as const;
export type SectionMap = Record<string, string | typeof PASS_OUT>;

/**
 * Where each old section goes by default: the same-named section one grade
 * up, else the first section of that grade, and the top grade passes out.
 */
export function defaultSectionMap(from: SectionRef[], to: SectionRef[], ladder: string[]): SectionMap {
  const out: SectionMap = {};
  for (const f of from) {
    const i = ladder.indexOf(f.gradeId);
    const nextGrade = i >= 0 ? ladder[i + 1] : undefined;
    if (!nextGrade) {
      out[f.id] = PASS_OUT;
      continue;
    }
    const candidates = to.filter((t) => t.gradeId === nextGrade).sort((a, b) => a.name.localeCompare(b.name));
    const same = candidates.find((t) => t.name.toLowerCase() === f.name.toLowerCase());
    out[f.id] = (same ?? candidates[0])?.id ?? PASS_OUT;
  }
  return out;
}

/** Present + late over everything marked. Null when nothing was marked — "no data" is not 0%. */
export function attendancePct(marks: { status: 'PRESENT' | 'ABSENT' | 'LATE' }[]): number | null {
  if (marks.length === 0) return null;
  const present = marks.filter((m) => m.status !== 'ABSENT').length;
  return Math.round((present / marks.length) * 100);
}

/** Marks over max marks across the counted exams. Null when nothing counts. */
export function resultsPct(results: { marks: number; maxMarks: number }[]): number | null {
  const max = results.reduce((s, r) => s + r.maxMarks, 0);
  if (max === 0) return null;
  return Math.round((results.reduce((s, r) => s + r.marks, 0) / max) * 100);
}

export type RollPolicy = 'KEEP' | 'ALPHABETICAL' | 'ADMISSION_NO';
export const ROLL_POLICIES: readonly RollPolicy[] = ['KEEP', 'ALPHABETICAL', 'ADMISSION_NO'];

/** Roll numbers for one destination section. KEEP carries each child's old number, the others renumber from 1. */
export function assignRollNumbers(
  policy: RollPolicy,
  students: { id: string; firstName: string; lastName: string; admissionNo: string; rollNo: string | null }[],
): Map<string, string | null> {
  if (policy === 'KEEP') return new Map(students.map((s) => [s.id, s.rollNo]));
  const sorted = [...students].sort((a, b) =>
    policy === 'ALPHABETICAL'
      ? `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
      : a.admissionNo.localeCompare(b.admissionNo, undefined, { numeric: true }),
  );
  return new Map(sorted.map((s, i) => [s.id, String(i + 1)]));
}

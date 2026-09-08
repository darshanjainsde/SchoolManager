/**
 * A Hall of Fame batch is an academic session, the way CBSE schools name it:
 * the session runs 1 April to 31 March, so the batch that sat its exams in
 * March 2026 is "2025-26". We store the START year (2025) and print the
 * session everywhere a person reads it.
 */
export function batchLabel(startYear: number): string {
  const end = (startYear + 1) % 100;
  return `${startYear}-${String(end).padStart(2, '0')}`;
}

/** The sessions a school may open a batch for: next session first, back to `from`. */
export function batchYearOptions(currentYear: number, from = 1990): number[] {
  const out: number[] = [];
  for (let y = currentYear + 1; y >= from; y--) out.push(y);
  return out;
}

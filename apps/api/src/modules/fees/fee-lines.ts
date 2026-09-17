import { applyBps, clampConcession } from './money';

/**
 * THE ONE PLACE A CHILD'S FEE LINES ARE WORKED OUT.
 *
 * Billing (`FeeBillingService`) calls this to write an invoice. The family
 * page calls it to show what a term WILL cost before the office issues the
 * bill. Two callers, one function — if they ever disagreed, a family shown
 * ₹18,800 and billed ₹19,300 would be a phone call to the office. The spec
 * pins the rules the loop used to carry inline: an optional category needs
 * an opt-in; ONE_TIME is billed on a student's very first bill only; ANNUAL
 * only on the first term of the session; a term-specific amount beats the
 * "same every term" cell; concessions stack against what is left and can
 * never take a line negative; an RTE student's lines are never collectible.
 */
export interface PreviewLine {
  categoryId: string;
  categoryName: string;
  categoryDescription: string;
  grossMinor: number;
  concessionMinor: number;
  netMinor: number;
  concessionReason: string | null;
  isCollectible: boolean;
  order: number;
}

export interface LineCategory {
  id: string;
  name: string;
  description: string;
  frequency: 'PER_TERM' | 'ANNUAL' | 'ONE_TIME';
  isOptional: boolean;
  isCollectible: boolean;
}

export interface LineConcession {
  categoryId: string | null;
  percentBps: number | null;
  amountMinor: number | null;
  reason: string;
}

export interface PlanCell {
  gradeId: string;
  categoryId: string;
  termId: string | null;
  amountMinor: number;
}

/** `gradeId|categoryId|termId-or-*` — the grid cell a plan item fills. */
export const cellKey = (gradeId: string, categoryId: string, termId: string | null) =>
  `${gradeId}|${categoryId}|${termId ?? '*'}`;

/** The plan's items as a lookup; a term-specific amount and the every-term amount sit under different keys. */
export function buildCells(items: readonly PlanCell[]): Map<string, number> {
  const cells = new Map<string, number>();
  for (const i of items) cells.set(cellKey(i.gradeId, i.categoryId, i.termId), i.amountMinor);
  return cells;
}

export interface LinesInput {
  categories: readonly LineCategory[];
  cells: Map<string, number>;
  gradeId: string;
  termId: string;
  /** Is this the first term of the session? Decides ANNUAL categories. */
  isFirstTerm: boolean;
  /** Has this student ever had a bill? Decides ONE_TIME categories. */
  everBilled: boolean;
  optIns: ReadonlySet<string>;
  isRte: boolean;
  /** The student's concessions already narrowed to this term (termId null or equal). */
  concessions: readonly LineConcession[];
}

export function linesFor(input: LinesInput): PreviewLine[] {
  const { categories, cells, gradeId, termId, isFirstTerm, everBilled, optIns, isRte, concessions } = input;
  const lines: PreviewLine[] = [];
  let order = 0;

  for (const cat of categories) {
    if (cat.isOptional && !optIns.has(cat.id)) continue;
    if (cat.frequency === 'ONE_TIME' && everBilled) continue;
    if (cat.frequency === 'ANNUAL' && !isFirstTerm) continue;

    // A term-specific amount wins over the "same every term" row for the same cell.
    const gross = cells.get(cellKey(gradeId, cat.id, termId)) ?? cells.get(cellKey(gradeId, cat.id, null));
    if (!gross || gross <= 0) continue;

    // Concessions scoped to this category, plus whole-bill ones. Applied in
    // order, each against what is left, and clamped so a stack of waivers can
    // never take a line negative.
    const applicable = concessions.filter((c) => c.categoryId === cat.id || c.categoryId === null);
    let concession = 0;
    const reasons: string[] = [];
    for (const c of applicable) {
      const remaining = gross - concession;
      if (remaining <= 0) break;
      const amount = c.percentBps != null ? applyBps(remaining, c.percentBps) : (c.amountMinor ?? 0);
      const applied = clampConcession(remaining, amount);
      if (applied > 0) {
        concession += applied;
        reasons.push(c.reason);
      }
    }
    concession = clampConcession(gross, concession);

    lines.push({
      categoryId: cat.id,
      categoryName: cat.name,
      categoryDescription: cat.description,
      grossMinor: gross,
      concessionMinor: concession,
      netMinor: gross - concession,
      concessionReason: reasons.length ? reasons.join(' · ') : null,
      // An RTE student's collectible lines are recorded but never chased.
      isCollectible: cat.isCollectible && !isRte,
      order: order++,
    });
  }
  return lines;
}

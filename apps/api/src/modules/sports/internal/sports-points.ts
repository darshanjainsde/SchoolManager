/**
 * House points as a ledger. An award is a row; changing a result never edits
 * a row — it adds the difference, so the table is always a sum anyone can
 * audit. Pure helpers, one spec.
 */
import { placingPoints } from '@skoolos/types';

export interface Award { houseId: string; points: number; reason: string }

/** Points for a finished draw or final heat: one row per placed side that has a house. */
export function placingAwards(placings: { side: string; rank: number | null }[], houseOf: (side: string) => string | null, table: number[], reason: string): Award[] {
  const out: Award[] = [];
  for (const p of placings) {
    const houseId = houseOf(p.side);
    const points = placingPoints(p.rank, table);
    if (houseId && points) out.push({ houseId, points, reason: `${reason}: ${ordinal(p.rank!)}` });
  }
  return out;
}

export function winAward(side: string | null, houseOf: (side: string) => string | null, points: number, reason: string): Award[] {
  const houseId = side ? houseOf(side) : null;
  return houseId && points ? [{ houseId, points, reason }] : [];
}

/** What to write so the ledger moves from `before` to `after`: the per-house delta, marked as a correction when it takes points away. */
export function diffAwards(before: Award[], after: Award[]): Award[] {
  const sum = (rows: Award[]) => {
    const m = new Map<string, { houseId: string; reason: string; points: number }>();
    for (const r of rows) {
      const key = `${r.houseId}|${r.reason}`;
      m.set(key, { houseId: r.houseId, reason: r.reason, points: (m.get(key)?.points ?? 0) + r.points });
    }
    return m;
  };
  const b = sum(before);
  const a = sum(after);
  const out: Award[] = [];
  for (const key of new Set([...b.keys(), ...a.keys()])) {
    const delta = (a.get(key)?.points ?? 0) - (b.get(key)?.points ?? 0);
    if (delta === 0) continue;
    const src = (a.get(key) ?? b.get(key))!;
    out.push({ houseId: src.houseId, points: delta, reason: delta < 0 ? `${src.reason} (correction)` : src.reason });
  }
  return out;
}

export function ordinal(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

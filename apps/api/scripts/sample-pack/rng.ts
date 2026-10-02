/**
 * Deterministic randomness. The same seed builds the same school every time,
 * so a screenshot from yesterday still matches, and "the attendance of Aarav in
 * Class V-B" is a stable thing to write a bug report against.
 */
export interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  pick<T>(xs: readonly T[]): T;
  chance(p: number): boolean;
  normal(mean: number, sd: number): number;
  shuffle<T>(xs: readonly T[]): T[];
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
    normal: (mean: number, sd: number) => {
      const u = Math.max(next(), 1e-9);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle: <T>(xs: readonly T[]) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}

/** A stable small number from a string — a section's size must not depend on draw order. */
export function hashOf(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  return h;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** `YYYY-MM-DD` → a UTC-midnight Date, which is what every date column here holds. */
export const D = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const iso = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

export function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** An Indian mobile number: 10 digits starting 6–9. */
export function mobile(r: Rng): string {
  return `+91${r.int(6, 9)}${String(r.int(0, 999_999_999)).padStart(9, '0')}`;
}

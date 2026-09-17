/**
 * Money on the phone. Amounts cross the wire as `amountMinor` — paise, an
 * integer — and become rupees only here, at the edge. Nothing in a screen
 * does `/ 100` by hand: a stray division is how one screen ends up
 * disagreeing with another about what a family owes. Mirrors
 * apps/web/lib/fees.ts so both clients print the same string for the same
 * paise.
 */

/** Indian grouping by hand — `toLocaleString('en-IN')` is not reliable on
 *  Android's JS engine (Hermes ships a reduced ICU), and ₹2,25,77,600 is the
 *  kind of figure that gets grouped wrongly in silence. */
function groupIndian(whole: number): string {
  const s = String(whole);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

/** 1240000 → "₹12,400"; 1240050 → "₹12,400.50"; negative → "−₹…" (a credit). */
export function rupees(amountMinor: number): string {
  const neg = amountMinor < 0;
  const abs = Math.abs(Math.round(amountMinor));
  const whole = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = groupIndian(whole);
  const body = paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`;
  return `${neg ? '−' : ''}₹${body}`;
}

/** What a person types ("12,400", "12400.50", "₹ 800") → paise. Junk → 0. */
export function parseRupees(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Paise → the bare figure a field is edited as ("124" / "124.5"); 0 → "". */
export function rupeeInput(amountMinor: number): string {
  return amountMinor === 0 ? '' : String(amountMinor / 100);
}

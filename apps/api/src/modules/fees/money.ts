/**
 * Money arithmetic for the fees module. Everything is `minor` units — paise —
 * held in a JS number, which is exact for integers up to 2^53 and therefore
 * exact for every rupee amount a school will ever bill.
 *
 * The rule this file exists to enforce: rounding happens HERE and nowhere
 * else. A percentage applied ad-hoc at three call sites is three chances for
 * a bill to disagree with itself by a paisa, which is the kind of defect an
 * accountant finds and never forgets.
 */

/** Thrown rather than silently coercing — a non-integer paisa is a bug upstream. */
export class MoneyError extends Error {}

export function assertMinor(value: number, what = 'amount'): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new MoneyError(`${what} must be a whole number of paise, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${what} is outside the safe integer range`);
  }
  return value;
}

/**
 * Apply a basis-point percentage, rounding half away from zero.
 *
 * Half-up rather than banker's rounding on purpose: a parent reading a bill
 * expects 10% of ₹95.55 to be the same number every time, and "round half to
 * even" produces answers that look arbitrary when only one line is visible.
 * Consistency with the printed fee card beats statistical neutrality here.
 */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor, 'amountMinor');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new MoneyError(`bps must be an integer 0..10000, got ${bps}`);
  }
  const exact = (amountMinor * bps) / 10_000;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

/**
 * A concession can never exceed what is being charged. Clamping here rather
 * than at the call site means a 100%-plus concession, or a flat waiver larger
 * than the line, produces a zero line instead of a negative one that would
 * quietly pay for a different category.
 */
export function clampConcession(grossMinor: number, concessionMinor: number): number {
  assertMinor(grossMinor, 'grossMinor');
  assertMinor(concessionMinor, 'concessionMinor');
  if (concessionMinor < 0) return 0;
  return Math.min(concessionMinor, grossMinor);
}

/** ₹12,400 from 1240000. Indian digit grouping, no decimals when whole. */
export function formatMinor(amountMinor: number): string {
  assertMinor(amountMinor, 'amountMinor');
  const neg = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = rupees.toLocaleString('en-IN');
  const body = paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`;
  return `${neg ? '-' : ''}₹${body}`;
}

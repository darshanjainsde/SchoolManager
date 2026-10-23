/**
 * Refer & Earn: the pure rules. No IO, so every one of them is unit-tested
 * against the edge cases (a phone typed three ways, a school name with extra
 * spaces, a reward above the cap, a stage move backwards) without a database.
 */
import type { ReferralStatus } from '@skoolos/db';

/** The stages in the order a referral moves through them. */
export const STAGE_ORDER: ReferralStatus[] = ['LOGGED', 'ACCEPTED', 'CONTACTED', 'DEMO_DONE', 'PROPOSAL_SENT', 'WON', 'LIVE', 'PAYOUT_DUE', 'PAID'];
export const TERMINAL: ReferralStatus[] = ['PAID', 'REJECTED', 'LOST'];
/** Stages during which the school is "with this promoter" — a second referral is a duplicate. */
export const HOLDING: ReferralStatus[] = ['LOGGED', 'ACCEPTED', 'CONTACTED', 'DEMO_DONE', 'PROPOSAL_SENT', 'WON', 'LIVE', 'PAYOUT_DUE', 'PAID'];

/** The ladder keys the questionnaire offers; also the owner's suggestion map keys. */
export const EXPECT_KEYS = ['1-2', '3-5', '6-10', '10+'] as const;
export type ExpectKey = (typeof EXPECT_KEYS)[number];

/** "St. Mary's  Convent " / "jaipur" → "st marys convent|jaipur". */
export function schoolKey(name: string, city: string): string {
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  return `${norm(name)}|${norm(city)}`;
}

/** The last ten digits of whatever was typed: "+91 98765-43210", "098765 43210" and "9876543210" are one phone. */
export function phoneKey(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** A promoter code: up to six letters of the first name plus two digits, e.g. RAHUL42. */
export function promoterCode(name: string, salt: number): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const letters = first.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'SK';
  return `${letters}${String(10 + (Math.abs(salt) % 90))}`;
}

/** Can a referral move from `from` to `to` by the owner's hand? Forward only, never out of a terminal stage. */
export function canMove(from: ReferralStatus, to: ReferralStatus): boolean {
  if (TERMINAL.includes(from)) return false;
  // Once a payout exists (LIVE/PAYOUT_DUE) the referral cannot be closed by hand: the money path owns it.
  if (to === 'LOST' || to === 'REJECTED') return from !== 'LIVE' && from !== 'PAYOUT_DUE';
  const a = STAGE_ORDER.indexOf(from), b = STAGE_ORDER.indexOf(to);
  if (a < 0 || b < 0) return false;
  // PAYOUT_DUE and PAID are set by the money path (markLive / markPaid), not by hand.
  if (to === 'PAYOUT_DUE' || to === 'PAID') return false;
  return b > a;
}

/** The largest value a Postgres INTEGER column holds; every paise amount the API accepts is bounded by it. */
export const INT_MAX = 2_147_483_647;

/** The reward for one live school, in paise: pct of the invoice, capped. Never negative, never above the cap. */
export function rewardMinor(invoiceMinor: number, pct: number, capMinor: number | null): number {
  if (!(invoiceMinor > 0) || !(pct > 0)) return 0;
  const raw = Math.round((invoiceMinor * pct) / 100);
  return capMinor && capMinor > 0 ? Math.min(raw, capMinor) : raw;
}

/** TDS on a reward, in paise, at a whole-percent rate. */
export function tdsMinor(grossMinor: number, tdsPct: number): number {
  if (!(grossMinor > 0) || !(tdsPct > 0)) return 0;
  return Math.round((grossMinor * tdsPct) / 100);
}

/** The suggested rate for a questionnaire answer, from the owner's ladder. */
export function suggestedPct(ladder: unknown, expect: string | null | undefined): number | null {
  if (!ladder || typeof ladder !== 'object' || !expect) return null;
  const v = (ladder as Record<string, unknown>)[expect];
  return typeof v === 'number' && v > 0 && v <= 100 ? v : null;
}

/** The ladder as stored, or the default when the JSON is not what we wrote. */
export function ladderOf(raw: unknown): Record<ExpectKey, number> {
  const d: Record<ExpectKey, number> = { '1-2': 8, '3-5': 10, '6-10': 12, '10+': 15 };
  if (!raw || typeof raw !== 'object') return d;
  for (const k of EXPECT_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'number' && v >= 0 && v <= 100) d[k] = v;
  }
  return d;
}

/** A copy without the named keys — for stripping PAN and account numbers before a row leaves the API. */
export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const out = { ...obj } as T;
  for (const k of keys) delete out[k];
  return out;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

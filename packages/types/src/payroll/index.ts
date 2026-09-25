export * from './pack';
export * from './maths';
export * from './leave';
export * from './payslip-doc';
import { INDIA_PACK } from './india';
import type { CountryCode, PayPack } from './pack';

/**
 * Every pack we ship. India only, on purpose: the seam is what matters now,
 * and a second country is a real piece of work (the product still writes ₹
 * and Indian Standard Time into a lot of screens). Adding New Zealand is
 * adding a file here, not touching the engine.
 */
export const PAY_PACKS: Record<string, PayPack> = { IN: INDIA_PACK };

export const PAYROLL_COUNTRIES = Object.keys(PAY_PACKS);

export class UnknownPackError extends Error {}

export function packFor(country: CountryCode): PayPack {
  const p = PAY_PACKS[country];
  if (!p) {
    throw new UnknownPackError(
      `Salary is not set up for ${country} yet. Only ${PAYROLL_COUNTRIES.join(', ')} has a rule book so far.`,
    );
  }
  return p;
}

export function hasPack(country: string | null | undefined): boolean {
  return !!country && country in PAY_PACKS;
}

export { INDIA_PACK };

/**
 * COUNTRY PACKS — a country's pay law as DATA, never as branches in the
 * engine.
 *
 * Every rate, slab and ceiling below carries the date it took effect, because
 * they move under you: India's provident-fund ceiling went from ₹15,000 to
 * ₹25,000 on 17 September 2026, and a school running August's pay in October
 * must still use the old one. The engine is given a pack and a date; it never
 * knows which country it is computing.
 *
 * Money is always MINOR units (paise, cents) and never a float — the same rule
 * the fees module enforces in `money.ts`. Percentages are basis points, so
 * 12% is 1200 and there is no 0.12 anywhere to round badly.
 */

/**
 * ISO 3166-1 alpha-2 — the school's `countryCode`.
 *
 * A plain string, not a union of the packs we ship: a school row can hold a
 * country we have no rule book for yet, and `packFor` is what refuses it with
 * a sentence a person can act on.
 */
export type CountryCode = string;

/** A row that took effect on a date and holds until the next one. */
export interface Dated { from: string }

/** One slab of a progressive table. `upToMinor: null` is the top slab. */
export interface Slab { upToMinor: number | null; bps: number }

export interface TaxRegimeRules extends Dated {
  key: 'NEW' | 'OLD';
  label: string;
  slabs: Slab[];
  standardDeductionMinor: number;
  /** Tax falls to zero when taxable income is at or under `rebateUptoMinor`. */
  rebateUptoMinor: number;
  rebateMaxMinor: number;
  cessBps: number;
  /** Which declared deductions this regime actually allows. */
  allows: { hra: boolean; s80c: boolean; s80d: boolean; homeLoanInterest: boolean };
  s80cCapMinor: number;
  s80dCapMinor: number;
}

export interface RetirementRules extends Dated {
  /** The label a payslip prints — "Provident fund", "KiwiSaver". */
  label: string;
  /** Pay at or below this is what the contribution is computed on. `null` = no ceiling. */
  ceilingMinor: number | null;
  employeeBps: number;
  employerBps: number;
  /** India: the slice of the employer's share that goes to the pension scheme. */
  pensionBps?: number;
  pensionCapMinor?: number;
  /** Employer-side extras that are a cost but never a deduction. */
  employerExtraBps?: number;
  /** Below this headcount the scheme does not apply at all. */
  minHeadcount?: number;
}

export interface HealthRules extends Dated {
  label: string;
  /** Gross at or below this is covered; above it the person is out. */
  wageCeilingMinor: number;
  employeeBps: number;
  employerBps: number;
  minHeadcount: number;
  /** Regions that set a different headcount threshold. */
  minHeadcountByRegion?: Record<string, number>;
}

export type LocalTaxFrequency = 'MONTHLY' | 'HALF_YEARLY' | 'NONE';

/** India's professional tax: a state levy the employer deducts and remits. */
export interface LocalTaxRules extends Dated {
  label: string;
  /** Region code → its own table. A region absent from this map levies nothing. */
  byRegion: Record<string, {
    frequency: LocalTaxFrequency;
    /** Monthly gross up to `upToMinor` pays `amountMinor`. Last row has null. */
    slabs: { upToMinor: number | null; amountMinor: number }[];
    /** A month that charges a different amount — Maharashtra's February. */
    specialMonth?: { month: number; amountMinor: number };
    /** Months the deduction is taken in, for a half-yearly levy. */
    months?: number[];
    note?: string;
  }>;
}

export interface WageShareRule extends Dated {
  /**
   * India's Code on Wages: the EXCLUDED components (house rent, conveyance…)
   * may not exceed this share of total pay, so Basic + DA must be at least
   * the rest. Checked when a structure is saved, not when pay is run.
   */
  maxExcludedShareBps: number;
  note: string;
}

export interface GratuityRules extends Dated {
  label: string;
  /** 15/26 of last drawn Basic + DA per completed year. */
  numerator: number;
  denominator: number;
  minYears: number;
  /** Fixed-term staff qualify sooner. */
  minYearsFixedTerm: number;
  exemptMinor: number;
}

export interface FilingDuty {
  key: string;
  label: string;
  /** MONTHLY: due on `day` of the following month. Others as named. */
  cadence: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'EVERY_PAYDAY';
  dueDay?: number;
  /** For quarterly/annual: the months it falls due in. */
  dueMonths?: number[];
  note?: string;
}

/**
 * How sure we are of a number. Anything `CHECK` must be confirmed against the
 * source before a school relies on it, and the console says so on the screen
 * rather than pretending every figure is equally solid.
 */
export type Confidence = 'VERIFIED' | 'CHECK';

export interface PayPack {
  country: CountryCode;
  label: string;
  currency: string;
  /** 4 = April, so India's tax year is 1 Apr – 31 Mar. */
  taxYearStartMonth: number;
  /** Bumped whenever any table below changes. Recorded on every pay run. */
  version: string;
  /** The date we last checked these rules against their source. Shown to the school. */
  rulesAsAt: string;
  regionLabel: string;
  regions: { code: string; name: string }[];
  regimes: TaxRegimeRules[];
  defaultRegime: 'NEW' | 'OLD';
  retirement: RetirementRules[];
  health: HealthRules[];
  localTax: LocalTaxRules[];
  wageShare: WageShareRule[];
  gratuity: GratuityRules[];
  filings: FilingDuty[];
  /** Wages are due by this day of the following month. */
  payDueDay: number;
  /** Full-and-final settlement, in working days after leaving. */
  fnfWorkingDays: number;
  /** Figures we could not confirm from a primary source. */
  unverified: { what: string; why: string }[];
  /** The standard components a new school starts with. */
  standardComponents: StandardComponent[];
}

export type ComponentKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST';
export type ComponentCalc = 'FIXED' | 'PCT_OF_BASIC' | 'PCT_OF_GROSS' | 'BALANCE';

export interface StandardComponent {
  key: string;
  name: string;
  kind: ComponentKind;
  calc: ComponentCalc;
  /** For a PCT_* component. */
  rateBps?: number;
  taxable: boolean;
  /** Counts as "wages" for the 50% rule and as the base for retirement and gratuity. */
  isWages: boolean;
  retirementBase: boolean;
  healthBase: boolean;
  gratuityBase: boolean;
  /** Shrinks when someone is absent without pay. */
  prorate: boolean;
  order: number;
  hint?: string;
}

/** The row in a dated list that applies on `onISO` — the newest one not after it. */
export function asOf<T extends Dated>(rows: readonly T[], onISO: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.from <= onISO && (!best || r.from > best.from)) best = r;
  }
  return best;
}

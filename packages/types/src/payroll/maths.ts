import { asOf, type ComponentCalc, type PayPack, type StandardComponent, type TaxRegimeRules } from './pack';

/**
 * THE PAY ENGINE — pure arithmetic, no database, no country knowledge.
 *
 * Given a pack, a date and one person's structure, it produces the lines of
 * one payslip. Everything it needs to know about India is in the pack; swap
 * the pack and the same functions compute New Zealand.
 *
 * Money is minor units (paise) throughout, and rounding happens here and
 * nowhere else — the rule the fees module's `money.ts` already enforces. A
 * percentage applied ad-hoc at three call sites is three chances for a
 * payslip to disagree with itself by a paisa, which is the kind of defect an
 * accountant finds and never forgets.
 */

export class PayMathError extends Error {}

/**
 * Statutory contributions are filed in WHOLE RUPEES — both the provident fund
 * and ESI expect it, and a challan whose paise disagree with theirs is
 * rejected. This is why 8.33% of ₹15,000 is ₹1,250 on every EPFO page and not
 * the ₹1,249.50 the arithmetic gives.
 */
export const toWholeRupees = (minor: number) => Math.round(minor / 100) * 100;

/** Half away from zero, so 10% of ₹95.55 is the same number every time. */
export function bps(amountMinor: number, rate: number): number {
  if (!Number.isInteger(amountMinor)) throw new PayMathError(`amount must be whole paise, got ${amountMinor}`);
  if (!Number.isInteger(rate) || rate < 0 || rate > 1_000_000) throw new PayMathError(`bps out of range: ${rate}`);
  const exact = (amountMinor * rate) / 10_000;
  return Math.sign(exact) * Math.round(Math.abs(exact));
}

export interface StructureInput {
  /** What the school and the person agreed as monthly gross. */
  monthlyGrossMinor: number;
  /** componentKey → amount, for FIXED components the admin typed. */
  fixed: Record<string, number>;
}

export interface ResolvedLine {
  key: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST';
  amountMinor: number;
  taxable: boolean;
  isWages: boolean;
  retirementBase: boolean;
  healthBase: boolean;
  gratuityBase: boolean;
  prorate: boolean;
  order: number;
}

export type ComponentDef = Pick<StandardComponent,
  'key' | 'name' | 'kind' | 'calc' | 'rateBps' | 'taxable' | 'isWages' | 'retirementBase' | 'healthBase' | 'gratuityBase' | 'prorate' | 'order'>;

/**
 * Turn a structure into earning lines.
 *
 * Order matters and is fixed by the calculation, not by `order`: percentages
 * of gross first, then percentages of basic, then the fixed amounts, and the
 * BALANCE component last because it is whatever is left. A structure with two
 * BALANCE components is a bug, not a split.
 */
export function resolveEarnings(components: readonly ComponentDef[], input: StructureInput): ResolvedLine[] {
  const earnings = components.filter((c) => c.kind === 'EARNING');
  const balances = earnings.filter((c) => c.calc === 'BALANCE');
  if (balances.length > 1) throw new PayMathError('Only one component can take the balance.');

  const gross = input.monthlyGrossMinor;
  const out = new Map<string, number>();

  for (const c of earnings.filter((x) => x.calc === 'PCT_OF_GROSS')) out.set(c.key, bps(gross, c.rateBps ?? 0));
  const basic = out.get('basic') ?? input.fixed['basic'] ?? 0;
  for (const c of earnings.filter((x) => x.calc === 'PCT_OF_BASIC')) out.set(c.key, bps(basic, c.rateBps ?? 0));
  for (const c of earnings.filter((x) => x.calc === 'FIXED')) out.set(c.key, input.fixed[c.key] ?? 0);

  const assigned = [...out.values()].reduce((a, b) => a + b, 0);
  for (const c of balances) out.set(c.key, Math.max(0, gross - assigned));

  return earnings
    .map((c) => ({
      key: c.key, name: c.name, kind: 'EARNING' as const, amountMinor: out.get(c.key) ?? 0,
      taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
      healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * The Code on Wages test. Excluded pay — everything that is not "wages" —
 * may not be more than half of the total. Returns the shortfall in paise, so
 * a screen can say exactly how much must move into Basic, or null when the
 * structure is legal.
 */
export function wageShareShortfall(lines: readonly ResolvedLine[], pack: PayPack, onISO: string): { shortfallMinor: number; note: string } | null {
  const rule = asOf(pack.wageShare, onISO);
  if (!rule) return null;
  const earnings = lines.filter((l) => l.kind === 'EARNING');
  const total = earnings.reduce((a, l) => a + l.amountMinor, 0);
  if (total <= 0) return null;
  const excluded = earnings.filter((l) => !l.isWages).reduce((a, l) => a + l.amountMinor, 0);
  const allowed = bps(total, rule.maxExcludedShareBps);
  if (excluded <= allowed) return null;
  return { shortfallMinor: excluded - allowed, note: rule.note };
}

/** Days actually paid shrink the proratable lines; the rest hold. */
export function prorate(lines: readonly ResolvedLine[], daysPaid: number, daysInMonth: number): ResolvedLine[] {
  if (daysInMonth <= 0) throw new PayMathError('A month must have days.');
  if (daysPaid >= daysInMonth) return [...lines];
  const share = Math.max(0, Math.round((daysPaid / daysInMonth) * 10_000));
  return lines.map((l) => (l.prorate ? { ...l, amountMinor: bps(l.amountMinor, share) } : l));
}

// ── Statutory ───────────────────────────────────────────────────────────────

export interface RetirementResult { employeeMinor: number; employerMinor: number; pensionMinor: number; employerExtraMinor: number; onMinor: number }

/**
 * Provident fund. The contribution is computed on the retirement base, capped
 * at the pack's ceiling unless the school has agreed to contribute on the
 * whole amount — which is a per-person choice, not a rule.
 */
export function retirement(lines: readonly ResolvedLine[], pack: PayPack, onISO: string, opts: { optIn: boolean; onActual: boolean; headcount: number }): RetirementResult | null {
  const r = asOf(pack.retirement, onISO);
  const nil = { employeeMinor: 0, employerMinor: 0, pensionMinor: 0, employerExtraMinor: 0, onMinor: 0 };
  if (!r || !opts.optIn) return null;
  if (r.minHeadcount && opts.headcount < r.minHeadcount) return null;
  const base = lines.filter((l) => l.kind === 'EARNING' && l.retirementBase).reduce((a, l) => a + l.amountMinor, 0);
  if (base <= 0) return nil;
  const on = r.ceilingMinor != null && !opts.onActual ? Math.min(base, r.ceilingMinor) : base;
  const employee = toWholeRupees(bps(on, r.employeeBps));
  const employerTotal = toWholeRupees(bps(on, r.employerBps));
  const pension = r.pensionBps
    ? Math.min(toWholeRupees(bps(on, r.pensionBps)), r.pensionCapMinor ?? Number.MAX_SAFE_INTEGER)
    : 0;
  return {
    employeeMinor: employee,
    employerMinor: employerTotal - pension,
    pensionMinor: pension,
    employerExtraMinor: r.employerExtraBps ? toWholeRupees(bps(on, r.employerExtraBps)) : 0,
    onMinor: on,
  };
}

export interface HealthResult { employeeMinor: number; employerMinor: number; onMinor: number }

/** ESI. Covers people at or under the ceiling; the whole gross is the base. */
export function health(lines: readonly ResolvedLine[], pack: PayPack, onISO: string, opts: { exempt: boolean; headcount: number; region: string | null }): HealthResult | null {
  const h = asOf(pack.health, onISO);
  if (!h || opts.exempt) return null;
  const min = (opts.region ? h.minHeadcountByRegion?.[opts.region] : undefined) ?? h.minHeadcount;
  if (opts.headcount < min) return null;
  const base = lines.filter((l) => l.kind === 'EARNING' && l.healthBase).reduce((a, l) => a + l.amountMinor, 0);
  if (base > h.wageCeilingMinor) return null;
  return { employeeMinor: toWholeRupees(bps(base, h.employeeBps)), employerMinor: toWholeRupees(bps(base, h.employerBps)), onMinor: base };
}

/**
 * Professional tax. Many states levy none at all — Rajasthan among them — and
 * a half-yearly state only charges in its named months, so most months this
 * returns zero and that is correct, not a missing rule.
 */
export function localTax(grossMinor: number, pack: PayPack, onISO: string, opts: { region: string | null; month: number; exempt: boolean }): number {
  const t = asOf(pack.localTax, onISO);
  if (!t || !opts.region || opts.exempt) return 0;
  const table = t.byRegion[opts.region];
  if (!table || table.frequency === 'NONE' || table.slabs.length === 0) return 0;
  if (table.frequency === 'HALF_YEARLY' && !(table.months ?? []).includes(opts.month)) return 0;
  if (table.specialMonth && table.specialMonth.month === opts.month) return table.specialMonth.amountMinor;
  for (const s of table.slabs) {
    if (s.upToMinor == null || grossMinor <= s.upToMinor) return s.amountMinor;
  }
  return 0;
}

// ── Income tax ──────────────────────────────────────────────────────────────

export interface TaxDeclarationInput {
  /** Old regime only: rent paid in the year, and whether the city is a metro. */
  rentAnnualMinor?: number;
  metro?: boolean;
  s80cMinor?: number;
  s80dMinor?: number;
  homeLoanInterestMinor?: number;
  otherIncomeMinor?: number;
  previousEmployerSalaryMinor?: number;
  previousEmployerTdsMinor?: number;
}

export interface TaxResult {
  regime: 'NEW' | 'OLD';
  annualSalaryMinor: number;
  exemptionsMinor: number;
  standardDeductionMinor: number;
  deductionsMinor: number;
  taxableMinor: number;
  taxBeforeRebateMinor: number;
  rebateMinor: number;
  cessMinor: number;
  annualTaxMinor: number;
  /** Already deducted this year, here and by a previous employer. */
  alreadyPaidMinor: number;
  /** What is left to spread over the remaining months. */
  monthlyMinor: number;
}

/** The least of: allowance received, rent above a tenth of basic, and 40/50% of basic. */
export function houseRentExemption(hraMinor: number, basicMinor: number, rentAnnualMinor: number, metro: boolean): number {
  if (hraMinor <= 0 || rentAnnualMinor <= 0) return 0;
  const overTenth = Math.max(0, rentAnnualMinor - bps(basicMinor, 1000));
  const share = bps(basicMinor, metro ? 5000 : 4000);
  return Math.max(0, Math.min(hraMinor, overTenth, share));
}

function slabTax(taxableMinor: number, regime: TaxRegimeRules): number {
  let tax = 0;
  let lower = 0;
  for (const s of regime.slabs) {
    const upper = s.upToMinor ?? Number.MAX_SAFE_INTEGER;
    if (taxableMinor > lower) tax += bps(Math.min(taxableMinor, upper) - lower, s.bps);
    lower = upper;
    if (taxableMinor <= lower) break;
  }
  return tax;
}

/**
 * The year's tax, then a twelfth of what remains.
 *
 * Computed annually and spread rather than taxed month by month, because that
 * is what the law asks for and because it is the only way a raise in October
 * does not produce a March cliff. `monthsLeft` includes the month being run.
 */
export function incomeTax(args: {
  pack: PayPack;
  onISO: string;
  regimeKey: 'NEW' | 'OLD';
  /** Projected taxable salary for the whole year, from this employer. */
  annualTaxableSalaryMinor: number;
  annualBasicMinor: number;
  annualHraMinor: number;
  declaration?: TaxDeclarationInput;
  alreadyPaidMinor: number;
  monthsLeft: number;
}): TaxResult {
  const regime = pickRegime(args.pack, args.onISO, args.regimeKey);
  const d = args.declaration ?? {};
  const prev = d.previousEmployerSalaryMinor ?? 0;
  const gross = args.annualTaxableSalaryMinor + prev + (d.otherIncomeMinor ?? 0);

  const exemptions = regime.allows.hra
    ? houseRentExemption(args.annualHraMinor, args.annualBasicMinor, d.rentAnnualMinor ?? 0, !!d.metro)
    : 0;

  const deductions = regime.allows.s80c || regime.allows.s80d || regime.allows.homeLoanInterest
    ? (regime.allows.s80c ? Math.min(d.s80cMinor ?? 0, regime.s80cCapMinor) : 0)
      + (regime.allows.s80d ? Math.min(d.s80dMinor ?? 0, regime.s80dCapMinor) : 0)
      + (regime.allows.homeLoanInterest ? Math.min(d.homeLoanInterestMinor ?? 0, 200_000 * 100) : 0)
    : 0;

  const taxable = Math.max(0, gross - exemptions - regime.standardDeductionMinor - deductions);
  const before = slabTax(taxable, regime);
  const rebate = taxable <= regime.rebateUptoMinor ? Math.min(before, regime.rebateMaxMinor) : 0;
  const afterRebate = Math.max(0, before - rebate);
  const cess = bps(afterRebate, regime.cessBps);
  const annual = afterRebate + cess;

  const paid = args.alreadyPaidMinor + (d.previousEmployerTdsMinor ?? 0);
  const left = Math.max(0, annual - paid);
  const months = Math.max(1, args.monthsLeft);

  return {
    regime: regime.key,
    annualSalaryMinor: gross,
    exemptionsMinor: exemptions,
    standardDeductionMinor: regime.standardDeductionMinor,
    deductionsMinor: deductions,
    taxableMinor: taxable,
    taxBeforeRebateMinor: before,
    rebateMinor: rebate,
    cessMinor: cess,
    annualTaxMinor: annual,
    alreadyPaidMinor: paid,
    monthlyMinor: Math.round(left / months),
  };
}

export function pickRegime(pack: PayPack, onISO: string, key: 'NEW' | 'OLD'): TaxRegimeRules {
  const rows = pack.regimes.filter((r) => r.key === key);
  const r = asOf(rows, onISO);
  if (!r) throw new PayMathError(`No ${key} regime in the ${pack.country} pack on ${onISO}.`);
  return r;
}

// ── Gratuity ────────────────────────────────────────────────────────────────

/** 15/26 of the last Basic + DA per completed year; more than six months rounds up. */
export function gratuity(pack: PayPack, onISO: string, args: { lastWagesMinor: number; months: number; fixedTerm: boolean }): { payableMinor: number; years: number; eligible: boolean } {
  const g = asOf(pack.gratuity, onISO);
  if (!g) return { payableMinor: 0, years: 0, eligible: false };
  const wholeYears = Math.floor(args.months / 12);
  const extra = args.months % 12;
  const years = extra > 6 ? wholeYears + 1 : wholeYears;
  const need = args.fixedTerm ? g.minYearsFixedTerm : g.minYears;
  if (wholeYears < need) return { payableMinor: 0, years, eligible: false };
  const raw = Math.round((args.lastWagesMinor * g.numerator * years) / g.denominator);
  return { payableMinor: Math.min(raw, g.exemptMinor), years, eligible: true };
}

// ── The month ───────────────────────────────────────────────────────────────

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const periodStartISO = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;

/**
 * THE DATE EVERY RATE TABLE IS READ AT: the LAST day of the month being run,
 * not the first.
 *
 * Pay is earned across the month and filed after it, so a rule that starts
 * mid-month applies to that whole month's pay. The provident-fund ceiling rose
 * on 17 September 2026 and September's contributions are computed on the new
 * one — reading the tables at the 1st would have quietly used August's rule
 * for September, which is the exact class of bug dated tables exist to stop.
 */
export const periodEndISO = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

/** Which tax year a period belongs to, and how many of its months remain. */
export function taxYearOf(pack: PayPack, year: number, month: number): { taxYear: number; monthIndex: number; monthsLeft: number } {
  const start = pack.taxYearStartMonth;
  const taxYear = month >= start ? year : year - 1;
  const monthIndex = ((month - start) + 12) % 12; // 0-based within the tax year
  return { taxYear, monthIndex, monthsLeft: 12 - monthIndex };
}

/** "2026-27" for India, "2026" where the tax year is the calendar year. */
export function taxYearLabel(pack: PayPack, taxYear: number): string {
  return pack.taxYearStartMonth === 1 ? String(taxYear) : `${taxYear}-${String((taxYear + 1) % 100).padStart(2, '0')}`;
}

export type { ComponentCalc };

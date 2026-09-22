import {
  bps, resolveEarnings, wageShareShortfall, prorate, retirement, health, localTax,
  incomeTax, houseRentExemption, gratuity, taxYearOf, taxYearLabel, daysInMonth, PayMathError,
  periodEndISO, toWholeRupees,
} from './maths';
import { INDIA_PACK } from './india';
import type { ComponentDef } from './maths';

const L = (r: number) => r * 100;
const COMPONENTS: ComponentDef[] = INDIA_PACK.standardComponents.map((c) => ({
  key: c.key, name: c.name, kind: c.kind, calc: c.calc, rateBps: c.rateBps,
  taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
  healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
}));

const structure = (grossRupees: number, fixed: Record<string, number> = {}) =>
  resolveEarnings(COMPONENTS, { monthlyGrossMinor: L(grossRupees), fixed });

describe('rounding', () => {
  it('rounds half away from zero, so the same percentage always gives the same paisa', () => {
    expect(bps(9555, 1000)).toBe(956); // 10% of ₹95.55
    expect(bps(-9555, 1000)).toBe(-956);
  });
  it('refuses a fractional paisa rather than silently coercing it', () => {
    expect(() => bps(10.5, 1000)).toThrow(PayMathError);
  });
});

describe('the structure', () => {
  it('splits a gross into basic, house rent and the balance, and the parts add up exactly', () => {
    const lines = structure(40_000, { conveyance: L(1_600) });
    const by = Object.fromEntries(lines.map((l) => [l.key, l.amountMinor]));
    expect(by.basic).toBe(L(20_000));
    expect(by.hra).toBe(L(8_000));
    expect(by.conveyance).toBe(L(1_600));
    expect(by.special).toBe(L(10_400));
    expect(lines.reduce((a, l) => a + l.amountMinor, 0)).toBe(L(40_000));
  });

  it('never lets the balance go negative when the fixed parts already exceed the gross', () => {
    const lines = structure(20_000, { conveyance: L(50_000) });
    expect(lines.find((l) => l.key === 'special')!.amountMinor).toBe(0);
  });

  it('refuses two components both claiming the balance', () => {
    const two = [...COMPONENTS, { ...COMPONENTS[4], key: 'other' }];
    expect(() => resolveEarnings(two, { monthlyGrossMinor: L(10_000), fixed: {} })).toThrow(/balance/i);
  });
});

describe('the Code on Wages 50% rule', () => {
  it('passes the standard structure, where basic is exactly half', () => {
    expect(wageShareShortfall(structure(40_000), INDIA_PACK, '2026-09-01')).toBeNull();
  });

  it('names the shortfall in rupees when the allowances are too big a share', () => {
    const lines = [
      { key: 'basic', name: 'Basic', kind: 'EARNING' as const, amountMinor: L(10_000), taxable: true, isWages: true, retirementBase: true, healthBase: true, gratuityBase: true, prorate: true, order: 1 },
      { key: 'hra', name: 'HRA', kind: 'EARNING' as const, amountMinor: L(30_000), taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 3 },
    ];
    const r = wageShareShortfall(lines, INDIA_PACK, '2026-09-01');
    expect(r!.shortfallMinor).toBe(L(10_000)); // excluded 30k, allowed 20k
  });

  it('did not apply before the Codes commenced', () => {
    const lines = [
      { key: 'basic', name: 'Basic', kind: 'EARNING' as const, amountMinor: L(10_000), taxable: true, isWages: true, retirementBase: true, healthBase: true, gratuityBase: true, prorate: true, order: 1 },
      { key: 'hra', name: 'HRA', kind: 'EARNING' as const, amountMinor: L(30_000), taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 3 },
    ];
    expect(wageShareShortfall(lines, INDIA_PACK, '2025-01-01')).toBeNull();
  });
});

describe('loss of pay', () => {
  it('shrinks only what is proratable, and leaves a full month untouched', () => {
    const full = structure(31_000);
    expect(prorate(full, 31, 31)).toEqual(full);
    const half = prorate(full, 15, 30);
    expect(half.find((l) => l.key === 'basic')!.amountMinor).toBe(bps(L(15_500), 5000));
  });
});

describe('provident fund', () => {
  const lines = structure(40_000);

  it('uses the ₹15,000 ceiling for a month that ended before 17 September 2026', () => {
    const r = retirement(lines, INDIA_PACK, periodEndISO(2026, 8), { optIn: true, onActual: false, headcount: 40 })!;
    expect(r.onMinor).toBe(L(15_000));
    expect(r.employeeMinor).toBe(L(1_800));
    expect(r.pensionMinor).toBe(L(1_250));
  });

  it('uses the ₹25,000 ceiling for September 2026, because the month is read at its END', () => {
    const r = retirement(lines, INDIA_PACK, periodEndISO(2026, 9), { optIn: true, onActual: false, headcount: 40 })!;
    expect(r.onMinor).toBe(L(20_000)); // basic is 20,000, under the new ceiling
    expect(r.employeeMinor).toBe(L(2_400));
    expect(r.pensionMinor).toBe(toWholeRupees(bps(L(20_000), 833)));
  });

  it('caps the pension share, so a big basic does not push it past the cap', () => {
    const big = structure(120_000);
    const r = retirement(big, INDIA_PACK, '2026-09-20', { optIn: true, onActual: false, headcount: 40 })!;
    expect(r.onMinor).toBe(L(25_000));
    expect(r.pensionMinor).toBe(L(2_083));
  });

  it('contributes on the whole basic when the school has agreed to', () => {
    const big = structure(120_000);
    const r = retirement(big, INDIA_PACK, '2026-09-20', { optIn: true, onActual: true, headcount: 40 })!;
    expect(r.onMinor).toBe(L(60_000));
  });

  it('does not apply below the headcount, or when the person is not a member', () => {
    expect(retirement(lines, INDIA_PACK, '2026-09-20', { optIn: true, onActual: false, headcount: 8 })).toBeNull();
    expect(retirement(lines, INDIA_PACK, '2026-09-20', { optIn: false, onActual: false, headcount: 40 })).toBeNull();
  });
});

describe('ESI', () => {
  it('covers a helper under the ceiling, in whole rupees the way ESIC files it', () => {
    const r = health(structure(18_000), INDIA_PACK, '2026-09-01', { exempt: false, headcount: 30, region: 'RJ' })!;
    expect(r.employeeMinor).toBe(toWholeRupees(bps(L(18_000), 75)));
    expect(r.employerMinor).toBe(toWholeRupees(bps(L(18_000), 325)));
  });
  it('drops a teacher above the ₹21,000 ceiling', () => {
    expect(health(structure(40_000), INDIA_PACK, '2026-09-01', { exempt: false, headcount: 30, region: 'RJ' })).toBeNull();
  });
  it('needs twenty staff in Maharashtra where ten is enough elsewhere', () => {
    const args = { exempt: false, headcount: 12, region: 'MH' };
    expect(health(structure(18_000), INDIA_PACK, '2026-09-01', args)).toBeNull();
    expect(health(structure(18_000), INDIA_PACK, '2026-09-01', { ...args, region: 'RJ' })).not.toBeNull();
  });
});

describe('professional tax', () => {
  it('is nothing at all in Rajasthan, which is where the first schools are', () => {
    expect(localTax(L(60_000), INDIA_PACK, '2026-09-01', { region: 'RJ', month: 9, exempt: false })).toBe(0);
  });
  it('charges Maharashtra ₹200, and ₹300 in February', () => {
    expect(localTax(L(40_000), INDIA_PACK, '2026-09-01', { region: 'MH', month: 9, exempt: false })).toBe(L(200));
    expect(localTax(L(40_000), INDIA_PACK, '2027-02-01', { region: 'MH', month: 2, exempt: false })).toBe(L(300));
  });
  it('charges Tamil Nadu only in its two half-yearly months', () => {
    const args = { region: 'TN', exempt: false };
    expect(localTax(L(50_000), INDIA_PACK, '2026-09-01', { ...args, month: 9 })).toBe(0);
    expect(localTax(L(50_000), INDIA_PACK, '2026-08-01', { ...args, month: 8 })).toBe(L(690));
  });
  it('charges nothing where the state repealed it', () => {
    expect(localTax(L(50_000), INDIA_PACK, '2026-09-01', { region: 'OD', month: 9, exempt: false })).toBe(0);
  });
});

describe('income tax', () => {
  const base = { pack: INDIA_PACK, onISO: '2026-09-01', alreadyPaidMinor: 0, monthsLeft: 12 };

  it('is nil up to ₹12 lakh on the new regime, because the rebate wipes it', () => {
    const r = incomeTax({ ...base, regimeKey: 'NEW', annualTaxableSalaryMinor: L(1_250_000), annualBasicMinor: L(600_000), annualHraMinor: L(240_000) });
    expect(r.taxableMinor).toBe(L(1_175_000));
    expect(r.annualTaxMinor).toBe(0);
  });

  it('starts biting just above it', () => {
    const r = incomeTax({ ...base, regimeKey: 'NEW', annualTaxableSalaryMinor: L(1_500_000), annualBasicMinor: L(750_000), annualHraMinor: L(300_000) });
    expect(r.taxableMinor).toBe(L(1_425_000));
    expect(r.annualTaxMinor).toBeGreaterThan(0);
    expect(r.monthlyMinor).toBe(Math.round(r.annualTaxMinor / 12));
  });

  it('ignores house rent and 80C on the new regime, and allows them on the old one', () => {
    const declaration = { rentAnnualMinor: L(240_000), s80cMinor: L(150_000), metro: false };
    const args = { ...base, annualTaxableSalaryMinor: L(1_500_000), annualBasicMinor: L(750_000), annualHraMinor: L(300_000), declaration };
    expect(incomeTax({ ...args, regimeKey: 'NEW' }).exemptionsMinor).toBe(0);
    const old = incomeTax({ ...args, regimeKey: 'OLD' });
    expect(old.exemptionsMinor).toBeGreaterThan(0);
    expect(old.deductionsMinor).toBe(L(150_000));
  });

  it('spreads only what is left over the months that remain', () => {
    const r = incomeTax({ ...base, regimeKey: 'NEW', annualTaxableSalaryMinor: L(2_000_000), annualBasicMinor: L(1_000_000), annualHraMinor: L(400_000), alreadyPaidMinor: L(50_000), monthsLeft: 5 });
    expect(r.monthlyMinor).toBe(Math.round((r.annualTaxMinor - L(50_000)) / 5));
  });

  it('counts a previous employer, so a mid-year joiner is not under-deducted', () => {
    const r = incomeTax({ ...base, regimeKey: 'NEW', annualTaxableSalaryMinor: L(700_000), annualBasicMinor: L(350_000), annualHraMinor: L(140_000), declaration: { previousEmployerSalaryMinor: L(800_000), previousEmployerTdsMinor: L(10_000) } });
    expect(r.annualSalaryMinor).toBe(L(1_500_000));
    expect(r.alreadyPaidMinor).toBe(L(10_000));
  });
});

describe('house rent exemption', () => {
  it('takes the least of the three tests', () => {
    expect(houseRentExemption(L(240_000), L(600_000), L(300_000), false)).toBe(L(240_000));
    expect(houseRentExemption(L(240_000), L(600_000), L(70_000), false)).toBe(L(10_000));
    expect(houseRentExemption(L(240_000), L(600_000), 0, false)).toBe(0);
  });
});

describe('gratuity', () => {
  it('pays a permanent teacher after five years, rounding a long part-year up', () => {
    const r = gratuity(INDIA_PACK, '2026-09-01', { lastWagesMinor: L(30_000), months: 5 * 12 + 7, fixedTerm: false });
    expect(r.eligible).toBe(true);
    expect(r.years).toBe(6);
    expect(r.payableMinor).toBe(Math.round((L(30_000) * 15 * 6) / 26));
  });
  it('pays a fixed-term teacher after one year — the rule most schools have not caught up with', () => {
    expect(gratuity(INDIA_PACK, '2026-09-01', { lastWagesMinor: L(30_000), months: 14, fixedTerm: true }).eligible).toBe(true);
    expect(gratuity(INDIA_PACK, '2026-09-01', { lastWagesMinor: L(30_000), months: 14, fixedTerm: false }).eligible).toBe(false);
  });
  it('caps at the exempt limit', () => {
    const r = gratuity(INDIA_PACK, '2026-09-01', { lastWagesMinor: L(500_000), months: 30 * 12, fixedTerm: false });
    expect(r.payableMinor).toBe(L(2_000_000));
  });
});

describe('the month is read at its end', () => {
  it('is the last day, which is what makes a mid-month rule change land in the right month', () => {
    expect(periodEndISO(2026, 9)).toBe('2026-09-30');
    expect(periodEndISO(2026, 2)).toBe('2026-02-28');
  });
});

describe('the tax year', () => {
  it('runs April to March in India, and April is its first month', () => {
    expect(taxYearOf(INDIA_PACK, 2026, 4)).toEqual({ taxYear: 2026, monthIndex: 0, monthsLeft: 12 });
    expect(taxYearOf(INDIA_PACK, 2027, 3)).toEqual({ taxYear: 2026, monthIndex: 11, monthsLeft: 1 });
    expect(taxYearLabel(INDIA_PACK, 2026)).toBe('2026-27');
  });
  it('knows February', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

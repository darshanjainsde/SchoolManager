import 'reflect-metadata';

const txMock = {
  payRun: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  payslip: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  payAdjustment: { findMany: jest.fn() },
  taxDeclaration: { findMany: jest.fn() },
  payComponent: { findMany: jest.fn(), createMany: jest.fn() },
  teacher: { findMany: jest.fn(), findFirst: jest.fn() },
  staff: { findMany: jest.fn(), findFirst: jest.fn() },
  employeePay: { findMany: jest.fn(), create: jest.fn() },
};
const schoolMock = { findUnique: jest.fn() };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
  getPlatformPrisma: () => ({ school: schoolMock }),
}));

import { INDIA_PACK } from '@skoolos/types';
import { PayPackService } from './pay-pack.service';
import { PayPeopleService } from './pay-people.service';
import { PayRunService } from './pay-run.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RUN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ACTOR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const L = (r: number) => r * 100;

function service() {
  const packs = new PayPackService();
  return new PayRunService(packs, new PayPeopleService(packs));
}

/** The pack's standard components, as rows the way the database returns them. */
const COMPONENT_ROWS = INDIA_PACK.standardComponents.map((c) => ({
  key: c.key, name: c.name, kind: c.kind, calc: c.calc, rateBps: c.rateBps ?? null,
  taxable: c.taxable, isWages: c.isWages, retirementBase: c.retirementBase,
  healthBase: c.healthBase, gratuityBase: c.gratuityBase, prorate: c.prorate, order: c.order,
}));

/**
 * India's provident fund starts at 20 people on the payroll and ESI at 10, so
 * a fixture of one teacher has NO statutory deductions at all and is the wrong
 * shape to test them with. `others` pads the roster to a real school.
 */
function arrange(opts: { month?: number; year?: number; gross?: number; adjustments?: unknown[]; priorSlips?: unknown[]; region?: string | null; pfOptIn?: boolean; others?: number } = {}) {
  jest.clearAllMocks();
  schoolMock.findUnique.mockResolvedValue({
    countryCode: 'IN', currency: 'INR', region: opts.region === undefined ? 'RJ' : opts.region, taxYearStartMonth: 4,
  });
  txMock.payRun.findFirst.mockResolvedValue({
    id: RUN, schoolId: SCHOOL, periodYear: opts.year ?? 2026, periodMonth: opts.month ?? 9,
    status: 'DRAFT', headcount: 0, rulesAsAt: new Date('2026-09-30T00:00:00.000Z'),
  });
  txMock.payComponent.findMany.mockResolvedValue(COMPONENT_ROWS);
  const others = opts.others ?? 24;
  const otherIds = Array.from({ length: others }, (_, i) => `eeeeeeee-eeee-eeee-eeee-${String(i).padStart(12, '0')}`);
  txMock.teacher.findMany.mockResolvedValue([
    { id: T1, firstName: 'Priya', lastName: 'Nair' },
    ...otherIds.map((id, i) => ({ id, firstName: `Other${i}`, lastName: 'Teacher' })),
  ]);
  txMock.staff.findMany.mockResolvedValue([]);
  const payRow = (teacherId: string) => ({
    id: `pay-${teacherId}`, teacherId, staffId: null, personKind: 'TEACHER',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    monthlyGrossMinor: L(opts.gross ?? 40_000), fixedAmounts: { conveyance: L(1_600) },
    taxRegime: 'NEW', pfOptIn: opts.pfOptIn ?? true, pfOnActual: false, esiExempt: false,
    localTaxExempt: false, paidThroughVacation: true, contractMonths: 12,
  });
  txMock.employeePay.findMany.mockResolvedValue([payRow(T1), ...otherIds.map(payRow)]);
  txMock.payAdjustment.findMany.mockResolvedValue(opts.adjustments ?? []);
  txMock.taxDeclaration.findMany.mockResolvedValue([]);
  txMock.payslip.findMany.mockResolvedValue(opts.priorSlips ?? []);
  txMock.payslip.deleteMany.mockResolvedValue({ count: 0 });
  txMock.payslip.createMany.mockResolvedValue({ count: 1 });
  txMock.payRun.update.mockResolvedValue({});
}

const slip = () => txMock.payslip.createMany.mock.calls[0][0].data[0];
const lineOf = (key: string) => (slip().lines as { key: string; amountMinor: number }[]).find((l) => l.key === key);

describe('the pay run', () => {
  it('computes one teacher’s month end to end, and the parts add up', async () => {
    arrange();
    const r = await service().calculate(SCHOOL, RUN);
    const s = slip();
    expect(r.headcount).toBe(25);
    expect(s.grossMinor).toBe(L(40_000));
    expect(s.netMinor).toBe(s.grossMinor - s.deductionMinor);
    expect(lineOf('basic')!.amountMinor).toBe(L(20_000));
    expect(lineOf('hra')!.amountMinor).toBe(L(8_000));
  });

  it('reads the rules at the END of the month, so September 2026 gets the new ₹25,000 ceiling', async () => {
    arrange({ month: 9, year: 2026 });
    await service().calculate(SCHOOL, RUN);
    // Basic is ₹20,000, under the new ceiling, so 12% of the whole basic.
    expect(slip().retirementEmployeeMinor).toBe(L(2_400));

    arrange({ month: 8, year: 2026 });
    txMock.payRun.findFirst.mockResolvedValue({ id: RUN, schoolId: SCHOOL, periodYear: 2026, periodMonth: 8, status: 'DRAFT', headcount: 0, rulesAsAt: new Date('2026-08-31T00:00:00.000Z') });
    await service().calculate(SCHOOL, RUN);
    // August still sits under the old ₹15,000 ceiling: 12% of ₹15,000.
    expect(slip().retirementEmployeeMinor).toBe(L(1_800));
  });

  it('charges no professional tax in Rajasthan and ₹200 in Maharashtra', async () => {
    arrange({ region: 'RJ' });
    await service().calculate(SCHOOL, RUN);
    expect(slip().localTaxMinor).toBe(0);

    arrange({ region: 'MH' });
    await service().calculate(SCHOOL, RUN);
    expect(slip().localTaxMinor).toBe(L(200));
  });

  it('records which rule book produced the figures', async () => {
    arrange();
    const r = await service().calculate(SCHOOL, RUN);
    expect(r.packVersion).toBe(INDIA_PACK.version);
    expect(r.rulesAsAt).toBe('2026-09-30');
    expect(txMock.payRun.update.mock.calls[0][0].data.packVersion).toBe(INDIA_PACK.version);
  });

  it('puts arrears in as an EARNING line, so provident fund is taken on them too', async () => {
    arrange({
      adjustments: [{ id: 'adj-1', teacherId: T1, staffId: null, kind: 'EARNING', label: 'April increment arrears', amountMinor: L(12_000), taxable: true, lopDays: 0 }],
    });
    await service().calculate(SCHOOL, RUN);
    expect(slip().grossMinor).toBe(L(52_000));
    expect(lineOf('adj-adj-1')!.amountMinor).toBe(L(12_000));
  });

  it('shrinks the proratable lines for unpaid days and says how many were paid', async () => {
    arrange({
      adjustments: [{ id: 'adj-2', teacherId: T1, staffId: null, kind: 'DEDUCTION', label: 'Unpaid leave', amountMinor: 0, taxable: false, lopDays: 3 }],
    });
    await service().calculate(SCHOOL, RUN);
    expect(slip().daysPaid).toBe(27);
    expect(slip().daysInMonth).toBe(30);
    expect(slip().grossMinor).toBeLessThan(L(40_000));
  });

  it('shows what the school paid in on top — the line most payslips leave out', async () => {
    arrange();
    await service().calculate(SCHOOL, RUN);
    expect(slip().employerCostMinor).toBeGreaterThan(0);
    expect(lineOf('pf_employer')!.amountMinor).toBeGreaterThan(0);
  });

  it('says WHY the provident fund is missing at a school too small for it, rather than silently omitting it', async () => {
    arrange({ others: 3 });
    const r = await service().calculate(SCHOOL, RUN);
    expect(slip().retirementEmployeeMinor).toBe(0);
    expect(r.notes.join(' ')).toMatch(/Provident fund does not apply.*20 people/i);
  });

  it('refuses to run a month where nobody has a structure', async () => {
    arrange();
    txMock.employeePay.findMany.mockResolvedValue([]);
    await expect(service().calculate(SCHOOL, RUN)).rejects.toThrow(/structure/i);
  });

  it('takes no provident fund from someone who is not a member', async () => {
    arrange({ pfOptIn: false });
    await service().calculate(SCHOOL, RUN);
    expect(slip().retirementEmployeeMinor).toBe(0);
  });
});

describe('the lifecycle', () => {
  it('will not approve a run nobody has calculated', async () => {
    arrange();
    txMock.payRun.findFirst.mockResolvedValue({ id: RUN, schoolId: SCHOOL, periodYear: 2026, periodMonth: 9, status: 'DRAFT', headcount: 0 });
    await expect(service().approve(SCHOOL, ACTOR, RUN)).rejects.toThrow(/cannot go straight/i);
  });

  it('locks an approved run, and then refuses to change it', async () => {
    arrange();
    txMock.payRun.findFirst.mockResolvedValue({ id: RUN, schoolId: SCHOOL, periodYear: 2026, periodMonth: 9, status: 'APPROVED', headcount: 1 });
    await expect(service().lock(SCHOOL, ACTOR, RUN)).resolves.toEqual({ status: 'LOCKED' });

    txMock.payRun.findFirst.mockResolvedValue({ id: RUN, schoolId: SCHOOL, periodYear: 2026, periodMonth: 9, status: 'LOCKED', headcount: 1 });
    await expect(service().calculate(SCHOOL, RUN)).rejects.toThrow(/locked/i);
    await expect(service().approve(SCHOOL, ACTOR, RUN)).rejects.toThrow(/locked/i);
  });

  it('a locked run may only be marked paid', async () => {
    arrange();
    txMock.payRun.findFirst.mockResolvedValue({ id: RUN, schoolId: SCHOOL, periodYear: 2026, periodMonth: 9, status: 'LOCKED', headcount: 1 });
    await expect(service().markPaid(SCHOOL, RUN)).resolves.toEqual({ status: 'PAID' });
  });

  it('opening the same month twice returns the run that is already there', async () => {
    arrange();
    txMock.payRun.findFirst.mockResolvedValue({ id: RUN });
    await expect(service().open(SCHOOL, ACTOR, 2026, 9)).resolves.toEqual({ id: RUN });
    expect(txMock.payRun.create).not.toHaveBeenCalled();
  });
});

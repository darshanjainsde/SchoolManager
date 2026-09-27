import 'reflect-metadata';

const txMock = {
  payslip: { findFirst: jest.fn() },
  employeePay: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
  staff: { findFirst: jest.fn() },
  school: { findFirst: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { PayslipDocService } from './payslip-doc.service';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = '11111111-1111-1111-1111-111111111111';
const T1 = '22222222-2222-2222-2222-222222222222';
const SLIP = '33333333-3333-3333-3333-333333333333';
const USER = '44444444-4444-4444-4444-444444444444';

const slipRow = (o: Record<string, unknown> = {}) => ({
  id: SLIP, personKind: 'TEACHER', teacherId: T1, staffId: null,
  name: 'Asha Rao', designation: 'Teacher',
  lines: [{ key: 'basic', name: 'Basic', kind: 'EARNING', amountMinor: 2_402_400 }],
  daysInMonth: 30, daysPaid: 30, lopHalfDays: 0,
  grossMinor: 2_402_400, deductionMinor: 180_000, netMinor: 2_222_400, employerCostMinor: 0,
  incomeTaxMinor: 0, taxRegime: 'NEW', ytdGrossMinor: 2_402_400, ytdTaxMinor: 0,
  payRun: {
    periodYear: 2026, periodMonth: 9, status: 'PAID',
    paidAt: new Date('2026-10-01T00:00:00.000Z'),
    rulesAsAt: new Date('2026-09-22T00:00:00.000Z'), packVersion: 'IN-2026.09.22',
  },
  ...o,
});

const service = () => new PayslipDocService();

beforeEach(() => {
  jest.clearAllMocks();
  txMock.payslip.findFirst.mockResolvedValue(slipRow());
  txMock.employeePay.findFirst.mockResolvedValue({
    pan: 'ABCDE1234F', uan: '100123456789', bankAccount: '30012345674821', joinedOn: new Date('2019-06-01'),
  });
  txMock.teacher.findFirst.mockResolvedValue({ id: T1 });
  txMock.staff.findFirst.mockResolvedValue(null);
  txMock.school.findFirst.mockResolvedValue({ name: 'Raffles Primary School' });
});

describe('the payslip document', () => {
  it('is the SAME document from the console and from /me', async () => {
    // The whole point: the office's copy and the person's copy are one
    // document, because a payslip is what somebody takes to a bank.
    const admin = await service().forAdmin(SCHOOL, SLIP);
    const self = await service().forSelf(SCHOOL, USER, SLIP);
    expect(self).toEqual(admin);
  });

  it('words the month once, so every surface says it the same way', async () => {
    const d = await service().forAdmin(SCHOOL, SLIP);
    expect(d.periodLabel).toBe('September 2026');
  });

  it('carries only the last four of the bank account', async () => {
    const d = await service().forAdmin(SCHOOL, SLIP);
    expect(d.person.bankAccountLast4).toBe('4821');
    expect(JSON.stringify(d)).not.toContain('30012345674821');
  });

  it('narrows a self request to the caller’s OWN person, and to a locked month', async () => {
    await service().forSelf(SCHOOL, USER, SLIP);
    const where = txMock.payslip.findFirst.mock.calls[0][0].where;
    expect(where.teacherId).toBe(T1);
    expect(where.payRun).toEqual({ status: { in: ['LOCKED', 'PAID'] } });
  });

  it('does not narrow an admin request — the office prints anybody’s', async () => {
    await service().forAdmin(SCHOOL, SLIP);
    const where = txMock.payslip.findFirst.mock.calls[0][0].where;
    expect(where.teacherId).toBeUndefined();
    expect(where.payRun).toBeUndefined();
  });

  it('refuses a login with no person record', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    txMock.staff.findFirst.mockResolvedValue(null);
    await expect(service().forSelf(SCHOOL, USER, SLIP)).rejects.toThrow(ApiError);
  });

  it('reads the pay row IN FORCE for that month, not today’s', async () => {
    // Reprinting last March must not stamp it with an account opened since.
    await service().forAdmin(SCHOOL, SLIP);
    const args = txMock.employeePay.findFirst.mock.calls[0][0];
    expect(args.where.effectiveFrom.lte).toEqual(new Date(Date.UTC(2026, 9, 0)));
    expect(args.orderBy).toEqual({ effectiveFrom: 'desc' });
  });

  it('does not claim money has been paid when the run only says approved', async () => {
    txMock.payslip.findFirst.mockResolvedValue(slipRow({
      payRun: { ...slipRow().payRun, status: 'LOCKED', paidAt: null },
    }));
    const d = await service().forAdmin(SCHOOL, SLIP);
    expect(d.paidOn).toBeNull();
  });

  it('survives a person whose pay row has gone', async () => {
    txMock.employeePay.findFirst.mockResolvedValue(null);
    const d = await service().forAdmin(SCHOOL, SLIP);
    expect(d.person.pan).toBeNull();
    expect(d.person.bankAccountLast4).toBeNull();
  });

  it('says so when there is no such payslip', async () => {
    txMock.payslip.findFirst.mockResolvedValue(null);
    await expect(service().forAdmin(SCHOOL, SLIP)).rejects.toThrow(/No payslip/);
  });
});

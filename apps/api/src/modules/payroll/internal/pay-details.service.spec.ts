import 'reflect-metadata';

const txMock = {
  employeePay: { findFirst: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
  payComponent: { findMany: jest.fn(), createMany: jest.fn() },
  teacher: { findFirst: jest.fn() },
  staff: { findFirst: jest.fn() },
};
const schoolMock = { findUnique: jest.fn() };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
  getPlatformPrisma: () => ({ school: schoolMock }),
}));

import { PayPackService } from './pay-pack.service';
import { PayPeopleService } from './pay-people.service';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = '11111111-1111-1111-1111-111111111111';
const T1 = '22222222-2222-2222-2222-222222222222';

const service = () => new PayPeopleService(new PayPackService());

beforeEach(() => {
  jest.clearAllMocks();
  schoolMock.findUnique.mockResolvedValue({ countryCode: 'IN', currency: 'INR', region: 'RJ', taxYearStartMonth: 4 });
  txMock.teacher.findFirst.mockResolvedValue({ id: T1 });
  txMock.employeePay.count.mockResolvedValue(3);
  txMock.employeePay.updateMany.mockResolvedValue({ count: 3 });
  txMock.employeePay.findFirst.mockResolvedValue({
    bankAccount: '30123456789', bankIfsc: 'SBIN0001234', bankName: 'State Bank of India',
    pan: 'ABCDE1234F', uan: '100123456789', esiNumber: null,
  });
});

describe('the details that belong to a person', () => {
  it('names what is missing rather than counting it', async () => {
    txMock.employeePay.findFirst.mockResolvedValue({
      bankAccount: null, bankIfsc: null, bankName: null, pan: null, uan: null, esiNumber: null,
    });
    const d = await service().details(SCHOOL, 'TEACHER', T1);
    expect(d.missing).toEqual(['a bank account number', 'the branch IFSC', 'a PAN']);
    expect(d.onPay).toBe(true);
  });

  it('says nothing is missing once the three are in', async () => {
    const d = await service().details(SCHOOL, 'TEACHER', T1);
    expect(d.missing).toEqual([]);
  });

  it('updates EVERY pay row, not just the one in force', async () => {
    // The load-bearing decision. Pay TERMS are versioned — June must keep the
    // figure June was run on. A bank account is not a term: `bankFile()` reads
    // the row in force for the month it builds, so a versioned account would
    // print the OLD one on a June file re-downloaded in November, and money
    // paid today goes to the account the person has today.
    await service().setDetails(SCHOOL, 'TEACHER', T1, { bankAccount: '30999888777', bankIfsc: 'HDFC0000567' });
    const [call] = txMock.employeePay.updateMany.mock.calls;
    expect(call[0].where).toEqual({ schoolId: SCHOOL, teacherId: T1 });
    expect(call[0].where.effectiveFrom).toBeUndefined();
    expect(call[0].data).toMatchObject({ bankAccount: '30999888777', bankIfsc: 'HDFC0000567' });
  });

  it('refuses an account without its branch, and a branch without its account', async () => {
    await expect(service().setDetails(SCHOOL, 'TEACHER', T1, { bankAccount: '30999888777' }))
      .rejects.toThrow(ApiError);
    await expect(service().setDetails(SCHOOL, 'TEACHER', T1, { bankIfsc: 'HDFC0000567' }))
      .rejects.toThrow(ApiError);
    expect(txMock.employeePay.updateMany).not.toHaveBeenCalled();
  });

  it('lets both be cleared together, so a wrong account can be taken back out', async () => {
    await service().setDetails(SCHOOL, 'TEACHER', T1, { bankAccount: '', bankIfsc: '' });
    expect(txMock.employeePay.updateMany.mock.calls[0][0].data).toMatchObject({ bankAccount: null, bankIfsc: null });
  });

  it('upper-cases an IFSC and a PAN, because a bank file is matched on them', async () => {
    await service().setDetails(SCHOOL, 'TEACHER', T1, { bankAccount: '30999888777', bankIfsc: 'hdfc0000567', pan: 'abcde1234f' });
    expect(txMock.employeePay.updateMany.mock.calls[0][0].data).toMatchObject({ bankIfsc: 'HDFC0000567', pan: 'ABCDE1234F' });
  });

  it('touches only the fields it was given', async () => {
    // A person saving their PAN must not blank the account the office typed.
    await service().setDetails(SCHOOL, 'TEACHER', T1, { pan: 'ABCDE1234F' });
    expect(txMock.employeePay.updateMany.mock.calls[0][0].data).toEqual({ pan: 'ABCDE1234F' });
  });

  it('says so plainly when the person is not on the payroll yet', async () => {
    txMock.employeePay.count.mockResolvedValue(0);
    await expect(service().setDetails(SCHOOL, 'TEACHER', T1, { pan: 'ABCDE1234F' }))
      .rejects.toThrow(/not been set up yet/);
  });

  it('refuses a person who is not on this school’s roll', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    await expect(service().setDetails(SCHOOL, 'TEACHER', T1, { pan: 'ABCDE1234F' }))
      .rejects.toThrow(ApiError);
  });
});

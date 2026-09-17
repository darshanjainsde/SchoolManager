/**
 * The one server gap the app-sync audit found: a parent submitted a payment
 * and then had to keep re-opening the app to learn the office's decision.
 * These pin that verify() and reject() each write ONE in-app row and ONE
 * outbox row to the student's login, inside the same transaction, with the
 * words the Fees page will show — and nothing at all for a student who has
 * no login yet.
 */
const txMock = {
  feePayment: { findFirst: jest.fn(), update: jest.fn() },
  feeLedgerEntry: { create: jest.fn() },
  feeReceipt: { create: jest.fn() },
  feeAudit: { create: jest.fn(), findFirst: jest.fn() },
  feeSettings: { findFirst: jest.fn() },
  feeAllocation: { create: jest.fn(), findMany: jest.fn() },
  feeInvoice: { findFirst: jest.fn() },
  student: { findFirst: jest.fn() },
  school: { findFirst: jest.fn() },
  notification: { create: jest.fn() },
  notificationOutbox: { create: jest.fn() },
  $queryRaw: jest.fn(),
};
jest.mock('@skoolos/db', () => ({
  Prisma: {},
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { FeePaymentService } from './fee-payment.service';

const PAYMENT = { id: 'pay-1', schoolId: 'sch-1', studentId: 'stu-1', status: 'SUBMITTED', amountMinor: 2450000, method: 'UPI', providerRef: '4418', paidOn: new Date('2026-09-14'), invoice: null };

function service() {
  return new FeePaymentService({} as never, {} as never);
}

beforeEach(() => {
  for (const table of Object.values(txMock)) {
    if (jest.isMockFunction(table)) { table.mockReset(); continue; }
    for (const fn of Object.values(table)) if (jest.isMockFunction(fn)) fn.mockReset();
  }
  txMock.feePayment.findFirst.mockResolvedValue(PAYMENT);
  txMock.feePayment.update.mockImplementation(async ({ data }: { data: object }) => ({ ...PAYMENT, ...data }));
  txMock.feeReceipt.create.mockResolvedValue({ number: 'RCP/2026/00311' });
  txMock.$queryRaw.mockResolvedValue([{ fee_next_number: 311 }]);
  txMock.feeAudit.create.mockResolvedValue({});
  txMock.feeLedgerEntry.create.mockResolvedValue({});
  txMock.school.findFirst.mockResolvedValue({ name: 'Saraswati Public School' });
});

describe('the family hears the decision', () => {
  it('verify() writes the confirmation, with the receipt, to the student login — in-app and push', async () => {
    txMock.student.findFirst.mockResolvedValue({ userId: 'usr-9' });
    await service().verify('sch-1', 'clerk-1', 'pay-1');
    expect(txMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'usr-9', kind: 'FEE_VERIFIED', title: 'Payment confirmed — ₹24,500', body: 'Receipt RCP/2026/00311 is on your Fees page.', linkType: 'fees', linkId: 'pay-1' }),
    });
    expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'FEE_VERIFIED', targetUserId: 'usr-9', payload: expect.objectContaining({ schoolName: 'Saraswati Public School', title: 'Payment confirmed — ₹24,500' }) }),
    });
  });

  it('reject() carries the office’s reason word for word', async () => {
    txMock.student.findFirst.mockResolvedValue({ userId: 'usr-9' });
    await service().reject('sch-1', 'clerk-1', 'pay-1', { reason: 'Amount does not match the bill.' });
    expect(txMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'FEE_REJECTED', title: 'Payment not accepted — ₹24,500', body: 'Amount does not match the bill.' }),
    });
    expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'FEE_REJECTED', targetUserId: 'usr-9' }) });
  });

  it('a student with no login gets no row — and the verification still succeeds', async () => {
    txMock.student.findFirst.mockResolvedValue({ userId: null });
    const out = await service().verify('sch-1', 'clerk-1', 'pay-1');
    expect(out.receipt.number).toBe('RCP/2026/00311');
    expect(txMock.notification.create).not.toHaveBeenCalled();
    expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
  });
});

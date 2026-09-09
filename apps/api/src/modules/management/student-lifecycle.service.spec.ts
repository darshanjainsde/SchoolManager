import 'reflect-metadata';

const txMock = {
  student: { findFirst: jest.fn(), update: jest.fn() },
  classSection: { findFirst: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  attendance: { count: jest.fn() },
  result: { count: jest.fn() },
  diaryRecipient: { count: jest.fn() },
  diaryAck: { count: jest.fn() },
  libraryIssue: { count: jest.fn() },
  libraryFine: { aggregate: jest.fn() },
  messageThread: { count: jest.fn() },
  feeLedgerEntry: { groupBy: jest.fn() },
};
const platformMock = {
  user: { update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};
jest.mock('@skoolos/db', () => ({
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
  getPlatformPrisma: () => platformMock,
  Prisma: jest.requireActual('@prisma/client').Prisma,
}));

import { StudentLifecycleService } from './student-lifecycle.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SECTION = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function service() {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const invites = { sendInvite: jest.fn().mockResolvedValue(true) };
  return { svc: new StudentLifecycleService(audit as never, invites as never), audit, invites };
}

beforeEach(() => {
  jest.clearAllMocks();
  txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: 'u1', status: 'ACTIVE', code: 'RAF-00042' });
  txMock.student.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: STUDENT, ...data }));
  txMock.academicYear.findFirst.mockResolvedValue({ name: '2025-26' });
  txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
});

describe('leave', () => {
  it('TRANSFERRED sets status, mirrors isActive=false, closes the login and audits', async () => {
    const { svc, audit } = service();
    await svc.leave(SCHOOL, ACTOR, STUDENT, { status: 'TRANSFERRED', leftOn: '2026-03-31', reason: 'Moved city' });
    const data = txMock.student.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'TRANSFERRED', isActive: false, leftReason: 'Moved city', statusChangedById: ACTOR, alumniBatch: null });
    expect(data.leftOn).toEqual(new Date('2026-03-31'));
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    expect(platformMock.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'student.leave', entityId: STUDENT }));
  });

  it('ALUMNI closes the login too and fills the batch from the current year', async () => {
    const { svc } = service();
    await svc.leave(SCHOOL, ACTOR, STUDENT, { status: 'ALUMNI', leftOn: '2026-03-31' });
    expect(txMock.student.update.mock.calls[0][0].data).toMatchObject({ status: 'ALUMNI', alumniBatch: '2025-26', isActive: false });
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
  });

  it('a student with no login just changes status', async () => {
    const { svc } = service();
    txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: null, status: 'ACTIVE', code: null });
    await svc.leave(SCHOOL, ACTOR, STUDENT, { status: 'LEFT', leftOn: '2026-03-31' });
    expect(platformMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses when the student is not ACTIVE', async () => {
    const { svc } = service();
    txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: null, status: 'LEFT' });
    await expect(svc.leave(SCHOOL, ACTOR, STUDENT, { status: 'LEFT', leftOn: '2026-03-31' })).rejects.toMatchObject({
      response: { code: 'NOT_ACTIVE' },
    });
    expect(txMock.student.update).not.toHaveBeenCalled();
  });
});

describe('readmit', () => {
  it('reactivates, clears left fields, reopens the login and re-invites', async () => {
    const { svc, invites } = service();
    txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: 'u1', status: 'LEFT', code: 'RAF-00042' });
    await svc.readmit(SCHOOL, ACTOR, STUDENT, { classSectionId: SECTION });
    expect(txMock.student.update.mock.calls[0][0].data).toMatchObject({
      status: 'ACTIVE', isActive: true, leftOn: null, leftReason: null, leftNote: null, alumniBatch: null, classSectionId: SECTION,
    });
    expect(platformMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: true } });
    expect(invites.sendInvite).toHaveBeenCalledWith('u1', 'RAF-00042');
  });

  it('checks the class section belongs to the school', async () => {
    const { svc } = service();
    txMock.student.findFirst.mockResolvedValue({ id: STUDENT, userId: null, status: 'LEFT', code: null });
    txMock.classSection.findFirst.mockResolvedValue(null);
    await expect(svc.readmit(SCHOOL, ACTOR, STUDENT, { classSectionId: SECTION })).rejects.toMatchObject({
      response: { code: 'VALIDATION', field: 'classSectionId' },
    });
  });

  it('refuses when already active', async () => {
    const { svc } = service();
    await expect(svc.readmit(SCHOOL, ACTOR, STUDENT, {})).rejects.toMatchObject({ response: { code: 'ALREADY_ACTIVE' } });
  });
});

describe('clearance', () => {
  it('counts books out, fines due, fee dues, unsigned remarks and history', async () => {
    const { svc } = service();
    txMock.libraryIssue.count.mockResolvedValue(2);
    txMock.libraryFine.aggregate.mockResolvedValue({ _sum: { amountRupees: 150 } });
    txMock.diaryRecipient.count.mockResolvedValue(1);
    txMock.diaryAck.count.mockResolvedValue(0);
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { kind: 'DEBIT', _sum: { amountMinor: 500_000 } },
      { kind: 'CREDIT', _sum: { amountMinor: 200_000 } },
    ]);
    txMock.attendance.count.mockResolvedValue(40);
    txMock.result.count.mockResolvedValue(0);
    txMock.messageThread.count.mockResolvedValue(0);
    const c = await svc.clearance(SCHOOL, STUDENT);
    expect(c).toEqual({ libraryIssuesOut: 2, finesDueRupees: 150, feeDuesRupees: 3000, unsignedRemarks: 1, hasHistory: true });
  });

  it('a clean child has nothing to warn about and no history', async () => {
    const { svc } = service();
    txMock.libraryIssue.count.mockResolvedValue(0);
    txMock.libraryFine.aggregate.mockResolvedValue({ _sum: { amountRupees: null } });
    txMock.diaryRecipient.count.mockResolvedValue(0);
    txMock.diaryAck.count.mockResolvedValue(0);
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([]);
    txMock.attendance.count.mockResolvedValue(0);
    txMock.result.count.mockResolvedValue(0);
    txMock.messageThread.count.mockResolvedValue(0);
    const c = await svc.clearance(SCHOOL, STUDENT);
    expect(c).toEqual({ libraryIssuesOut: 0, finesDueRupees: 0, feeDuesRupees: 0, unsignedRemarks: 0, hasHistory: false });
  });
});

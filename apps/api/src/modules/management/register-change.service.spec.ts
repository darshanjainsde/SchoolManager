const txMock = {
  teacher: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  registerChangeRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { RegisterChangeService } from './register-change.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const TID = 'teacher-1';
const SECTION = 'sec-8c';
const PAST = '2026-07-31';

describe('RegisterChangeService', () => {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new RegisterChangeService(audit as unknown as AuditService);

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: TID });
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findMany.mockResolvedValue([]);
  });

  const row = (over = {}) => ({
    id: 'rc-1', classSectionId: SECTION, date: new Date(PAST), reason: 'late slip',
    status: 'PENDING', requestedByTeacherId: TID, reviewedByUserId: null,
    reviewedAt: null, expiresAt: null, createdAt: new Date(), ...over,
  });

  it('creates a pending request for a class the teacher holds', async () => {
    txMock.registerChangeRequest.create.mockResolvedValue(row());
    const out = await svc.request(SCHOOL, USER, { classSectionId: SECTION, date: PAST, reason: 'late slip' });
    expect(out.id).toBe('rc-1');
    // Assert on what was actually sent to `create`, not the hardcoded mock
    // row — that mock returns `status: 'PENDING'` regardless of what the
    // service does, so it can't catch `status: 'PENDING'` being dropped
    // from the write itself.
    expect(txMock.registerChangeRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          schoolId: SCHOOL,
          classSectionId: SECTION,
          date: new Date(PAST),
          requestedByTeacherId: TID,
          reason: 'late slip',
          status: 'PENDING',
        }),
      }),
    );
  });

  it('refuses a request for a class the teacher does not hold', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);
    await expect(
      svc.request(SCHOOL, USER, { classSectionId: 'other', date: PAST, reason: 'x' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a second pending request for the same class and date', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row());
    await expect(
      svc.request(SCHOOL, USER, { classSectionId: SECTION, date: PAST, reason: 'again' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('requires a reason', async () => {
    await expect(
      svc.request(SCHOOL, USER, { classSectionId: SECTION, date: PAST, reason: '  ' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('approving sets an expiry so the lock reasserts itself', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row());
    txMock.registerChangeRequest.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(row({ ...data })),
    );

    const out = await svc.review(SCHOOL, 'user-admin', 'rc-1', true);

    expect(out.status).toBe('APPROVED');
    expect(out.expiresAt).not.toBeNull();
    expect(new Date(out.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REGISTER_CHANGE_APPROVED' }),
    );
  });

  it('rejecting records who rejected it and grants no unlock', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row());
    txMock.registerChangeRequest.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(row({ ...data })),
    );

    const out = await svc.review(SCHOOL, 'user-admin', 'rc-1', false);

    expect(out.status).toBe('REJECTED');
    expect(out.expiresAt).toBeNull();
    expect(out.reviewedByUserId).toBe('user-admin');
  });

  it('404s reviewing a request that is not in this tenant', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
    await expect(svc.review(SCHOOL, 'user-admin', 'nope', true)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to review a request that is already decided', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(row({ status: 'APPROVED' }));
    await expect(svc.review(SCHOOL, 'user-admin', 'rc-1', true)).rejects.toMatchObject({ status: 409 });
  });
});

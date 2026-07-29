const txMock = {
  classSection: { findFirst: jest.fn(), findMany: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  teacher: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn(), findMany: jest.fn() },
  registerChangeRequest: { findFirst: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { AttendanceService } from './attendance.service';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = 'user-teacher-1';
const SECTION = 'sec-8c';

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
function istDaysAgo(n: number): string {
  return new Date(Date.now() + 5.5 * 3600_000 - n * 86_400_000).toISOString().slice(0, 10);
}

describe('AttendanceService past-day lock', () => {
  const notifications = { notify: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new AttendanceService(
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
    txMock.classSection.findFirst.mockResolvedValue({ id: SECTION });
    txMock.student.findMany.mockResolvedValue([{ id: 'stu-1' }]);
    txMock.attendance.findMany.mockResolvedValue([]);
    txMock.attendance.deleteMany.mockResolvedValue({ count: 0 });
    txMock.attendance.createMany.mockResolvedValue({ count: 1 });
    txMock.substitution.findFirst.mockResolvedValue(null);
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
  });

  const dto = (date: string) => ({
    classSectionId: SECTION,
    date,
    marks: [{ studentId: 'stu-1', status: 'PRESENT' as const }],
  });

  it("allows saving today's register", async () => {
    const res = await svc.save(SCHOOL, USER, dto(istToday()));
    expect(res.saved).toBe(1);
  });

  it('refuses a past day with no approved unlock', async () => {
    await expect(svc.save(SCHOOL, USER, dto(istDaysAgo(3)))).rejects.toMatchObject({ status: 409 });
    expect(txMock.attendance.createMany).not.toHaveBeenCalled();
  });

  it('allows a past day when an approved unlock is live', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue({
      id: 'rc-1', status: 'APPROVED', expiresAt: new Date(Date.now() + 3600_000),
    });
    const res = await svc.save(SCHOOL, USER, dto(istDaysAgo(3)));
    expect(res.saved).toBe(1);
  });

  it('refuses a future date outright', async () => {
    const future = new Date(Date.now() + 5.5 * 3600_000 + 2 * 86_400_000).toISOString().slice(0, 10);
    await expect(svc.save(SCHOOL, USER, dto(future))).rejects.toMatchObject({ status: 400 });
  });

  it('a SCHOOL_ADMIN can still correct a past day directly', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    const res = await svc.save(SCHOOL, 'user-admin', dto(istDaysAgo(3)), 'SCHOOL_ADMIN');
    expect(res.saved).toBe(1);
  });

  // CRITICAL (Task 3 review finding): a RegisterChangeRequest is created with
  // status PENDING and expiresAt NULL — there is no DB constraint tying the
  // two together. If the unlock query treated `expiresAt: null` as "no
  // expiry = unlocked", a merely-filed, never-reviewed request would unlock
  // a closed day on its own. The query MUST require status: 'APPROVED' AND
  // expiresAt in the future; this test proves a PENDING row is inert.
  it('a PENDING request does NOT unlock a past day', async () => {
    txMock.registerChangeRequest.findFirst.mockResolvedValue(null);
    await expect(svc.save(SCHOOL, USER, dto(istDaysAgo(3)))).rejects.toMatchObject({ status: 409 });
    expect(txMock.attendance.createMany).not.toHaveBeenCalled();

    // Confirm the lookup itself only ever asks for APPROVED rows with a
    // strictly-future expiry — i.e. it can never be satisfied by a PENDING
    // row (whose expiresAt is null) even if the mock above were relaxed.
    const call = txMock.registerChangeRequest.findFirst.mock.calls.at(-1)?.[0];
    expect(call.where.status).toBe('APPROVED');
    expect(call.where.OR).toBeUndefined();
    expect(call.where.expiresAt).toEqual({ gt: expect.any(Date) });
  });
});

import 'reflect-metadata';

const txMock = {
  teacher: { findFirst: jest.fn() },
  staff: { findFirst: jest.fn() },
  leaveTypeDef: { findFirst: jest.fn() },
  leaveApplication: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
  timetableSlot: { groupBy: jest.fn().mockResolvedValue([]) },
  substitution: { deleteMany: jest.fn() },
  staffAttendance: { findFirst: jest.fn(), delete: jest.fn() },
  school: { findFirst: jest.fn().mockResolvedValue({ name: 'Raffles' }) },
  user: { findMany: jest.fn().mockResolvedValue([]) },
  notification: { create: jest.fn() },
  notificationOutbox: { create: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { LeaveService } from './leave.service';
import { ApiError } from '../../common/errors/api-error';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DRIVER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const DRIVER_USER = 'd05e5e5e-dddd-dddd-dddd-dddddddddddd';
const TEACHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LEAVE = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const svc = new LeaveService();
const created = (o: Record<string, unknown> = {}) => ({
  id: LEAVE, teacherId: null, staffId: DRIVER, status: 'PENDING', type: 'CASUAL',
  startDate: new Date('2026-10-05'), endDate: new Date('2026-10-05'), reason: null, halfDay: false,
  createdAt: new Date('2026-10-01T00:00:00.000Z'), ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  txMock.teacher.findFirst.mockResolvedValue(null);
  txMock.staff.findFirst.mockResolvedValue({ id: DRIVER, firstName: 'Ram', lastName: 'Singh' });
  txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
  txMock.leaveApplication.create.mockResolvedValue(created());
  txMock.leaveApplication.findMany.mockResolvedValue([]);
  txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
  txMock.user.findMany.mockResolvedValue([]);
});

/**
 * LEAVE IS NOT A TEACHERS-ONLY IDEA.
 *
 * A driver, a helper and a security guard all take leave, and pay deducts for
 * all three. Every one of these tests failed before `personFor`, because each
 * read resolved `Teacher.userId` and a staff login simply had no way in.
 */
describe('a staff member applying', () => {
  const dto = { type: 'CASUAL' as const, startDate: '2026-10-05', endDate: '2026-10-05' };

  it('files the application against the STAFF column, never the teacher one', async () => {
    await svc.apply(SCHOOL, DRIVER_USER, dto);
    expect(txMock.leaveApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ teacherId: null, staffId: DRIVER }) }),
    );
  });

  it('does not ask the timetable what a driver was teaching', async () => {
    // `LeaveApplication.staffId` joins to nothing in `TimetableSlot`, so the
    // groupBy would either be a wasted query or a wrong count.
    //
    // The admin NEEDS an email: `resolveAdminRecipients` drops the ones
    // without, and with no recipients the notice returns before it ever
    // reaches the timetable — which would make this test pass on its own.
    // The teacher control below is what proves it did reach it.
    txMock.user.findMany.mockResolvedValue([{ id: 'admin-user', email: 'head@raffles.test' }]);
    await svc.apply(SCHOOL, DRIVER_USER, dto);
    expect(txMock.notification.create).toHaveBeenCalled();
    expect(txMock.timetableSlot.groupBy).not.toHaveBeenCalled();
  });

  it('DOES ask it for a teacher — the control for the test above', async () => {
    txMock.user.findMany.mockResolvedValue([{ id: 'admin-user', email: 'head@raffles.test' }]);
    txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao' });
    await svc.apply(SCHOOL, DRIVER_USER, dto);
    expect(txMock.timetableSlot.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teacherId: TEACHER }) }),
    );
  });

  it('refuses a half day spread over two dates', async () => {
    // The DB CHECKs this. Refusing it here is the difference between a
    // sentence a person can act on and a constraint violation.
    await expect(svc.apply(SCHOOL, DRIVER_USER, { ...dto, endDate: '2026-10-06', halfDay: true }))
      .rejects.toThrow(/A half day is one day/);
    expect(txMock.leaveApplication.create).not.toHaveBeenCalled();
  });

  it('takes a half day on a single date', async () => {
    await svc.apply(SCHOOL, DRIVER_USER, { ...dto, halfDay: true });
    expect(txMock.leaveApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ halfDay: true }) }),
    );
  });

  it('refuses a login that is neither a teacher nor staff', async () => {
    txMock.staff.findFirst.mockResolvedValue(null);
    await expect(svc.apply(SCHOOL, DRIVER_USER, dto)).rejects.toThrow(ApiError);
  });

  it('treats a login that is BOTH as the teacher', async () => {
    // A teacher who also holds a Staff row has the timetable, and the
    // timetable is what an approval has to cover.
    txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao' });
    await svc.apply(SCHOOL, DRIVER_USER, dto);
    expect(txMock.leaveApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ teacherId: TEACHER, staffId: null }) }),
    );
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });
});

describe('a staff member reading their own', () => {
  it('filters `mine` by the staff column', async () => {
    await svc.mine(SCHOOL, DRIVER_USER);
    expect(txMock.leaveApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ staffId: DRIVER }) }),
    );
  });

  it('counts only their own pending applications', async () => {
    txMock.leaveApplication.count.mockResolvedValue(2);
    await svc.pendingCount(SCHOOL, DRIVER_USER);
    expect(txMock.leaveApplication.count).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, staffId: DRIVER, status: 'PENDING' },
    });
  });

  it('returns nothing rather than throwing for a login with no person record', async () => {
    txMock.staff.findFirst.mockResolvedValue(null);
    expect(await svc.mine(SCHOOL, DRIVER_USER)).toEqual([]);
    expect(await svc.pendingCount(SCHOOL, DRIVER_USER)).toBe(0);
  });
});

describe('cancelling', () => {
  beforeEach(() => {
    txMock.leaveApplication.findFirst.mockResolvedValue(created());
  });

  it('lets a staff member cancel their own', async () => {
    const r = await svc.cancel(SCHOOL, LEAVE, DRIVER_USER, 'STAFF');
    expect(r.status).toBe('CANCELLED');
  });

  it('refuses one staff member cancelling another’s', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 'somebody-else', firstName: 'Sam', lastName: null });
    await expect(svc.cancel(SCHOOL, LEAVE, DRIVER_USER, 'STAFF')).rejects.toThrow(/only cancel your own/);
  });

  it('does not unwind substitutions for a staff cancellation', async () => {
    // Only a teacher's leave created any. Asking `Substitution` about a staff
    // id would delete by a column that never held it.
    txMock.leaveApplication.findFirst.mockResolvedValue(created({ status: 'APPROVED' }));
    await svc.cancel(SCHOOL, LEAVE, DRIVER_USER, 'STAFF');
    expect(txMock.substitution.deleteMany).not.toHaveBeenCalled();
  });
});

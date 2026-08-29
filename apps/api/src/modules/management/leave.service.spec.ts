import 'reflect-metadata';

const txMock = {
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  leaveTypeDef: { findFirst: jest.fn() },
  leaveApplication: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  timetableSlot: { findMany: jest.fn(), findFirst: jest.fn() },
  substitution: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  staffAttendance: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  classSection: { findMany: jest.fn() },
  period: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { LeaveService } from './leave.service';
import { ApiError } from '../../common/errors/api-error';
import type { AssignSubstitutionDto, CreateLeaveDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN_USER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TEACHER_USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const LEAVE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const CLASS_SECTION = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const PERIOD = '11111111-1111-1111-1111-111111111111';
const SUB_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_TEACHER = '33333333-3333-3333-3333-333333333333';

describe('LeaveService', () => {
  const svc = new LeaveService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
    // `apply()` resolves the school's LeaveTypeDef for the picked type;
    // null = the school never opened its leave policy (pre-policy behaviour).
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
  });

  describe('apply', () => {
    const dto: CreateLeaveDto = { type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-22' };

    it('creates a PENDING application for the caller\'s own Teacher record', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER });
      // A real `leaveApplication.create()` row has Date columns (startDate,
      // endDate, createdAt), not the DTO's raw date strings — `apply()` now
      // maps the row through `toRow()` (Date -> ISO string) before returning it.
      txMock.leaveApplication.create.mockResolvedValue({
        id: LEAVE_ID,
        teacherId: TEACHER,
        status: 'PENDING',
        type: dto.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: null,
        createdAt: new Date('2026-07-19T00:00:00.000Z'),
      });

      const result = await svc.apply(SCHOOL, TEACHER_USER, dto);

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, userId: TEACHER_USER } });
      expect(txMock.leaveApplication.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          teacherId: TEACHER,
          type: 'SICK',
          // No LeaveTypeDef configured (pre-policy school) → null, resolved
          // later through the enum when balances are computed.
          typeDefId: null,
          startDate: new Date('2026-07-20'),
          endDate: new Date('2026-07-22'),
          reason: undefined,
        },
      });
      expect(result.status).toBe('PENDING');
    });

    it('stamps the school\'s own LeaveTypeDef onto the application when one exists', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER });
      txMock.leaveTypeDef.findFirst.mockResolvedValue({ id: 'def-sick' });
      txMock.leaveApplication.create.mockResolvedValue({
        id: LEAVE_ID,
        teacherId: TEACHER,
        status: 'PENDING',
        type: dto.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        reason: null,
        createdAt: new Date('2026-07-19T00:00:00.000Z'),
      });

      await svc.apply(SCHOOL, TEACHER_USER, dto);

      expect(txMock.leaveTypeDef.findFirst).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, builtin: 'SICK' },
        select: { id: true },
      });
      expect(txMock.leaveApplication.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ typeDefId: 'def-sick' }),
      });
    });

    it('throws NOT_A_TEACHER when the caller has no linked Teacher row', async () => {
      txMock.teacher.findFirst.mockResolvedValue(null);

      await expect(svc.apply(SCHOOL, 'admin-only-user', dto)).rejects.toMatchObject({
        response: { code: 'NOT_A_TEACHER' },
      });
      expect(txMock.leaveApplication.create).not.toHaveBeenCalled();
    });

    it('rejects endDate before startDate without opening a transaction', async () => {
      await expect(
        svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-22', endDate: '2026-07-20' }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(withTenantMock).not.toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    /** One ACTIVE slot on Monday(1) and one on Wednesday(3) — leave spans both. */
    function mockPendingLeave() {
      txMock.leaveApplication.findFirst.mockResolvedValue({
        id: LEAVE_ID,
        schoolId: SCHOOL,
        teacherId: TEACHER,
        status: 'PENDING',
        startDate: new Date('2026-07-20'), // Monday
        endDate: new Date('2026-07-22'), // Wednesday
      });
      txMock.leaveApplication.update.mockResolvedValue({});
    }

    it('generates a Substitution gap for each of the teacher\'s ACTIVE slots on each leave weekday', async () => {
      mockPendingLeave();
      // Mon (20th) -> one slot; Tue (21st) -> none; Wed (22nd) -> one slot.
      txMock.timetableSlot.findMany.mockImplementation(({ where }: { where: { dayOfWeek: number } }) => {
        if (where.dayOfWeek === 1) return Promise.resolve([{ classSectionId: CLASS_SECTION, periodId: PERIOD }]);
        if (where.dayOfWeek === 3) return Promise.resolve([{ classSectionId: CLASS_SECTION, periodId: 'period-2' }]);
        return Promise.resolve([]);
      });
      txMock.substitution.findFirst.mockResolvedValue(null); // no pre-existing gap
      txMock.substitution.create.mockResolvedValue({});

      const result = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

      expect(txMock.leaveApplication.update).toHaveBeenCalledWith({
        where: { id: LEAVE_ID },
        data: expect.objectContaining({ status: 'APPROVED', reviewedById: ADMIN_USER }),
      });
      expect(txMock.substitution.create).toHaveBeenCalledTimes(2);
      expect(txMock.substitution.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          classSectionId: CLASS_SECTION,
          periodId: PERIOD,
          date: new Date('2026-07-20'),
          originalTeacherId: TEACHER,
          reason: 'leave',
        },
      });
      expect(result).toEqual({ gaps: 2 });
    });

    it('is idempotent: skips creating a gap that already exists for that slot/date', async () => {
      mockPendingLeave();
      txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD }]);
      // Every date's slot already has a Substitution row.
      txMock.substitution.findFirst.mockResolvedValue({ id: 'already-there' });

      const result = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

      expect(txMock.substitution.create).not.toHaveBeenCalled();
      expect(result).toEqual({ gaps: 0 });
    });

    it('throws LEAVE_NOT_PENDING for an application that is not PENDING', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({
        id: LEAVE_ID,
        status: 'APPROVED',
        teacherId: TEACHER,
        startDate: new Date('2026-07-20'),
        endDate: new Date('2026-07-20'),
      });

      await expect(svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER)).rejects.toMatchObject({
        response: { code: 'LEAVE_NOT_PENDING' },
      });
      expect(txMock.leaveApplication.update).not.toHaveBeenCalled();
    });

    describe('auto-marks ON_LEAVE in StaffAttendance', () => {
      // "Now" is 2026-07-21T03:00Z = 2026-07-21T08:30 IST, so IST "today" is
      // 2026-07-21 — 07-20 is past, 07-21 is today, 07-22 is future.
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
        txMock.leaveApplication.findFirst.mockResolvedValue({
          id: LEAVE_ID,
          schoolId: SCHOOL,
          teacherId: TEACHER,
          status: 'PENDING',
          startDate: new Date('2026-07-20'),
          endDate: new Date('2026-07-22'),
        });
        txMock.leaveApplication.update.mockResolvedValue({});
        txMock.timetableSlot.findMany.mockResolvedValue([]); // isolate attendance behavior from gap generation
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('creates an ON_LEAVE mark for today/future dates, skips the past date entirely, and never clobbers a non-PRESENT mark', async () => {
        txMock.staffAttendance.findFirst.mockImplementation(({ where }: { where: { date: Date } }) => {
          const d = where.date.toISOString().slice(0, 10);
          if (d === '2026-07-21') return Promise.resolve(null); // unmarked -> create
          if (d === '2026-07-22') return Promise.resolve({ id: 'mark-22', status: 'ABSENT' }); // deliberate -> leave alone
          return Promise.resolve(null);
        });
        txMock.staffAttendance.create.mockResolvedValue({});

        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

        // Past date (07-20): never queried at all.
        for (const call of txMock.staffAttendance.findFirst.mock.calls) {
          expect(call[0].where.date).not.toEqual(new Date('2026-07-20'));
        }
        // Today (07-21): no existing mark -> created as ON_LEAVE.
        expect(txMock.staffAttendance.create).toHaveBeenCalledTimes(1);
        expect(txMock.staffAttendance.create).toHaveBeenCalledWith({
          data: {
            schoolId: SCHOOL,
            teacherId: TEACHER,
            date: new Date('2026-07-21'),
            status: 'ON_LEAVE',
            markedById: ADMIN_USER,
          },
        });
        // Future date (07-22) had a deliberate ABSENT mark -> untouched.
        expect(txMock.staffAttendance.update).not.toHaveBeenCalled();
      });

      it('overwrites a default PRESENT mark with ON_LEAVE', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-present', status: 'PRESENT' });

        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

        expect(txMock.staffAttendance.update).toHaveBeenCalledWith({
          where: { id: 'mark-present' },
          data: { status: 'ON_LEAVE', markedById: ADMIN_USER },
        });
        expect(txMock.staffAttendance.create).not.toHaveBeenCalled();
      });

      it('is idempotent: an already-ON_LEAVE mark is left alone (no create, no update)', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-leave', status: 'ON_LEAVE' });

        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

        expect(txMock.staffAttendance.create).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('cancel', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects a caller who is neither the owning teacher nor a SCHOOL_ADMIN', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({
        id: LEAVE_ID,
        schoolId: SCHOOL,
        teacherId: TEACHER,
        status: 'PENDING',
      });
      txMock.teacher.findFirst.mockResolvedValue({ id: 'some-other-teacher-id' });

      await expect(svc.cancel(SCHOOL, LEAVE_ID, 'stranger-user', 'TEACHER')).rejects.toMatchObject({
        response: { code: 'LEAVE_CANCEL_FORBIDDEN' },
      });
      expect(txMock.leaveApplication.update).not.toHaveBeenCalled();
    });

    it('throws LEAVE_NOT_CANCELLABLE for a REJECTED application', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({
        id: LEAVE_ID,
        schoolId: SCHOOL,
        teacherId: TEACHER,
        status: 'REJECTED',
      });

      await expect(svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'LEAVE_NOT_CANCELLABLE' },
      });
      expect(txMock.leaveApplication.update).not.toHaveBeenCalled();
    });

    it('throws LEAVE_NOT_CANCELLABLE for an already-CANCELLED application', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({
        id: LEAVE_ID,
        schoolId: SCHOOL,
        teacherId: TEACHER,
        status: 'CANCELLED',
      });

      await expect(svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'LEAVE_NOT_CANCELLABLE' },
      });
    });

    it('cancels a PENDING application with no side effects', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({
        id: LEAVE_ID,
        schoolId: SCHOOL,
        teacherId: TEACHER,
        status: 'PENDING',
        startDate: new Date('2026-07-20'),
        endDate: new Date('2026-07-22'),
      });
      txMock.leaveApplication.update.mockResolvedValue({});

      const result = await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

      expect(txMock.leaveApplication.update).toHaveBeenCalledWith({
        where: { id: LEAVE_ID },
        data: { status: 'CANCELLED' },
      });
      expect(txMock.substitution.deleteMany).not.toHaveBeenCalled();
      expect(txMock.staffAttendance.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'CANCELLED', restoredDates: 0 });
    });

    it('lets the owning teacher cancel their own PENDING application', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({
        id: LEAVE_ID,
        schoolId: SCHOOL,
        teacherId: TEACHER,
        status: 'PENDING',
        startDate: new Date('2026-07-20'),
        endDate: new Date('2026-07-20'),
      });
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER });
      txMock.leaveApplication.update.mockResolvedValue({});

      const result = await svc.cancel(SCHOOL, LEAVE_ID, TEACHER_USER, 'TEACHER');

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, userId: TEACHER_USER } });
      expect(result).toEqual({ status: 'CANCELLED', restoredDates: 0 });
    });

    describe('an APPROVED application', () => {
      // Same fixed "now" as the approve auto-mark tests: 2026-07-21 is IST today.
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
        txMock.leaveApplication.findFirst.mockResolvedValue({
          id: LEAVE_ID,
          schoolId: SCHOOL,
          teacherId: TEACHER,
          status: 'APPROVED',
          startDate: new Date('2026-07-20'), // past
          endDate: new Date('2026-07-22'), // today + 1 future day
        });
        txMock.leaveApplication.update.mockResolvedValue({});
        txMock.substitution.deleteMany.mockResolvedValue({ count: 1 });
      });

      it('deletes future Substitution gaps and clears future ON_LEAVE marks, but never touches the past date', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-x', status: 'ON_LEAVE' });
        txMock.staffAttendance.delete.mockResolvedValue({});

        const result = await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        // Only 07-21 and 07-22 (today + future) are processed — 07-20 is past.
        expect(txMock.substitution.deleteMany).toHaveBeenCalledTimes(2);
        expect(txMock.substitution.deleteMany).toHaveBeenCalledWith({
          where: { schoolId: SCHOOL, originalTeacherId: TEACHER, date: new Date('2026-07-21') },
        });
        expect(txMock.substitution.deleteMany).toHaveBeenCalledWith({
          where: { schoolId: SCHOOL, originalTeacherId: TEACHER, date: new Date('2026-07-22') },
        });
        expect(txMock.substitution.deleteMany).not.toHaveBeenCalledWith({
          where: { schoolId: SCHOOL, originalTeacherId: TEACHER, date: new Date('2026-07-20') },
        });

        expect(txMock.staffAttendance.delete).toHaveBeenCalledTimes(2);
        expect(txMock.staffAttendance.delete).toHaveBeenCalledWith({ where: { id: 'mark-x' } });

        expect(txMock.leaveApplication.update).toHaveBeenCalledWith({
          where: { id: LEAVE_ID },
          data: { status: 'CANCELLED' },
        });
        expect(result).toEqual({ status: 'CANCELLED', restoredDates: 2 });
      });

      it('does not delete a StaffAttendance mark that was manually changed away from ON_LEAVE', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-y', status: 'ABSENT' });

        await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        expect(txMock.staffAttendance.delete).not.toHaveBeenCalled();
      });

      it('lets the owning teacher cancel their own APPROVED leave', async () => {
        txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER });
        txMock.staffAttendance.findFirst.mockResolvedValue(null);

        const result = await svc.cancel(SCHOOL, LEAVE_ID, TEACHER_USER, 'TEACHER');

        expect(result).toEqual({ status: 'CANCELLED', restoredDates: 2 });
      });

      it('rejects a different teacher trying to cancel someone else\'s APPROVED leave', async () => {
        txMock.teacher.findFirst.mockResolvedValue({ id: 'not-the-owner' });

        await expect(svc.cancel(SCHOOL, LEAVE_ID, 'other-teacher-user', 'TEACHER')).rejects.toMatchObject({
          response: { code: 'LEAVE_CANCEL_FORBIDDEN' },
        });
        expect(txMock.substitution.deleteMany).not.toHaveBeenCalled();
      });

      it('is a no-op restore when the whole leave window is already in the past', async () => {
        txMock.leaveApplication.findFirst.mockResolvedValue({
          id: LEAVE_ID,
          schoolId: SCHOOL,
          teacherId: TEACHER,
          status: 'APPROVED',
          startDate: new Date('2026-07-18'),
          endDate: new Date('2026-07-19'),
        });

        const result = await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        expect(txMock.substitution.deleteMany).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.findFirst).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'CANCELLED', restoredDates: 0 });
      });
    });
  });

  describe('assign', () => {
    const dto: AssignSubstitutionDto = { substituteTeacherId: OTHER_TEACHER };

    function mockGap() {
      txMock.substitution.findFirst.mockResolvedValue({
        id: SUB_ID,
        schoolId: SCHOOL,
        date: new Date('2026-07-20'), // Monday -> dayOfWeek 1
        periodId: PERIOD,
      });
    }

    it('sets the substitute when the teacher is free', async () => {
      // First `substitution.findFirst` call looks up the gap itself; the
      // second is the "already covering another gap" clash check.
      txMock.substitution.findFirst
        .mockResolvedValueOnce({ id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD })
        .mockResolvedValueOnce(null);
      txMock.teacher.findFirst.mockResolvedValue({ id: OTHER_TEACHER });
      txMock.timetableSlot.findFirst.mockResolvedValue(null); // no regular clash
      txMock.substitution.update.mockResolvedValue({ id: SUB_ID, substituteTeacherId: OTHER_TEACHER });

      const result = await svc.assign(SCHOOL, SUB_ID, dto);

      expect(txMock.substitution.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { substituteTeacherId: OTHER_TEACHER },
      });
      expect(result).toEqual({ id: SUB_ID, substituteTeacherId: OTHER_TEACHER });
    });

    it('throws TEACHER_CONFLICT when the substitute already has a regular class in that period', async () => {
      mockGap();
      txMock.teacher.findFirst.mockResolvedValue({ id: OTHER_TEACHER });
      txMock.timetableSlot.findFirst.mockResolvedValue({ id: 'busy-slot' });

      await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toMatchObject({
        response: { code: 'TEACHER_CONFLICT' },
      });
      expect(txMock.substitution.update).not.toHaveBeenCalled();
    });

    it('throws TEACHER_CONFLICT when the substitute is already covering another gap at that date+period', async () => {
      txMock.substitution.findFirst
        .mockResolvedValueOnce({ id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD })
        .mockResolvedValueOnce({ id: 'other-gap' });
      txMock.teacher.findFirst.mockResolvedValue({ id: OTHER_TEACHER });
      txMock.timetableSlot.findFirst.mockResolvedValue(null);

      await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toMatchObject({
        response: { code: 'TEACHER_CONFLICT' },
      });
      expect(txMock.substitution.update).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('nulls out the substitute', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ id: SUB_ID, schoolId: SCHOOL });
      txMock.substitution.update.mockResolvedValue({ id: SUB_ID, substituteTeacherId: null });

      const result = await svc.clear(SCHOOL, SUB_ID);

      expect(txMock.substitution.update).toHaveBeenCalledWith({
        where: { id: SUB_ID },
        data: { substituteTeacherId: null },
      });
      expect(result.substituteTeacherId).toBeNull();
    });
  });

  describe('list', () => {
    it('defaults to PENDING and joins the teacher name', async () => {
      txMock.leaveApplication.findMany.mockResolvedValue([
        { id: LEAVE_ID, teacherId: TEACHER, status: 'PENDING' },
      ]);
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao' }]);

      const result = await svc.list(SCHOOL);

      expect(txMock.leaveApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { schoolId: SCHOOL, status: 'PENDING' } }),
      );
      expect(result).toEqual([
        { id: LEAVE_ID, teacherId: TEACHER, status: 'PENDING', teacherName: 'Asha Rao' },
      ]);
    });

    it('rejects an invalid status value', async () => {
      await expect(svc.list(SCHOOL, 'BOGUS')).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    });
  });
});

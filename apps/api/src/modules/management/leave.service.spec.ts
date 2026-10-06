import 'reflect-metadata';

const txMock = {
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  // Leave is no longer a teachers-only idea: every read resolves the caller
  // to a Teacher OR a Staff row, so the mock has to answer for both.
  staff: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  leaveTypeDef: { findFirst: jest.fn() },
  leaveApplication: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  timetableSlot: { findMany: jest.fn(), findFirst: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
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
  classSection: { findMany: jest.fn(), findFirst: jest.fn() },
  period: { findMany: jest.fn(), findFirst: jest.fn() },
  // The notices apply/approve/reject/assign write: no admins, no school name,
  // no slots → every notice is a no-op in the tests above, and the two tests
  // at the bottom prove the writes themselves.
  school: { findFirst: jest.fn().mockResolvedValue({ name: 'Raffles' }), findUnique: jest.fn() },
  // The school calendar approve() covers on: Mon–Sat, no holidays, unless a test says otherwise.
  holiday: { findMany: jest.fn() },
  user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
  notification: { create: jest.fn() },
  notificationOutbox: { create: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { LeaveService } from './leave.service';
import { ApiError } from '../../common/errors/api-error';
import { CreateLeaveDto as CreateLeaveDtoClass } from './management.dto';
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
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
    txMock.user.findMany.mockResolvedValue([]);
    txMock.timetableSlot.groupBy.mockResolvedValue([]);
    // `apply()` resolves the school's LeaveTypeDef for the picked type;
    // null = the school never opened its leave policy (pre-policy behaviour).
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
    txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });
    txMock.holiday.findMany.mockResolvedValue([]);
  });

  describe('apply', () => {
    const dto: CreateLeaveDto = { type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-22' };

    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-19T03:00:00.000Z')); // IST 19 Jul, 08:30
      txMock.leaveApplication.findMany.mockResolvedValue([]); // no other leave
    });
    afterEach(() => jest.useRealTimers());

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

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, userId: TEACHER_USER },
        select: { id: true, firstName: true, lastName: true, isActive: true },
      });
      expect(txMock.leaveApplication.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          teacherId: TEACHER,
          staffId: null,
          halfDay: false,
          halfDayPart: null,
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
      txMock.staff.findFirst.mockResolvedValue(null);

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

    describe('refuses what a school cannot act on', () => {
      beforeEach(() => {
        txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', isActive: true });
        txMock.leaveApplication.create.mockResolvedValue({ id: LEAVE_ID, teacherId: TEACHER, status: 'PENDING', type: 'SICK', startDate: new Date('2026-07-19'), endDate: new Date('2026-07-19'), reason: null, createdAt: new Date() });
      });

      it('a start date that has already gone (IST) is refused before any query', async () => {
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-18', endDate: '2026-07-19' })).rejects.toMatchObject({ response: { code: 'LEAVE_IN_PAST', field: 'startDate' } });
        expect(withTenantMock).not.toHaveBeenCalled();
      });

      it('today itself is fine', async () => {
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-19', endDate: '2026-07-19' })).resolves.toMatchObject({ status: 'PENDING' });
      });

      it('60 days is the most one request can cover; 61 is refused', async () => {
        // 20 Jul → 17 Sep inclusive: 12 + 31 + 17 = 60 days.
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'UNPAID', startDate: '2026-07-20', endDate: '2026-09-17' })).resolves.toBeDefined();
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'UNPAID', startDate: '2026-07-20', endDate: '2026-09-18' })).rejects.toMatchObject({ response: { code: 'LEAVE_TOO_LONG' } });
      });

      it('an overlap with pending or approved leave is refused, naming those dates', async () => {
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-22'), endDate: new Date('2026-07-23'), status: 'APPROVED', halfDay: false, halfDayPart: null }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-21', endDate: '2026-07-22' })).rejects.toMatchObject({
          response: { code: 'LEAVE_OVERLAP', message: expect.stringContaining('approved leave for Wed 22 – Thu 23 Jul 2026') },
        });
        expect(txMock.leaveApplication.findMany.mock.calls[0][0].where).toEqual({
          schoolId: SCHOOL, teacherId: TEACHER, status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: new Date('2026-07-22') }, endDate: { gte: new Date('2026-07-21') },
        });
        expect(txMock.leaveApplication.create).not.toHaveBeenCalled();
      });

      it('the morning and the afternoon of one day are two halves, not a clash', async () => {
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-21'), endDate: new Date('2026-07-21'), status: 'PENDING', halfDay: true, halfDayPart: 'AM' }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'CASUAL', startDate: '2026-07-21', endDate: '2026-07-21', halfDay: true, halfDayPart: 'PM' })).resolves.toBeDefined();
        expect(txMock.leaveApplication.create.mock.calls[0][0].data).toMatchObject({ halfDay: true, halfDayPart: 'PM' });
      });

      it('two half days of the SAME half are a clash', async () => {
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-21'), endDate: new Date('2026-07-21'), status: 'PENDING', halfDay: true, halfDayPart: 'AM' }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'CASUAL', startDate: '2026-07-21', endDate: '2026-07-21', halfDay: true, halfDayPart: 'AM' })).rejects.toMatchObject({ response: { code: 'LEAVE_OVERLAP' } });
      });

      it('a full day clashes with a half day, either way round', async () => {
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-21'), endDate: new Date('2026-07-21'), status: 'PENDING', halfDay: true, halfDayPart: 'AM' }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'CASUAL', startDate: '2026-07-21', endDate: '2026-07-21' })).rejects.toMatchObject({ response: { code: 'LEAVE_OVERLAP' } });
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-21'), endDate: new Date('2026-07-21'), status: 'APPROVED', halfDay: false, halfDayPart: null }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'CASUAL', startDate: '2026-07-21', endDate: '2026-07-21', halfDay: true, halfDayPart: 'PM' })).rejects.toMatchObject({ response: { code: 'LEAVE_OVERLAP' } });
      });

      it('two full days on the same date are a clash', async () => {
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-21'), endDate: new Date('2026-07-21'), status: 'PENDING', halfDay: false, halfDayPart: null }]);
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'CASUAL', startDate: '2026-07-21', endDate: '2026-07-21' })).rejects.toMatchObject({ response: { code: 'LEAVE_OVERLAP' } });
      });

      it('an older app sends a half day with no part: still accepted, stored with no part', async () => {
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'CASUAL', startDate: '2026-07-21', endDate: '2026-07-21', halfDay: true })).resolves.toBeDefined();
        expect(txMock.leaveApplication.create.mock.calls[0][0].data).toMatchObject({ halfDay: true, halfDayPart: null });
      });

      it('a teacher who has left cannot apply', async () => {
        txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', isActive: false });
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20' })).rejects.toMatchObject({ response: { code: 'LEAVE_INACTIVE' } });
      });

      it('morning/afternoon without a half day is refused', async () => {
        await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20', halfDayPart: 'AM' })).rejects.toMatchObject({ response: { code: 'VALIDATION', field: 'halfDayPart' } });
      });

      describe('with the process in UTC', () => {
        const before = process.env.TZ;
        afterEach(() => { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; });

        it('at 20:00 UTC it is already tomorrow in IST: yesterday-in-IST is refused, IST today is allowed', async () => {
          process.env.TZ = 'UTC';
          jest.setSystemTime(new Date('2026-07-19T20:00:00.000Z')); // IST 20 Jul, 01:30
          await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-19', endDate: '2026-07-19' })).rejects.toMatchObject({ response: { code: 'LEAVE_IN_PAST' } });
          await expect(svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20' })).resolves.toBeDefined();
        });
      });
    });

    describe('the request body (DTO)', () => {
      const check = async (body: object) => {
        const { validate } = await import('class-validator');
        const { plainToInstance } = await import('class-transformer');
        return validate(plainToInstance(CreateLeaveDtoClass, body));
      };
      it('takes AM and PM, nothing else', async () => {
        expect(await check({ type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20', halfDay: true, halfDayPart: 'PM' })).toHaveLength(0);
        expect((await check({ type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20', halfDay: true, halfDayPart: 'NOON' })).map((e) => e.property)).toEqual(['halfDayPart']);
      });
      it('an older app\'s half day with no part still validates', async () => {
        expect(await check({ type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-20', halfDay: true })).toHaveLength(0);
      });
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

      expect(txMock.leaveApplication.updateMany).toHaveBeenCalledWith({
        where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedById: ADMIN_USER, reviewedAt: expect.any(Date) },
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
          leaveApplicationId: LEAVE_ID,
        },
      });
      expect(result).toEqual({ gaps: 2, gapIds: [undefined, undefined] }); // the mock's create returns nothing; the count is what matters here
    });

    it('is idempotent: skips creating a gap that already exists for that slot/date', async () => {
      mockPendingLeave();
      txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD }]);
      // Every date's slot already has a Substitution row.
      txMock.substitution.findFirst.mockResolvedValue({ id: 'already-there' });

      const result = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

      expect(txMock.substitution.create).not.toHaveBeenCalled();
      expect(result).toEqual({ gaps: 0, gapIds: [] });
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
      expect(txMock.leaveApplication.updateMany).not.toHaveBeenCalled();
    });

    describe('two desks at once', () => {
      // "Now" is 9:42 am IST's own day, so the loser hears just the clock time.
      beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-07-20T06:00:00Z')));
      afterEach(() => jest.useRealTimers());

      it('two desks approve at once: the one whose update finds no PENDING row is told who won, and when', async () => {
        mockPendingLeave();
        txMock.leaveApplication.updateMany.mockResolvedValue({ count: 0 });
        txMock.leaveApplication.findFirst
          .mockResolvedValueOnce({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') })
          .mockResolvedValueOnce({ status: 'APPROVED', reviewedById: 'u-head', reviewedAt: new Date('2026-07-20T04:12:00Z') });
        txMock.user.findFirst.mockResolvedValue({ name: 'Darshan Jain', email: 'head@x' });
        await expect(svc.approve(SCHOOL, LEAVE_ID, 'u-accounts')).rejects.toMatchObject({
          response: { code: 'LEAVE_NOT_PENDING', message: expect.stringMatching(/^Already approved by Darshan Jain at 9:42\s?am\. Nothing changed\.$/i) },
          status: 409,
        });
        // The loser writes NOTHING: no gap, no attendance mark, no bell, no outbox row.
        expect(txMock.substitution.create).not.toHaveBeenCalled();
        expect(txMock.timetableSlot.findMany).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.create).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.update).not.toHaveBeenCalled();
        expect(txMock.notification.create).not.toHaveBeenCalled();
        expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
        expect(txMock.user.findFirst).toHaveBeenCalledWith({ where: { id: 'u-head', schoolId: SCHOOL }, select: { name: true, email: true } });
      });

      it('a reject that loses the race is told the same way', async () => {
        mockPendingLeave();
        txMock.leaveApplication.updateMany.mockResolvedValue({ count: 0 });
        txMock.leaveApplication.findFirst
          .mockResolvedValueOnce({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') })
          .mockResolvedValueOnce({ status: 'APPROVED', reviewedById: 'u-head', reviewedAt: new Date('2026-07-20T04:12:00Z') });
        txMock.user.findFirst.mockResolvedValue({ name: null, email: 'head@x' });
        await expect(svc.reject(SCHOOL, LEAVE_ID, 'u-accounts')).rejects.toMatchObject({
          response: { code: 'LEAVE_NOT_PENDING', message: 'Already approved by head at 9:42 am. Nothing changed.' },
        });
        expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
      });
    });

    it('nobody decides their own leave — not the accounts officer, not an admin who teaches', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: null, staffId: 'staff-acc', status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') });
      txMock.staff.findFirst.mockResolvedValue({ userId: 'u-accounts' });
      await expect(svc.approve(SCHOOL, LEAVE_ID, 'u-accounts')).rejects.toMatchObject({ response: { code: 'LEAVE_OWN_DECISION' }, status: 403 });
      await expect(svc.reject(SCHOOL, LEAVE_ID, 'u-accounts')).rejects.toMatchObject({ response: { code: 'LEAVE_OWN_DECISION' } });
      expect(txMock.leaveApplication.updateMany).not.toHaveBeenCalled();
      // …and the admin who also teaches, on their own teacher leave.
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, staffId: null, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') });
      txMock.teacher.findFirst.mockResolvedValue({ userId: ADMIN_USER });
      await expect(svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER)).rejects.toMatchObject({ response: { code: 'LEAVE_OWN_DECISION' } });
      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { id: TEACHER, schoolId: SCHOOL }, select: { userId: true } });
      expect(txMock.leaveApplication.updateMany).not.toHaveBeenCalled();
      txMock.staff.findFirst.mockResolvedValue(null);
      txMock.teacher.findFirst.mockResolvedValue(null);
    });

    describe('only the classes that would really be empty', () => {
      const leaveOf = (o: Record<string, unknown>) => txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, staffId: null, status: 'PENDING', ...o });
      const live = (d: string) => ({
        effectiveFrom: { lte: new Date(`${d}T00:00:00+05:30`) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(`${d}T00:00:00+05:30`) } }],
      });
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-01T03:00:00.000Z'));
        txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
        txMock.substitution.findFirst.mockResolvedValue(null);
        txMock.substitution.create.mockImplementation(async ({ data }: { data: { periodId: string; date: Date } }) => ({ id: `${data.periodId}@${data.date.toISOString().slice(0, 10)}` }));
        txMock.staffAttendance.findFirst.mockResolvedValue(null);
        txMock.staffAttendance.create.mockResolvedValue({});
      });
      afterEach(() => {
        jest.useRealTimers();
        txMock.substitution.create.mockReset();
        txMock.timetableSlot.findMany.mockReset();
      });

      it('Diwali inside the span: no gap and no ON_LEAVE mark that day', async () => {
        leaveOf({ startDate: new Date('2026-11-09'), endDate: new Date('2026-11-11') }); // Mon–Wed
        txMock.holiday.findMany.mockResolvedValue([{ name: 'Diwali', startDate: new Date('2026-11-09'), endDate: null }]);
        txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual([`${PERIOD}@2026-11-10`, `${PERIOD}@2026-11-11`]);
        expect(txMock.staffAttendance.create.mock.calls.map((c) => c[0].data.date)).toEqual([new Date('2026-11-10'), new Date('2026-11-11')]);
        // Diwali's timetable is never even asked for.
        expect(txMock.timetableSlot.findMany.mock.calls.map((c) => c[0].where.effectiveFrom.lte)).toEqual([
          new Date('2026-11-10T00:00:00+05:30'),
          new Date('2026-11-11T00:00:00+05:30'),
        ]);
      });

      it('a Sunday inside the span: the Saturday and Monday are covered, the Sunday is not', async () => {
        leaveOf({ startDate: new Date('2026-11-14'), endDate: new Date('2026-11-16') }); // Sat–Mon
        txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r).toEqual({ gaps: 2, gapIds: [`${PERIOD}@2026-11-14`, `${PERIOD}@2026-11-16`] });
        expect(txMock.timetableSlot.findMany.mock.calls.map((c) => c[0].where.dayOfWeek)).toEqual([6, 1]);
        expect(txMock.staffAttendance.create.mock.calls.map((c) => c[0].data.date)).toEqual([new Date('2026-11-14'), new Date('2026-11-16')]);
      });

      it('a Mon–Fri school: the Saturday is not a working day either', async () => {
        txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5] });
        leaveOf({ startDate: new Date('2026-11-13'), endDate: new Date('2026-11-16') }); // Fri–Mon
        txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual([`${PERIOD}@2026-11-13`, `${PERIOD}@2026-11-16`]);
        expect(txMock.school.findUnique).toHaveBeenCalledWith({ where: { id: SCHOOL }, select: { workingDays: true } });
        expect(txMock.holiday.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL });
      });

      it('a leave that falls wholly on holidays is approved with no gap and no mark', async () => {
        leaveOf({ startDate: new Date('2026-11-09'), endDate: new Date('2026-11-10') });
        txMock.holiday.findMany.mockResolvedValue([{ name: 'Diwali break', startDate: new Date('2026-11-09'), endDate: new Date('2026-11-10') }]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r).toEqual({ gaps: 0, gapIds: [] });
        expect(txMock.timetableSlot.findMany).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.create).not.toHaveBeenCalled();
        // Still approved, and the teacher still hears.
        expect(txMock.leaveApplication.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
      });

      it('asks only for slots LIVE on that date, not every slot that was ever active', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(txMock.timetableSlot.findMany.mock.calls[0][0].where).toEqual({
          schoolId: SCHOOL, teacherId: TEACHER, dayOfWeek: 3,
          effectiveFrom: { lte: new Date('2026-11-11T00:00:00+05:30') },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date('2026-11-11T00:00:00+05:30') } }],
        });
        expect(txMock.timetableSlot.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
      });

      it('a timetable published mid-leave: each day is covered from the version live THAT day', async () => {
        // Old version ran to Thu 12 Nov (effectiveTo = 12 Nov IST midnight); the new one starts that day.
        const NEW_FROM = new Date('2026-11-12T00:00:00+05:30');
        const versions = [
          { classSectionId: CLASS_SECTION, periodId: 'old-p2', period: { startTime: '9:00' }, effectiveFrom: new Date('2026-04-01T00:00:00+05:30'), effectiveTo: NEW_FROM },
          { classSectionId: CLASS_SECTION, periodId: 'new-p4', period: { startTime: '10:30' }, effectiveFrom: NEW_FROM, effectiveTo: null },
        ];
        txMock.timetableSlot.findMany.mockImplementation(async ({ where }: { where: { effectiveFrom: { lte: Date } } }) => {
          const asOf = where.effectiveFrom.lte.getTime();
          return versions.filter((v) => v.effectiveFrom.getTime() <= asOf && (v.effectiveTo === null || v.effectiveTo.getTime() > asOf));
        });
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-12') }); // Wed–Thu
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual(['old-p2@2026-11-11', 'new-p4@2026-11-12']);
        expect(txMock.timetableSlot.findMany.mock.calls[1][0].where).toMatchObject(live('2026-11-12'));
      });

      it('a day the teacher has no class: no gap, but still marked ON_LEAVE', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-12') });
        txMock.timetableSlot.findMany.mockImplementation(async ({ where }: { where: { dayOfWeek: number } }) =>
          where.dayOfWeek === 3 ? [] : [{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }],
        );
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual([`${PERIOD}@2026-11-12`]);
        expect(txMock.staffAttendance.create.mock.calls.map((c) => c[0].data.date)).toEqual([new Date('2026-11-11'), new Date('2026-11-12')]);
      });

      it('a half day PM leaves only the afternoon periods to cover — "8:00" is morning', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11'), halfDay: true, halfDayPart: 'PM' });
        txMock.timetableSlot.findMany.mockResolvedValue([
          { classSectionId: CLASS_SECTION, periodId: 'p1', period: { startTime: '8:00' } },
          { classSectionId: CLASS_SECTION, periodId: 'p6', period: { startTime: '12:40' } },
        ]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual(['p6@2026-11-11']);
        // A half day keeps the day's ON_LEAVE mark: there is no half-day attendance status.
        expect(txMock.staffAttendance.create).toHaveBeenCalledTimes(1);
      });

      it('a half day AM leaves only the morning periods; "1:30 pm" is afternoon', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11'), halfDay: true, halfDayPart: 'AM' });
        txMock.timetableSlot.findMany.mockResolvedValue([
          { classSectionId: CLASS_SECTION, periodId: 'p1', period: { startTime: '8:00' } },
          { classSectionId: CLASS_SECTION, periodId: 'p5', period: { startTime: '11:55' } },
          { classSectionId: CLASS_SECTION, periodId: 'p7', period: { startTime: '1:30 pm' } },
        ]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual(['p1@2026-11-11', 'p5@2026-11-11']);
      });

      it('a half day whose period time nobody can read: that period is covered rather than left empty', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11'), halfDay: true, halfDayPart: 'PM' });
        txMock.timetableSlot.findMany.mockResolvedValue([
          { classSectionId: CLASS_SECTION, periodId: 'p1', period: { startTime: '8:00' } },
          { classSectionId: CLASS_SECTION, periodId: 'pX', period: { startTime: 'after lunch' } },
          { classSectionId: CLASS_SECTION, periodId: 'pY', period: null },
        ]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual(['pX@2026-11-11', 'pY@2026-11-11']);
      });

      it('a half day from an older app (no part) covers every period of the day, as before', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11'), halfDay: true, halfDayPart: null });
        txMock.timetableSlot.findMany.mockResolvedValue([
          { classSectionId: CLASS_SECTION, periodId: 'p1', period: { startTime: '8:00' } },
          { classSectionId: CLASS_SECTION, periodId: 'p6', period: { startTime: '12:40' } },
        ]);
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r.gapIds).toEqual(['p1@2026-11-11', 'p6@2026-11-11']);
      });

      it('every gap names the leave it was opened for', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(txMock.substitution.create.mock.calls[0][0].data.leaveApplicationId).toBe(LEAVE_ID);
      });

      it('the gaps are written AFTER the winning conditional update, inside the same transaction', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([{ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime: '9:00' } }]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(withTenantMock).toHaveBeenCalledTimes(1);
        expect(txMock.leaveApplication.updateMany.mock.invocationCallOrder[0]).toBeLessThan(txMock.school.findUnique.mock.invocationCallOrder[0]);
        expect(txMock.leaveApplication.updateMany.mock.invocationCallOrder[0]).toBeLessThan(txMock.substitution.create.mock.invocationCallOrder[0]);
      });

      it('a staff member\'s leave opens no gaps and asks no timetable', async () => {
        leaveOf({ teacherId: null, staffId: 'staff-driver', startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        const r = await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(r).toEqual({ gaps: 0, gapIds: [] });
        expect(txMock.timetableSlot.findMany).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.create).not.toHaveBeenCalled();
      });
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
      expect(txMock.leaveApplication.updateMany).not.toHaveBeenCalled();
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
      expect(txMock.leaveApplication.updateMany).not.toHaveBeenCalled();
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
      const result = await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

      expect(txMock.leaveApplication.updateMany).toHaveBeenCalledTimes(1);
      expect(txMock.leaveApplication.updateMany).toHaveBeenCalledWith({
        where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'PENDING' },
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

      const result = await svc.cancel(SCHOOL, LEAVE_ID, TEACHER_USER, 'TEACHER');

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, userId: TEACHER_USER },
        select: { id: true, firstName: true, lastName: true, isActive: true },
      });
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

        expect(txMock.leaveApplication.updateMany).toHaveBeenCalledWith({
          where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'APPROVED' },
          data: { status: 'CANCELLED' },
        });
        // The row is claimed BEFORE anything is unwound.
        expect(txMock.leaveApplication.updateMany.mock.invocationCallOrder[0])
          .toBeLessThan(txMock.substitution.deleteMany.mock.invocationCallOrder[0]);
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

      it('a second cancel racing the first unwinds NOTHING: its claim matches no APPROVED row, and it is told', async () => {
        txMock.leaveApplication.updateMany.mockResolvedValue({ count: 0 });
        txMock.leaveApplication.findFirst
          .mockResolvedValueOnce({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'APPROVED', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-22') })
          .mockResolvedValueOnce({ status: 'CANCELLED', reviewedById: 'u-head', reviewedAt: new Date('2026-07-20T04:12:00Z') });

        await expect(svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
          // A cancel stamps no reviewer, so the approver is NOT named as the canceller.
          response: { code: 'LEAVE_NOT_PENDING', message: 'Already withdrawn. Nothing changed.' },
          status: 409,
        });
        expect(txMock.substitution.deleteMany).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.findFirst).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.delete).not.toHaveBeenCalled();
        expect(txMock.user.findFirst).not.toHaveBeenCalled();
      });
    });

    describe('a PENDING cancel racing a decision', () => {
      beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z')));

      it('loses to an APPROVE: the approval is unwound in the same transaction — no orphaned gaps or ON_LEAVE marks', async () => {
        txMock.leaveApplication.findFirst
          .mockResolvedValueOnce({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-22') })
          .mockResolvedValueOnce({ status: 'APPROVED' });
        txMock.leaveApplication.updateMany
          .mockResolvedValueOnce({ count: 0 }) // PENDING → CANCELLED: the approve got there first
          .mockResolvedValueOnce({ count: 1 }); // APPROVED → CANCELLED: ours
        txMock.substitution.deleteMany.mockResolvedValue({ count: 1 });
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-x', status: 'ON_LEAVE' });
        txMock.staffAttendance.delete.mockResolvedValue({});

        const result = await svc.cancel(SCHOOL, LEAVE_ID, TEACHER_USER, 'SCHOOL_ADMIN');

        expect(txMock.leaveApplication.updateMany).toHaveBeenNthCalledWith(1, { where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        expect(txMock.leaveApplication.updateMany).toHaveBeenNthCalledWith(2, { where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'APPROVED' }, data: { status: 'CANCELLED' } });
        expect(txMock.substitution.deleteMany).toHaveBeenCalledTimes(2); // 07-21 and 07-22; 07-20 is past
        expect(txMock.staffAttendance.delete).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ status: 'CANCELLED', restoredDates: 2 });
      });

      it('loses to a REJECT: 409 naming who rejected, and nothing is written', async () => {
        txMock.leaveApplication.findFirst
          .mockResolvedValueOnce({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-22') })
          .mockResolvedValueOnce({ status: 'REJECTED' })
          .mockResolvedValueOnce({ status: 'REJECTED', reviewedById: 'u-head', reviewedAt: new Date('2026-07-21T02:30:00Z') });
        txMock.leaveApplication.updateMany.mockResolvedValueOnce({ count: 0 });
        txMock.user.findFirst.mockResolvedValueOnce({ name: 'Darshan Jain', email: 'head@x' });

        await expect(svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
          response: { code: 'LEAVE_NOT_PENDING', message: 'Already rejected by Darshan Jain at 8:00 am. Nothing changed.' },
          status: 409,
        });
        expect(txMock.leaveApplication.updateMany).toHaveBeenCalledTimes(1);
        expect(txMock.substitution.deleteMany).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.findFirst).not.toHaveBeenCalled();
        expect(txMock.staffAttendance.delete).not.toHaveBeenCalled();
        expect(txMock.leaveApplication.update).not.toHaveBeenCalled();
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
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao', userId: TEACHER_USER }]);

      const result = await svc.list(SCHOOL);

      expect(txMock.leaveApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { schoolId: SCHOOL, status: 'PENDING' } }),
      );
      expect(result).toEqual([
        { id: LEAVE_ID, teacherId: TEACHER, status: 'PENDING', teacherName: 'Asha Rao', personKind: 'TEACHER', personUserId: TEACHER_USER },
      ]);
    });

    it('rejects an invalid status value', async () => {
      await expect(svc.list(SCHOOL, 'BOGUS')).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    });
  });
});

describe('LeaveService notices', () => {
  const svc = new LeaveService();
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T03:00:00.000Z'));
    txMock.leaveApplication.findMany.mockResolvedValue([]);
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
    txMock.timetableSlot.groupBy.mockResolvedValue([{ dayOfWeek: 1, _count: { _all: 3 } }, { dayOfWeek: 2, _count: { _all: 2 } }]);
  });

  it('apply writes a bell row and a guaranteed outbox row for EVERY admin, with the periods to cover counted from the timetable', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 't1', firstName: 'Priya', lastName: 'Nair' });
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.leaveApplication.create.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: 't1', type: 'CASUAL', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-22'), reason: 'Family function', status: 'PENDING', reviewedById: null, reviewedAt: null, createdAt: new Date() });
    txMock.user.findMany.mockResolvedValue([{ id: 'a1', email: 'a1@x' }, { id: 'a2', email: 'a2@x' }]);
    await svc.apply('S', 'u-teacher', { type: 'CASUAL', startDate: '2026-09-21', endDate: '2026-09-22', reason: 'Family function' } as never);
    expect(txMock.user.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: 'S', role: 'SCHOOL_ADMIN', isActive: true });
    expect(txMock.notification.create).toHaveBeenCalledTimes(2);
    expect(txMock.notificationOutbox.create).toHaveBeenCalledTimes(2);
    const row = txMock.notificationOutbox.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ schoolId: 'S', kind: 'LEAVE_APPLIED', targetUserId: 'a1' });
    // Mon 21 (3 periods) + Tue 22 (2 periods) = 5; the signed buttons are NOT on the row.
    expect(row.payload).toEqual({ schoolName: 'Raffles', leaveId: 'l1', teacherName: 'Priya Nair', dates: 'Mon 21 – Tue 22 Sep 2026', days: 2, reason: 'Family function', periodsAffected: 5 });
  });

  it('apply tells the accounts officer too — she runs the desk the guard lets her into', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 't1', firstName: 'Priya', lastName: 'Nair' });
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.leaveApplication.create.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: 't1', type: 'CASUAL', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21'), reason: null, status: 'PENDING', reviewedById: null, reviewedAt: null, createdAt: new Date() });
    txMock.user.findMany.mockResolvedValueOnce([{ id: 'a1', email: 'a1@x' }]).mockResolvedValueOnce([{ id: 'acc', email: 'acc@x' }]);
    txMock.staff.findMany.mockResolvedValueOnce([{ userId: 'acc' }]);
    await svc.apply('S', 'u-teacher', { type: 'CASUAL', startDate: '2026-09-21', endDate: '2026-09-21' } as never);
    expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.targetUserId)).toEqual(['a1', 'acc']);
    expect(txMock.notification.create).toHaveBeenCalledTimes(2);
  });

  it('an accounts officer applying for her own leave is not asked to approve it', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    txMock.staff.findFirst.mockResolvedValue({ id: 'st-acc', firstName: 'Meera', lastName: 'Shah' });
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.leaveApplication.create.mockResolvedValue({ id: 'l2', schoolId: 'S', teacherId: null, staffId: 'st-acc', type: 'CASUAL', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21'), reason: null, status: 'PENDING', reviewedById: null, reviewedAt: null, createdAt: new Date() });
    txMock.user.findMany.mockResolvedValueOnce([{ id: 'a1', email: 'a1@x' }]);
    txMock.staff.findMany.mockResolvedValueOnce([{ userId: 'u-acc' }]);
    await svc.apply('S', 'u-acc', { type: 'CASUAL', startDate: '2026-09-21', endDate: '2026-09-21' } as never);
    expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.targetUserId)).toEqual(['a1']);
    expect(txMock.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('reject tells the teacher, and nothing happens when the teacher has no login', async () => {
    txMock.leaveApplication.findFirst.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: 't1', status: 'PENDING', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21') });
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
    txMock.teacher.findFirst.mockResolvedValue({ userId: 'u-teacher' });
    await svc.reject('S', 'l1', 'u-admin');
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data).toMatchObject({ kind: 'LEAVE_DECIDED', targetUserId: 'u-teacher', payload: { decision: 'REJECTED', dates: 'Mon 21 Sep 2026', leaveId: 'l1' } });
    jest.clearAllMocks();
    txMock.leaveApplication.findFirst.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: 't1', status: 'PENDING', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21') });
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
    txMock.teacher.findFirst.mockResolvedValue({ userId: null });
    await svc.reject('S', 'l1', 'u-admin');
    expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('the decision names the decider', async () => {
    txMock.leaveApplication.findFirst.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: 't1', status: 'PENDING', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21') });
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
    txMock.teacher.findFirst.mockResolvedValue({ userId: 'u-teacher' });
    txMock.user.findFirst.mockResolvedValue({ name: 'Darshan Jain', email: 'head@x' });
    await svc.reject('S', 'l1', 'u-admin');
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data.payload.byName).toBe('Darshan Jain');
    txMock.user.findFirst.mockResolvedValue(null);
  });
});

describe('LeaveService.decidedSentence — the IST clock, whatever the server TZ', () => {
  const tz = process.env.TZ;
  afterAll(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });

  for (const zone of ['UTC', 'America/Los_Angeles']) {
    describe(`with the process TZ at ${zone}`, () => {
      beforeAll(() => { process.env.TZ = zone; });

      it('today in IST: the clock time only', () => {
        // 04:12Z is 9:42 am IST; "now" is the same IST day.
        expect(LeaveService.decidedSentence('APPROVED', 'Darshan Jain', new Date('2026-10-06T04:12:00Z'), new Date('2026-10-06T10:00:00Z')))
          .toBe('Already approved by Darshan Jain at 9:42 am. Nothing changed.');
      });

      it('the IST day, not the UTC one: 18:45Z on the 6th is 12:15 am on the 7th in India, the same day as 19:00Z', () => {
        expect(LeaveService.decidedSentence('REJECTED', 'Asha Rao', new Date('2026-10-06T18:45:00Z'), new Date('2026-10-06T19:00:00Z')))
          .toBe('Already rejected by Asha Rao at 12:15 am. Nothing changed.');
      });

      it('another day: the day is named; the year only when it is not this year', () => {
        expect(LeaveService.decidedSentence('APPROVED', 'Darshan Jain', new Date('2026-10-06T04:12:00Z'), new Date('2026-10-07T04:00:00Z')))
          .toBe('Already approved by Darshan Jain on Tue 6 Oct at 9:42 am. Nothing changed.');
        // 18:45Z on 5 Oct is already Tue 6 Oct in India.
        expect(LeaveService.decidedSentence('APPROVED', 'Darshan Jain', new Date('2026-10-05T18:45:00Z'), new Date('2026-10-07T04:00:00Z')))
          .toBe('Already approved by Darshan Jain on Tue 6 Oct at 12:15 am. Nothing changed.');
        expect(LeaveService.decidedSentence('REJECTED', null, new Date('2025-12-31T10:00:00Z'), new Date('2026-01-02T04:00:00Z')))
          .toBe('Already rejected on Wed 31 Dec 2025 at 3:30 pm. Nothing changed.');
      });

      it('noon and a withdrawn request read naturally; no time when none is recorded', () => {
        expect(LeaveService.decidedSentence('APPROVED', 'X', new Date('2026-10-06T06:30:00Z'), new Date('2026-10-06T07:00:00Z')))
          .toBe('Already approved by X at 12:00 pm. Nothing changed.');
        expect(LeaveService.decidedSentence('CANCELLED', null, null)).toBe('Already withdrawn. Nothing changed.');
      });
    });
  }
});

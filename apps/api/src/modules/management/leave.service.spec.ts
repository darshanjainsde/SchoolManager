import 'reflect-metadata';

const txMock = {
  // Advisory locks (apply's per-person, approve/assign's per-day) and
  // assign's FOR SHARE read of the gap's leave — one row = still APPROVED.
  $queryRaw: jest.fn().mockResolvedValue([{}]),
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
    updateMany: jest.fn(),
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

jest.mock('./internal/free-teachers', () => ({ freeTeachersFor: jest.fn() }));

import { LeaveService } from './leave.service';
import { freeTeachersFor } from './internal/free-teachers';
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
    txMock.$queryRaw.mockResolvedValue([{}]);
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
    txMock.user.findMany.mockResolvedValue([]);
    txMock.timetableSlot.groupBy.mockResolvedValue([]);
    // `apply()` resolves the school's LeaveTypeDef for the picked type;
    // null = the school never opened its leave policy (pre-policy behaviour).
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
    txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });
    txMock.holiday.findMany.mockResolvedValue([]);
    txMock.substitution.findMany.mockResolvedValue([]);
    txMock.substitution.updateMany.mockResolvedValue({ count: 1 });
    txMock.leaveApplication.findMany.mockResolvedValue([]);
    txMock.classSection.findMany.mockResolvedValue([{ id: CLASS_SECTION, name: 'A', grade: { name: '9' } }]);
    txMock.period.findMany.mockResolvedValue([{ id: PERIOD, label: 'Period 3', startTime: '10:15', endTime: '11:00' }]);
    txMock.teacher.findMany.mockResolvedValue([]);
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

      it('a substitute who goes on leave: their covers those days reopen, they are told, the desk is nudged', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([]);
        txMock.substitution.findMany.mockResolvedValue([{ id: 'cover-1', date: new Date('2026-11-11'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: TEACHER }]);
        txMock.substitution.updateMany.mockResolvedValue({ count: 1 });
        txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, userId: TEACHER_USER }]);
        txMock.teacher.findFirst.mockResolvedValue({ userId: TEACHER_USER, firstName: 'Asha', lastName: 'Rao' });
        txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);

        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);

        expect(txMock.substitution.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, substituteTeacherId: TEACHER, date: { in: [new Date('2026-11-11')] } });
        expect(txMock.substitution.updateMany).toHaveBeenCalledWith({ where: { id: 'cover-1', schoolId: SCHOOL, substituteTeacherId: TEACHER }, data: { substituteTeacherId: null, acknowledgedAt: null } });
        const rows = txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data);
        expect(rows).toContainEqual(expect.objectContaining({ kind: 'COVER_CANCELLED', targetUserId: TEACHER_USER, payload: expect.objectContaining({ substitutionId: 'cover-1', why: 'TEACHER_ON_LEAVE' }) }));
        // The approver too: approving did not show them the teacher was covering for others.
        expect(rows).toContainEqual(expect.objectContaining({
          kind: 'COVER_UNFILLED', targetUserId: ADMIN_USER,
          payload: { schoolName: 'Raffles', gaps: 1, forDate: '2026-11-11', forWhen: 'Wed 11 Nov 2026', note: 'Asha Rao is on leave, so one of their covers has reopened.' },
        }));
      });

      it('a morning half day keeps their afternoon covers', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11'), halfDay: true, halfDayPart: 'AM' });
        txMock.timetableSlot.findMany.mockResolvedValue([]);
        txMock.substitution.findMany.mockResolvedValue([
          { id: 'am', date: new Date('2026-11-11'), periodId: 'p-am', classSectionId: CLASS_SECTION, substituteTeacherId: TEACHER },
          { id: 'pm', date: new Date('2026-11-11'), periodId: 'p-pm', classSectionId: CLASS_SECTION, substituteTeacherId: TEACHER },
        ]);
        txMock.period.findMany.mockResolvedValue([{ id: 'p-am', label: 'P1', startTime: '8:00', endTime: '8:45' }, { id: 'p-pm', label: 'P6', startTime: '13:30', endTime: '14:15' }]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(txMock.substitution.updateMany).toHaveBeenCalledTimes(1);
        expect(txMock.substitution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'am', schoolId: SCHOOL, substituteTeacherId: TEACHER } }));
      });

      it('covers on days already gone are history: not reopened, nobody told', async () => {
        jest.setSystemTime(new Date('2026-11-12T03:00:00.000Z'));
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(txMock.substitution.findMany).not.toHaveBeenCalled();
        expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
      });

      it('a teacher covering nobody: no reopen, no desk notice', async () => {
        leaveOf({ startDate: new Date('2026-11-11'), endDate: new Date('2026-11-11') });
        txMock.timetableSlot.findMany.mockResolvedValue([]);
        txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);
        await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
        expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
        expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.kind)).not.toContain('COVER_UNFILLED');
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

    it('withdrawing a PENDING request tells the desk, which was holding Approve buttons for it', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') });
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', isActive: true });
      txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);
      await svc.cancel(SCHOOL, LEAVE_ID, TEACHER_USER, 'TEACHER');
      expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data)).toEqual([
        expect.objectContaining({ kind: 'LEAVE_CANCELLED', targetUserId: ADMIN_USER, payload: { schoolName: 'Raffles', leaveId: LEAVE_ID, teacherName: 'Asha Rao', dates: 'Mon 20 Jul 2026', releasedCovers: 0, unreached: null } }),
      ]);
      expect(txMock.notificationOutbox.create.mock.calls[0][0].select).toEqual({ id: true });
      // Nothing was generated for a pending request, so nothing is unwound.
      expect(txMock.substitution.findMany).not.toHaveBeenCalled();
    });

    it('an admin withdrawing a PENDING request is not told what they just did; the other desk member is', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, status: 'PENDING', startDate: new Date('2026-07-20'), endDate: new Date('2026-07-20') });
      txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Asha', lastName: 'Rao' });
      txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }, { id: 'u-head2', email: 'h2@x' }]);
      await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');
      expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.targetUserId)).toEqual(['u-head2']);
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

      it('removes only THIS leave\'s future gaps (and unlinked old ones of the teacher on those dates), clears future marks, never the past', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-x', status: 'ON_LEAVE' });
        txMock.staffAttendance.delete.mockResolvedValue({});
        txMock.substitution.findMany.mockResolvedValue([{ id: 'gA1', date: new Date('2026-07-21'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: null }]);

        const result = await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        // Only 07-21 and 07-22 (today + future) — 07-20 is past.
        expect(txMock.substitution.findMany.mock.calls[0][0].where).toEqual({
          schoolId: SCHOOL,
          date: { in: [new Date('2026-07-21'), new Date('2026-07-22')] },
          OR: [{ leaveApplicationId: LEAVE_ID }, { leaveApplicationId: null, originalTeacherId: TEACHER }],
        });
        expect(txMock.substitution.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
        expect(txMock.substitution.deleteMany).toHaveBeenCalledTimes(1);
        expect(txMock.substitution.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['gA1'] }, schoolId: SCHOOL } });

        expect(txMock.staffAttendance.delete).toHaveBeenCalledTimes(2);
        expect(txMock.staffAttendance.delete).toHaveBeenCalledWith({ where: { id: 'mark-x' } });

        expect(txMock.leaveApplication.updateMany).toHaveBeenCalledWith({
          where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'APPROVED' },
          data: { status: 'CANCELLED' },
        });
        // The row is claimed BEFORE anything is unwound.
        expect(txMock.leaveApplication.updateMany.mock.invocationCallOrder[0])
          .toBeLessThan(txMock.substitution.findMany.mock.invocationCallOrder[0]);
        expect(result).toEqual({ status: 'CANCELLED', restoredDates: 2 });
      });

      it('no gaps left for this leave: nothing is deleted and no substitute is told', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue(null);
        txMock.substitution.findMany.mockResolvedValue([]);
        await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');
        expect(txMock.substitution.deleteMany).not.toHaveBeenCalled();
        expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.kind)).not.toContain('COVER_CANCELLED');
      });

      it('leave B overlapping these dates keeps its gaps and its substitutes; A\'s substitute is told and the desk hears', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue(null);
        // Only A's rows match the where above; B's rows carry leaveApplicationId = B.
        txMock.substitution.findMany.mockResolvedValue([
          { id: 'gA1', date: new Date('2026-07-21'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: OTHER_TEACHER },
          { id: 'gA2', date: new Date('2026-07-22'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: null },
        ]);
        txMock.teacher.findMany.mockResolvedValue([{ id: OTHER_TEACHER, userId: 'u-kavya' }]);
        txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Asha', lastName: 'Rao' });
        txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }, { id: 'u-head2', email: 'h2@x' }]);

        await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        // B's rows are never in the where (leaveApplicationId = A, or NULL for old rows).
        const where = txMock.substitution.findMany.mock.calls[0][0].where;
        expect(where.OR).toEqual([{ leaveApplicationId: LEAVE_ID }, { leaveApplicationId: null, originalTeacherId: TEACHER }]);
        expect(txMock.substitution.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['gA1', 'gA2'] }, schoolId: SCHOOL } });
        const rows = txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data);
        expect(rows).toContainEqual(expect.objectContaining({ kind: 'COVER_CANCELLED', targetUserId: 'u-kavya', payload: { schoolName: 'Raffles', substitutionId: 'gA1', when: 'Tue 21 Jul 2026, Period 3 (10:15–11:00)', className: '9-A', why: 'LEAVE_CANCELLED' } }));
        // Only the substitute who HAD a cover is told: gA2 was open.
        expect(rows.filter((r) => r.kind === 'COVER_CANCELLED')).toHaveLength(1);
        // The admin who cancelled is not told what they just did; the other desk member is.
        expect(rows.filter((r) => r.kind === 'LEAVE_CANCELLED').map((r) => r.targetUserId)).toEqual(['u-head2']);
        expect(rows.find((r) => r.kind === 'LEAVE_CANCELLED').payload).toMatchObject({ teacherName: 'Asha Rao', releasedCovers: 1 });
        for (const c of txMock.notificationOutbox.create.mock.calls) expect(c[0].select).toEqual({ id: true });
      });

      it('a date another approved leave of the same teacher still covers keeps its ON_LEAVE mark', async () => {
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-x', status: 'ON_LEAVE' });
        txMock.staffAttendance.delete.mockResolvedValue({});
        // Leave B: the afternoon of the 22nd.
        txMock.leaveApplication.findMany.mockResolvedValue([{ startDate: new Date('2026-07-22'), endDate: new Date('2026-07-22') }]);

        await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');

        expect(txMock.leaveApplication.findMany.mock.calls[0][0].where).toEqual({
          schoolId: SCHOOL, teacherId: TEACHER, status: 'APPROVED', id: { not: LEAVE_ID },
          startDate: { lte: new Date('2026-07-22') }, endDate: { gte: new Date('2026-07-21') },
        });
        // Only the 21st's mark goes; the 22nd's stays for leave B.
        expect(txMock.staffAttendance.findFirst).toHaveBeenCalledTimes(1);
        expect(txMock.staffAttendance.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, teacherId: TEACHER, date: new Date('2026-07-21') } });
        expect(txMock.staffAttendance.delete).toHaveBeenCalledTimes(1);
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
        txMock.substitution.findMany.mockResolvedValue([
          { id: 'g21', date: new Date('2026-07-21'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: null },
          { id: 'g22', date: new Date('2026-07-22'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: null },
        ]);
        txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark-x', status: 'ON_LEAVE' });
        txMock.staffAttendance.delete.mockResolvedValue({});

        const result = await svc.cancel(SCHOOL, LEAVE_ID, TEACHER_USER, 'SCHOOL_ADMIN');

        expect(txMock.leaveApplication.updateMany).toHaveBeenNthCalledWith(1, { where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        expect(txMock.leaveApplication.updateMany).toHaveBeenNthCalledWith(2, { where: { id: LEAVE_ID, schoolId: SCHOOL, status: 'APPROVED' }, data: { status: 'CANCELLED' } });
        expect(txMock.substitution.findMany.mock.calls[0][0].where.date).toEqual({ in: [new Date('2026-07-21'), new Date('2026-07-22')] }); // 07-20 is past
        expect(txMock.substitution.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['g21', 'g22'] }, schoolId: SCHOOL } });
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
    const gap = { id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, originalTeacherId: TEACHER, substituteTeacherId: null };
    beforeEach(() => {
      txMock.substitution.findFirst.mockResolvedValue(gap);
      txMock.substitution.update.mockResolvedValue({ id: SUB_ID, substituteTeacherId: OTHER_TEACHER });
    });

    it('sets a substitute freeTeachersFor offers, and clears any earlier "seen"', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]);
      const result = await svc.assign(SCHOOL, SUB_ID, dto);
      expect(freeTeachersFor).toHaveBeenCalledWith(txMock, SCHOOL, gap);
      // Compare-and-set on the substitute this desk SAW (none).
      expect(txMock.substitution.updateMany).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: null }, data: { substituteTeacherId: OTHER_TEACHER, acknowledgedAt: null } });
      expect(result).toMatchObject({ id: SUB_ID, substituteTeacherId: OTHER_TEACHER, acknowledgedAt: null });
    });

    it('the cover card names the class as "9-A" and reads the subject from the slot LIVE that date', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]);
      txMock.teacher.findFirst.mockResolvedValueOnce({ userId: 'u-kavya' }).mockResolvedValueOnce({ firstName: 'Asha', lastName: 'Rao' });
      txMock.period.findFirst.mockResolvedValue({ label: 'Period 3', startTime: '10:15', endTime: '11:00' });
      txMock.classSection.findFirst.mockResolvedValue({ name: 'A', grade: { name: '9' } });
      txMock.timetableSlot.findFirst.mockResolvedValue({ subject: { name: 'Mathematics' } });
      await svc.assign(SCHOOL, SUB_ID, dto);
      expect(txMock.timetableSlot.findFirst.mock.calls[0][0].where).toEqual({
        schoolId: SCHOOL, classSectionId: CLASS_SECTION, periodId: PERIOD, dayOfWeek: 1,
        effectiveFrom: { lte: new Date('2026-07-20T00:00:00+05:30') },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date('2026-07-20T00:00:00+05:30') } }],
      });
      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({
        data: { schoolId: SCHOOL, kind: 'COVER_ASSIGNED', targetUserId: 'u-kavya', payload: { schoolName: 'Raffles', substitutionId: SUB_ID, substituteTeacherId: OTHER_TEACHER, when: 'Mon 20 Jul 2026, Period 3 (10:15–11:00)', className: '9-A', subjectName: 'Mathematics', originalTeacherName: 'Asha Rao' } },
        select: { id: true },
      });
    });

    it('giving the period to someone else tells the one it was taken from', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ ...gap, substituteTeacherId: 't-ramesh' });
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]);
      txMock.teacher.findMany.mockResolvedValue([{ id: 't-ramesh', userId: 'u-ramesh' }]);
      await svc.assign(SCHOOL, SUB_ID, dto);
      expect(txMock.substitution.updateMany.mock.calls[0][0].where).toEqual({ id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: 't-ramesh' });
      expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data)).toContainEqual(expect.objectContaining({ kind: 'COVER_CANCELLED', targetUserId: 'u-ramesh', payload: expect.objectContaining({ why: 'CHANGED', className: '9-A' }) }));
    });

    it('the same teacher again is a no-op: no write, no second card', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ ...gap, substituteTeacherId: OTHER_TEACHER });
      const result = await svc.assign(SCHOOL, SUB_ID, dto);
      expect(result).toMatchObject({ substituteTeacherId: OTHER_TEACHER });
      expect(freeTeachersFor).not.toHaveBeenCalled();
      expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    describe('two desks assign the same gap at once', () => {
      beforeEach(() => (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]));

      it('the loser (its compare-and-set matches nothing) gets 409 naming who has it, and sends NO card', async () => {
        txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
        txMock.substitution.findFirst.mockResolvedValueOnce(gap).mockResolvedValueOnce({ ...gap, substituteTeacherId: 't-ramesh' });
        txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Ramesh', lastName: 'Kumar' });
        await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toMatchObject({
          response: { code: 'TEACHER_CONFLICT', field: 'substituteTeacherId', message: 'Someone changed this cover a moment ago — it is now with Ramesh Kumar. Nothing was changed; look again and pick.' },
          status: 409,
        });
        expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
        expect(txMock.notification.create).not.toHaveBeenCalled();
      });

      it('a loser that wanted the very teacher the winner chose is told it is done — still ONE card', async () => {
        txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
        txMock.substitution.findFirst.mockResolvedValueOnce(gap).mockResolvedValueOnce({ ...gap, substituteTeacherId: OTHER_TEACHER });
        expect(await svc.assign(SCHOOL, SUB_ID, dto)).toMatchObject({ substituteTeacherId: OTHER_TEACHER });
        expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
      });

      it('the gap cleared in between: the loser is told it was cleared', async () => {
        txMock.substitution.findFirst.mockResolvedValueOnce({ ...gap, substituteTeacherId: 't-ramesh' }).mockResolvedValueOnce({ ...gap, substituteTeacherId: null });
        txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
        await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toMatchObject({ response: { message: expect.stringContaining('it has just been cleared') } });
        expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
      });
    });

    it('refuses anyone freeTeachersFor would not offer — the console, WhatsApp and the API agree', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: 'someone-else', name: 'X', teachesSubject: false, coversThatDay: 0 }]);
      await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toMatchObject({ response: { code: 'TEACHER_CONFLICT', field: 'substituteTeacherId' }, status: 409 });
      expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it('nobody free: every pick is refused', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([]);
      await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toMatchObject({ response: { code: 'TEACHER_CONFLICT' } });
      expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
    });

    it('the teacher on leave cannot be put on their own gap (freeTeachersFor never offers them)', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: false, coversThatDay: 0 }]);
      await expect(svc.assign(SCHOOL, SUB_ID, { substituteTeacherId: TEACHER })).rejects.toMatchObject({ response: { code: 'TEACHER_CONFLICT' } });
    });

    it('a gap of another school is not found', async () => {
      txMock.substitution.findFirst.mockResolvedValue(null);
      await expect(svc.assign(SCHOOL, SUB_ID, dto)).rejects.toThrow('Substitution not found');
      expect(txMock.substitution.findFirst).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL } });
      expect(freeTeachersFor).not.toHaveBeenCalled();
    });
  });

  describe('candidates', () => {
    it('asks freeTeachersFor about the school\'s own gap', async () => {
      const gap = { id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, originalTeacherId: TEACHER };
      txMock.substitution.findFirst.mockResolvedValue(gap);
      const list = [{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }];
      (freeTeachersFor as jest.Mock).mockResolvedValue(list);
      expect(await svc.candidates(SCHOOL, SUB_ID)).toBe(list);
      expect(txMock.substitution.findFirst).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL } });
      expect(freeTeachersFor).toHaveBeenCalledWith(txMock, SCHOOL, gap);
    });

    it('a gap of another school is not found', async () => {
      txMock.substitution.findFirst.mockResolvedValue(null);
      await expect(svc.candidates(SCHOOL, SUB_ID)).rejects.toThrow('Substitution not found');
      expect(freeTeachersFor).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    const covered = { id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: OTHER_TEACHER };

    it('nulls the substitute and the "seen", and tells the teacher who was covering', async () => {
      txMock.substitution.findFirst.mockResolvedValue(covered);
      txMock.teacher.findMany.mockResolvedValue([{ id: OTHER_TEACHER, userId: 'u-kavya' }]);

      const result = await svc.clear(SCHOOL, SUB_ID);

      expect(txMock.substitution.updateMany).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: OTHER_TEACHER }, data: { substituteTeacherId: null, acknowledgedAt: null } });
      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: 'COVER_CANCELLED', targetUserId: 'u-kavya', payload: expect.objectContaining({ why: 'CHANGED' }) }), select: { id: true } });
      expect(txMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u-kavya', kind: 'COVER_ASSIGNED', title: 'Cover called off: 9-A' }) });
      expect(result.substituteTeacherId).toBeNull();
    });

    it('clearing an empty gap tells nobody and writes nothing', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ ...covered, substituteTeacherId: null });
      const result = await svc.clear(SCHOOL, SUB_ID);
      expect(result.substituteTeacherId).toBeNull();
      expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it('a substitute with no login is cleared but has no inbox to tell', async () => {
      txMock.substitution.findFirst.mockResolvedValue(covered);
      txMock.teacher.findMany.mockResolvedValue([{ id: OTHER_TEACHER, userId: null }]);
      await svc.clear(SCHOOL, SUB_ID);
      expect(txMock.substitution.updateMany).toHaveBeenCalled();
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it('a clear racing a reassignment never clears the NEW cover: 409, nobody told', async () => {
      txMock.substitution.findFirst.mockResolvedValueOnce(covered).mockResolvedValueOnce({ ...covered, substituteTeacherId: 't-ramesh' });
      txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
      txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Ramesh', lastName: 'Kumar' });
      await expect(svc.clear(SCHOOL, SUB_ID)).rejects.toMatchObject({ response: { code: 'TEACHER_CONFLICT' }, status: 409 });
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it('two clears at once: the second finds it already empty and is fine, telling nobody twice', async () => {
      txMock.substitution.findFirst.mockResolvedValueOnce(covered).mockResolvedValueOnce({ ...covered, substituteTeacherId: null });
      txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
      expect(await svc.clear(SCHOOL, SUB_ID)).toMatchObject({ substituteTeacherId: null });
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it('a gap of another school is not found', async () => {
      txMock.substitution.findFirst.mockResolvedValue(null);
      await expect(svc.clear(SCHOOL, SUB_ID)).rejects.toThrow('Substitution not found');
      expect(txMock.substitution.findFirst).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL } });
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

  describe('coverage', () => {
    const lookups = () => {
      txMock.classSection.findMany.mockResolvedValue([{ id: CLASS_SECTION, name: 'B', grade: { name: 'VII' } }]);
      txMock.period.findMany.mockResolvedValue([{ id: PERIOD, label: 'Period I', order: 1 }]);
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao' }, { id: OTHER_TEACHER, firstName: 'Kavya', lastName: 'Rao' }]);
    };

    it('says whether each substitute has seen their cover', async () => {
      const seen = new Date('2026-10-05T02:40:00Z');
      txMock.substitution.findMany.mockResolvedValue([{ id: SUB_ID, date: new Date('2026-10-05'), classSectionId: CLASS_SECTION, periodId: PERIOD, originalTeacherId: TEACHER, substituteTeacherId: OTHER_TEACHER, acknowledgedAt: seen }]);
      lookups();
      const [row] = await svc.coverage(SCHOOL, '2026-10-05', '2026-10-05');
      expect(row).toMatchObject({ substituteTeacherName: 'Kavya Rao', acknowledgedAt: seen });
    });

    it('a cover nobody has tapped Got it on, and a gap with nobody, both say null — never undefined', async () => {
      txMock.substitution.findMany.mockResolvedValue([
        { id: SUB_ID, date: new Date('2026-10-05'), classSectionId: CLASS_SECTION, periodId: PERIOD, originalTeacherId: TEACHER, substituteTeacherId: OTHER_TEACHER, acknowledgedAt: null },
        { id: 'gap-2', date: new Date('2026-10-05'), classSectionId: CLASS_SECTION, periodId: PERIOD, originalTeacherId: TEACHER, substituteTeacherId: null, acknowledgedAt: null },
      ]);
      lookups();
      const rows = await svc.coverage(SCHOOL, '2026-10-05', '2026-10-05');
      expect(rows.map((r) => r.acknowledgedAt)).toEqual([null, null]);
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
    txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });
    txMock.holiday.findMany.mockResolvedValue([]);
    // Mon: 3 live slots, Tue: 2 — what approve() would open.
    const slot = (startTime: string) => ({ classSectionId: CLASS_SECTION, periodId: PERIOD, period: { startTime } });
    txMock.timetableSlot.findMany.mockImplementation(async ({ where }: { where: { dayOfWeek: number } }) =>
      where.dayOfWeek === 1 ? [slot('8:00'), slot('10:15'), slot('13:30')] : where.dayOfWeek === 2 ? [slot('9:00'), slot('14:00')] : [],
    );
  });
  afterEach(() => txMock.timetableSlot.findMany.mockReset());

  it('"N periods to cover" counts what approve() would open: working days and live slots only, the away half only', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: 't1', firstName: 'Priya', lastName: 'Nair', isActive: true });
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.user.findMany.mockResolvedValue([{ id: 'a1', email: 'a1@x' }]);
    const created = (o: Record<string, unknown>) => ({ id: 'l1', schoolId: 'S', teacherId: 't1', type: 'CASUAL', reason: null, status: 'PENDING', createdAt: new Date(), ...o });
    // Sat 19 – Mon 21 Sep with Sunday off and Saturday a holiday: only Monday counts.
    txMock.holiday.findMany.mockResolvedValue([{ startDate: new Date('2026-09-19'), endDate: null, name: 'Founders day' }]);
    txMock.leaveApplication.create.mockResolvedValue(created({ startDate: new Date('2026-09-19'), endDate: new Date('2026-09-21') }));
    await svc.apply('S', 'u-teacher', { type: 'CASUAL', startDate: '2026-09-19', endDate: '2026-09-21' } as never);
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data.payload.periodsAffected).toBe(3);
    // Every slot asked is asked LIVE on that date, never "effectiveTo: null".
    for (const c of txMock.timetableSlot.findMany.mock.calls) expect(c[0].where).toHaveProperty('effectiveFrom');
    expect(txMock.timetableSlot.findMany.mock.calls.map((c) => c[0].where.dayOfWeek)).toEqual([1]);

    // A PM half day on Monday: only the 13:30 period ("8:00" and "10:15" are morning).
    jest.clearAllMocks();
    txMock.holiday.findMany.mockResolvedValue([]);
    txMock.user.findMany.mockResolvedValue([{ id: 'a1', email: 'a1@x' }]);
    txMock.leaveApplication.create.mockResolvedValue(created({ startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21'), halfDay: true, halfDayPart: 'PM' }));
    await svc.apply('S', 'u-teacher', { type: 'CASUAL', startDate: '2026-09-21', endDate: '2026-09-21', halfDay: true, halfDayPart: 'PM' } as never);
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data.payload.periodsAffected).toBe(1);
  });

  it('a staff member\'s request counts no periods and asks no timetable or calendar', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    txMock.staff.findFirst.mockResolvedValue({ id: 'st1', firstName: 'Ram', lastName: 'Singh', isActive: true });
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.user.findMany.mockResolvedValue([{ id: 'a1', email: 'a1@x' }]);
    txMock.leaveApplication.create.mockResolvedValue({ id: 'l1', schoolId: 'S', teacherId: null, staffId: 'st1', type: 'CASUAL', startDate: new Date('2026-09-21'), endDate: new Date('2026-09-21'), reason: null, status: 'PENDING', createdAt: new Date() });
    await svc.apply('S', 'u-driver', { type: 'CASUAL', startDate: '2026-09-21', endDate: '2026-09-21' } as never);
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data.payload.periodsAffected).toBe(0);
    expect(txMock.timetableSlot.findMany).not.toHaveBeenCalled();
    expect(txMock.school.findUnique).not.toHaveBeenCalled();
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

describe('the substitute answers', () => {
  const svc = new LeaveService();
  const SUBST_USER = 'u-kavya';
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.teacher.findFirst.mockResolvedValue({ id: OTHER_TEACHER, firstName: 'Kavya', lastName: 'Rao' });
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
    txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);
    txMock.staff.findMany.mockResolvedValue([]);
    txMock.substitution.updateMany.mockResolvedValue({ count: 1 });
    txMock.classSection.findMany.mockResolvedValue([{ id: CLASS_SECTION, name: 'A', grade: { name: '9' } }]);
    txMock.period.findMany.mockResolvedValue([{ id: PERIOD, label: 'Period 3', startTime: '10:15', endTime: '11:00' }]);
  });

  it('Got it stamps acknowledgedAt once; a second tap keeps the first time', async () => {
    txMock.substitution.findFirst.mockResolvedValueOnce({ acknowledgedAt: null });
    const r = await svc.acknowledge(SCHOOL, SUB_ID, SUBST_USER);
    expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, userId: SUBST_USER }, select: { id: true, firstName: true, lastName: true } });
    expect(txMock.substitution.findFirst).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: OTHER_TEACHER }, select: { acknowledgedAt: true } });
    expect(txMock.substitution.updateMany).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: OTHER_TEACHER, acknowledgedAt: null }, data: { acknowledgedAt: r.acknowledgedAt } });
    const first = new Date('2026-10-12T02:40:00Z');
    txMock.substitution.findFirst.mockResolvedValueOnce({ acknowledgedAt: first });
    txMock.substitution.updateMany.mockClear();
    expect(await svc.acknowledge(SCHOOL, SUB_ID, SUBST_USER)).toEqual({ acknowledgedAt: first });
    expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
    // Nobody is told anything about a Got it.
    expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('two Got it taps at once: the second keeps the first one\'s time', async () => {
    const first = new Date('2026-10-12T02:40:00Z');
    txMock.substitution.findFirst.mockResolvedValueOnce({ acknowledgedAt: null }).mockResolvedValueOnce({ acknowledgedAt: first });
    txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.acknowledge(SCHOOL, SUB_ID, SUBST_USER)).toEqual({ acknowledgedAt: first });
  });

  it('Got it on a cover that is no longer theirs is refused, and stamps nothing', async () => {
    txMock.substitution.findFirst.mockResolvedValue(null);
    await expect(svc.acknowledge(SCHOOL, SUB_ID, SUBST_USER)).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' }, status: 409 });
    expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
  });

  it("Can't reopens the gap and tells the desk which class, when, and who", async () => {
    txMock.substitution.findFirst.mockResolvedValue({ id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-10-12'), periodId: PERIOD, classSectionId: CLASS_SECTION });
    await svc.decline(SCHOOL, SUB_ID, SUBST_USER);
    expect(txMock.substitution.updateMany).toHaveBeenCalledWith({ where: { id: SUB_ID, schoolId: SCHOOL, substituteTeacherId: OTHER_TEACHER }, data: { substituteTeacherId: null, acknowledgedAt: null } });
    expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'COVER_UNFILLED', targetUserId: ADMIN_USER, payload: { schoolName: 'Raffles', gaps: 1, forDate: '2026-10-12', forWhen: 'Mon 12 Oct 2026', note: "Kavya Rao can't take 9-A, Mon 12 Oct 2026, Period 3 (10:15–11:00)." } }),
      select: { id: true },
    });
    expect(txMock.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: ADMIN_USER, kind: 'LEAVE_APPLIED', title: "Kavya Rao can't cover 9-A" }) });
  });

  it("Can't after the desk already gave the period to someone else changes nothing", async () => {
    txMock.substitution.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.decline(SCHOOL, SUB_ID, SUBST_USER)).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' }, status: 409 });
    expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    expect(txMock.notification.create).not.toHaveBeenCalled();
  });

  it('a login that is not a teacher here cannot answer for a cover', async () => {
    txMock.teacher.findFirst.mockResolvedValue(null);
    await expect(svc.acknowledge(SCHOOL, SUB_ID, 'u-stranger')).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' }, status: 403 });
    await expect(svc.decline(SCHOOL, SUB_ID, 'u-stranger')).rejects.toMatchObject({ response: { code: 'NOT_THE_SUBSTITUTE' } });
    expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
  });

  it('the cover card stores who it is for, so its Can\'t can be signed for that teacher', async () => {
    const gap = { id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, originalTeacherId: TEACHER, substituteTeacherId: null };
    txMock.substitution.findFirst.mockResolvedValue(gap);
    (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]);
    txMock.teacher.findFirst.mockResolvedValue({ userId: 'u-kavya', firstName: 'Asha', lastName: 'Rao' });
    await svc.assign(SCHOOL, SUB_ID, { substituteTeacherId: OTHER_TEACHER });
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data.payload.substituteTeacherId).toBe(OTHER_TEACHER);
  });
});

describe('LeaveService — the fix wave: races, and what each loser and each desk is told', () => {
  const svc = new LeaveService();
  /** Every $queryRaw as `sql` (placeholders as ?) + its bound values. */
  const raws = () => txMock.$queryRaw.mock.calls.map(([strings, ...values]: [string[], ...unknown[]]) => ({ sql: strings.join('?'), values }));
  const LOCK_SQL = 'SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))::text';
  const lockOrder = (key: string) => {
    const i = raws().findIndex((r) => r.sql === LOCK_SQL && r.values[1] === key);
    return i < 0 ? Infinity : txMock.$queryRaw.mock.invocationCallOrder[i];
  };

  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.$queryRaw.mockResolvedValue([{}]);
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles' });
    txMock.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });
    txMock.holiday.findMany.mockResolvedValue([]);
    txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }]);
    txMock.staff.findMany.mockResolvedValue([]);
    txMock.substitution.findMany.mockResolvedValue([]);
    txMock.substitution.updateMany.mockResolvedValue({ count: 1 });
    txMock.leaveApplication.updateMany.mockResolvedValue({ count: 1 });
    txMock.leaveApplication.findMany.mockResolvedValue([]);
    txMock.leaveTypeDef.findFirst.mockResolvedValue(null);
    txMock.classSection.findMany.mockResolvedValue([{ id: CLASS_SECTION, name: 'A', grade: { name: '9' } }, { id: 'cs-7b', name: 'B', grade: { name: '7' } }]);
    txMock.period.findMany.mockResolvedValue([{ id: PERIOD, label: 'Period 3', startTime: '10:15', endTime: '11:00' }]);
    txMock.teacher.findMany.mockResolvedValue([]);
    txMock.teacher.findFirst.mockResolvedValue(null);
    txMock.staffAttendance.findFirst.mockResolvedValue(null);
    txMock.timetableSlot.findFirst.mockResolvedValue(null);
    txMock.timetableSlot.findMany.mockResolvedValue([]);
  });

  describe('apply', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-06T03:00:00.000Z'));
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER, firstName: 'Asha', lastName: 'Rao', isActive: true });
      txMock.leaveApplication.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: LEAVE_ID, status: 'PENDING', reason: null, createdAt: new Date(), ...data }));
    });

    it('a date sent with an IST offset is saved as the day it was judged — "2026-10-13T00:00+05:30" is the 13th, not 18:30 UTC on the 12th', async () => {
      await svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-10-13T00:00+05:30', endDate: '2026-10-13T00:00+05:30' });
      const data = txMock.leaveApplication.create.mock.calls[0][0].data;
      expect(data.startDate).toEqual(new Date('2026-10-13'));
      expect(data.endDate).toEqual(new Date('2026-10-13'));
      // …the same day the overlap check looked at.
      expect(txMock.leaveApplication.findMany.mock.calls[0][0].where.startDate).toEqual({ lte: new Date('2026-10-13') });
    });

    it('a double-tapped Submit: the per-person lock is taken BEFORE the overlap read, so the second tap sees the first row', async () => {
      await svc.apply(SCHOOL, TEACHER_USER, { type: 'SICK', startDate: '2026-10-13', endDate: '2026-10-13' });
      expect(raws()).toContainEqual({ sql: LOCK_SQL, values: [SCHOOL, `leave:${TEACHER}`] });
      expect(lockOrder(`leave:${TEACHER}`)).toBeLessThan(txMock.leaveApplication.findMany.mock.invocationCallOrder[0]);
    });
  });

  describe('assign', () => {
    const gap = { id: SUB_ID, schoolId: SCHOOL, date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: CLASS_SECTION, originalTeacherId: TEACHER, substituteTeacherId: null, leaveApplicationId: null as string | null };
    beforeEach(() => {
      txMock.substitution.findFirst.mockResolvedValue(gap);
      (freeTeachersFor as jest.Mock).mockResolvedValue([{ id: OTHER_TEACHER, name: 'Kavya Rao', teachesSubject: true, coversThatDay: 0 }]);
    });

    it("holds the day's cover lock from the \"who is free\" read to the write", async () => {
      await svc.assign(SCHOOL, SUB_ID, { substituteTeacherId: OTHER_TEACHER });
      expect(raws()).toContainEqual({ sql: LOCK_SQL, values: [SCHOOL, 'cover:2026-07-20'] });
      expect(lockOrder('cover:2026-07-20')).toBeLessThan((freeTeachersFor as jest.Mock).mock.invocationCallOrder[0]);
    });

    it('the desk that lost the teacher to another gap is told which class has them — and nothing is written or sent', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([]);
      txMock.substitution.findMany.mockResolvedValue([{ id: 'g-other', date: new Date('2026-07-20'), periodId: PERIOD, classSectionId: 'cs-7b' }]);
      txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Kavya', lastName: 'Rao' });
      await expect(svc.assign(SCHOOL, SUB_ID, { substituteTeacherId: OTHER_TEACHER })).rejects.toMatchObject({
        response: { code: 'TEACHER_CONFLICT', field: 'substituteTeacherId', message: 'Kavya Rao is already covering 7-B in that period. Nothing was changed; pick someone else.' },
        status: 409,
      });
      expect(txMock.substitution.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, date: gap.date, periodId: PERIOD, substituteTeacherId: OTHER_TEACHER, NOT: { id: SUB_ID } });
      expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it('a teacher whose leave was approved a moment ago: "on leave that day"', async () => {
      (freeTeachersFor as jest.Mock).mockResolvedValue([]);
      txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Kavya', lastName: 'Rao' });
      txMock.staffAttendance.findFirst.mockResolvedValue({ id: 'mark' });
      await expect(svc.assign(SCHOOL, SUB_ID, { substituteTeacherId: OTHER_TEACHER })).rejects.toMatchObject({
        response: { message: 'Kavya Rao is on leave that day. Nothing was changed; pick someone else.' },
      });
    });

    it('a gap whose leave was withdrawn meanwhile is refused (COVER_GONE) before any lock, read of who is free, write or card', async () => {
      txMock.substitution.findFirst.mockResolvedValue({ ...gap, leaveApplicationId: LEAVE_ID });
      txMock.$queryRaw.mockResolvedValueOnce([]); // FOR SHARE … status = 'APPROVED' finds no row
      await expect(svc.assign(SCHOOL, SUB_ID, { substituteTeacherId: OTHER_TEACHER })).rejects.toMatchObject({ response: { code: 'COVER_GONE' }, status: 409 });
      const [first] = raws();
      expect(first.sql).toContain('FOR SHARE');
      expect(first.sql).toContain(`status = 'APPROVED'`);
      expect(first.values).toEqual([LEAVE_ID, SCHOOL]);
      expect(raws()).toHaveLength(1);
      expect(freeTeachersFor).not.toHaveBeenCalled();
      expect(txMock.substitution.updateMany).not.toHaveBeenCalled();
      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it("a gap of a leave still approved: its row is held FOR SHARE first, then the day's lock, then the write", async () => {
      txMock.substitution.findFirst.mockResolvedValue({ ...gap, leaveApplicationId: LEAVE_ID });
      await svc.assign(SCHOOL, SUB_ID, { substituteTeacherId: OTHER_TEACHER });
      expect(raws()[0].sql).toContain('FOR SHARE');
      expect(raws()[1]).toEqual({ sql: LOCK_SQL, values: [SCHOOL, 'cover:2026-07-20'] });
      expect(txMock.substitution.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('approve', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-06T03:00:00.000Z'));
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, staffId: null, status: 'PENDING', startDate: new Date('2026-10-12'), endDate: new Date('2026-10-14') });
    });

    it('locks each working day, in date order, BEFORE marking ON_LEAVE or reopening the teacher\'s covers', async () => {
      await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
      const locks = raws().filter((r) => r.sql === LOCK_SQL).map((r) => r.values[1]);
      expect(locks).toEqual(['cover:2026-10-12', 'cover:2026-10-13', 'cover:2026-10-14']);
      const lastLock = lockOrder('cover:2026-10-14');
      expect(lastLock).toBeLessThan(txMock.staffAttendance.findFirst.mock.invocationCallOrder[0]);
      expect(lastLock).toBeLessThan(txMock.substitution.findMany.mock.invocationCallOrder[0]);
    });

    it('a staff member\'s leave takes no day locks — they cover nothing', async () => {
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: null, staffId: 'staff-1', status: 'PENDING', startDate: new Date('2026-10-12'), endDate: new Date('2026-10-14') });
      txMock.staff.findFirst.mockResolvedValue({ userId: null });
      await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
      expect(raws().filter((r) => r.sql === LOCK_SQL)).toEqual([]);
    });

    it('reopening covers tells and counts ONLY the covers really reopened: one cleared meanwhile is left alone', async () => {
      txMock.substitution.findMany.mockResolvedValue([
        { id: 'c1', date: new Date('2026-10-12'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: TEACHER },
        { id: 'c2', date: new Date('2026-10-13'), periodId: PERIOD, classSectionId: 'cs-7b', substituteTeacherId: TEACHER },
      ]);
      // c2 was cleared by the desk between the read and the write.
      txMock.substitution.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, userId: TEACHER_USER, firstName: 'Asha', lastName: 'Rao' }]);
      await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
      expect(txMock.substitution.updateMany.mock.calls.map((c) => c[0].where)).toEqual([
        { id: 'c1', schoolId: SCHOOL, substituteTeacherId: TEACHER },
        { id: 'c2', schoolId: SCHOOL, substituteTeacherId: TEACHER },
      ]);
      const rows = txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data);
      expect(rows.filter((r) => r.kind === 'COVER_CANCELLED').map((r) => r.payload.substitutionId)).toEqual(['c1']);
      expect(rows.find((r) => r.kind === 'COVER_UNFILLED').payload).toMatchObject({ gaps: 1, forDate: '2026-10-12', forWhen: 'Mon 12 Oct 2026' });
      expect(txMock.notification.create.mock.calls.map((c) => c[0].data.title)).toContain('1 cover reopened');
    });

    it('none really reopened (all cleared meanwhile): nobody is told anything about covers', async () => {
      txMock.substitution.findMany.mockResolvedValue([{ id: 'c1', date: new Date('2026-10-12'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: TEACHER }]);
      txMock.substitution.updateMany.mockResolvedValueOnce({ count: 0 });
      await svc.approve(SCHOOL, LEAVE_ID, ADMIN_USER);
      expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.kind)).not.toEqual(expect.arrayContaining(['COVER_CANCELLED']));
      expect(txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data.kind)).not.toEqual(expect.arrayContaining(['COVER_UNFILLED']));
    });
  });

  describe('cancel — the desk letter counts only substitutes who were told', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
      txMock.leaveApplication.findFirst.mockResolvedValue({ id: LEAVE_ID, schoolId: SCHOOL, teacherId: TEACHER, staffId: null, status: 'APPROVED', startDate: new Date('2026-07-21'), endDate: new Date('2026-07-22') });
      txMock.substitution.deleteMany.mockResolvedValue({ count: 2 });
      txMock.user.findMany.mockResolvedValue([{ id: ADMIN_USER, email: 'head@x' }, { id: 'u-head2', email: 'h2@x' }]);
      txMock.teacher.findFirst.mockResolvedValue({ firstName: 'Asha', lastName: 'Rao' });
    });

    it('a substitute with no login is not counted as told — the desk is told to tell them', async () => {
      txMock.substitution.findMany.mockResolvedValue([
        { id: 'g1', date: new Date('2026-07-21'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: OTHER_TEACHER },
        { id: 'g2', date: new Date('2026-07-22'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: 't-ramesh' },
      ]);
      txMock.teacher.findMany.mockResolvedValue([
        { id: OTHER_TEACHER, userId: 'u-kavya', firstName: 'Kavya', lastName: 'Rao' },
        { id: 't-ramesh', userId: null, firstName: 'Ramesh', lastName: 'Kumar' },
      ]);
      await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');
      const rows = txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data);
      expect(rows.filter((r) => r.kind === 'COVER_CANCELLED').map((r) => r.targetUserId)).toEqual(['u-kavya']);
      expect(rows.find((r) => r.kind === 'LEAVE_CANCELLED').payload).toEqual({
        schoolName: 'Raffles', leaveId: LEAVE_ID, teacherName: 'Asha Rao', dates: 'Tue 21 – Wed 22 Jul 2026', releasedCovers: 1, unreached: 'Ramesh Kumar',
      });
      const bell = txMock.notification.create.mock.calls.map((c) => c[0].data).find((d) => d.title === 'Asha Rao withdrew their leave');
      expect(bell.body).toBe('Tue 21 – Wed 22 Jul 2026 · 1 cover released · Ramesh Kumar has no login, so tell them yourself');
    });

    it('everyone reached: no "unreached" at all', async () => {
      txMock.substitution.findMany.mockResolvedValue([{ id: 'g1', date: new Date('2026-07-21'), periodId: PERIOD, classSectionId: CLASS_SECTION, substituteTeacherId: OTHER_TEACHER }]);
      txMock.teacher.findMany.mockResolvedValue([{ id: OTHER_TEACHER, userId: 'u-kavya', firstName: 'Kavya', lastName: 'Rao' }]);
      await svc.cancel(SCHOOL, LEAVE_ID, ADMIN_USER, 'SCHOOL_ADMIN');
      const desk = txMock.notificationOutbox.create.mock.calls.map((c) => c[0].data).find((r) => r.kind === 'LEAVE_CANCELLED');
      expect(desk.payload).toMatchObject({ releasedCovers: 1, unreached: null });
    });
  });
});

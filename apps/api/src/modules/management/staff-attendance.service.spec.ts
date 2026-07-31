const txMock = {
  teacher: { findMany: jest.fn(), findFirst: jest.fn() },
  staff: { findMany: jest.fn(), findFirst: jest.fn() },
  staffAttendance: { findMany: jest.fn(), upsert: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { StaffAttendanceService } from './staff-attendance.service';
import { ApiError } from '../../common/errors/api-error';
import type { SaveStaffAttendanceDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER_1 = 't1111111-1111-1111-1111-111111111111';
const TEACHER_2 = 't2222222-2222-2222-2222-222222222222';
const STAFF_1 = 's1111111-1111-1111-1111-111111111111';
const STAFF_2 = 's2222222-2222-2222-2222-222222222222';

describe('StaffAttendanceService', () => {
  const svc = new StaffAttendanceService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
  });

  describe('list', () => {
    it('defaults unmarked people to PRESENT and returns the stored status for marked ones', async () => {
      txMock.teacher.findMany.mockResolvedValue([
        { id: TEACHER_1, firstName: 'Asha', lastName: 'Rao' },
        { id: TEACHER_2, firstName: 'Ben', lastName: 'Iyer' },
      ]);
      txMock.staff.findMany.mockResolvedValue([
        { id: STAFF_1, firstName: 'Cy', lastName: 'Menon', role: 'OFFICE' },
      ]);
      txMock.staffAttendance.findMany.mockResolvedValue([
        { teacherId: TEACHER_1, staffId: null, status: 'ABSENT' },
        { teacherId: null, staffId: STAFF_1, status: 'LATE' },
      ]);

      const result = await svc.list(SCHOOL, '2026-07-21');

      expect(result).toEqual({
        people: [
          { id: TEACHER_1, name: 'Asha Rao', kind: 'TEACHER', status: 'ABSENT' },
          { id: TEACHER_2, name: 'Ben Iyer', kind: 'TEACHER', status: 'PRESENT' },
          { id: STAFF_1, name: 'Cy Menon', kind: 'STAFF', role: 'OFFICE', status: 'LATE' },
        ],
      });
    });

    it('scopes the day lookup to schoolId and the requested date', async () => {
      txMock.teacher.findMany.mockResolvedValue([]);
      txMock.staff.findMany.mockResolvedValue([]);
      txMock.staffAttendance.findMany.mockResolvedValue([]);

      await svc.list(SCHOOL, '2026-07-21');

      expect(txMock.staffAttendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { schoolId: SCHOOL, date: new Date('2026-07-21') },
        }),
      );
      expect(txMock.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { schoolId: SCHOOL } }),
      );
      expect(txMock.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { schoolId: SCHOOL } }),
      );
    });

    it('rejects a malformed date before ever opening a tenant transaction', async () => {
      await expect(svc.list(SCHOOL, 'not-a-date')).rejects.toThrow(ApiError);
      expect(withTenantMock).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('upserts a TEACHER mark against the teacher unique key', async () => {
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER_1 }]);
      txMock.staff.findMany.mockResolvedValue([]);
      txMock.staffAttendance.upsert.mockResolvedValue({});

      const dto: SaveStaffAttendanceDto = {
        date: '2026-07-21',
        marks: [{ personId: TEACHER_1, kind: 'TEACHER', status: 'ABSENT' }],
      };

      const result = await svc.save(SCHOOL, 'admin-user-1', dto);

      expect(result).toEqual({ saved: 1, absentees: 1 });
      expect(txMock.staffAttendance.upsert).toHaveBeenCalledWith({
        where: { one_teacher_mark_per_day: { teacherId: TEACHER_1, date: new Date('2026-07-21') } },
        create: {
          schoolId: SCHOOL,
          teacherId: TEACHER_1,
          date: new Date('2026-07-21'),
          status: 'ABSENT',
          markedById: 'admin-user-1',
        },
        update: { status: 'ABSENT', markedById: 'admin-user-1' },
      });
    });

    it('upserts a STAFF mark against the staff unique key', async () => {
      txMock.teacher.findMany.mockResolvedValue([]);
      txMock.staff.findMany.mockResolvedValue([{ id: STAFF_1 }]);
      txMock.staffAttendance.upsert.mockResolvedValue({});

      const dto: SaveStaffAttendanceDto = {
        date: '2026-07-21',
        marks: [{ personId: STAFF_1, kind: 'STAFF', status: 'ON_LEAVE' }],
      };

      const result = await svc.save(SCHOOL, 'admin-user-1', dto);

      expect(result).toEqual({ saved: 1, absentees: 0 });
      expect(txMock.staffAttendance.upsert).toHaveBeenCalledWith({
        where: { one_staff_mark_per_day: { staffId: STAFF_1, date: new Date('2026-07-21') } },
        create: {
          schoolId: SCHOOL,
          staffId: STAFF_1,
          date: new Date('2026-07-21'),
          status: 'ON_LEAVE',
          markedById: 'admin-user-1',
        },
        update: { status: 'ON_LEAVE', markedById: 'admin-user-1' },
      });
    });

    it('handles a mixed batch of teachers and staff, counting absentees across both kinds', async () => {
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER_1 }, { id: TEACHER_2 }]);
      txMock.staff.findMany.mockResolvedValue([{ id: STAFF_1 }, { id: STAFF_2 }]);
      txMock.staffAttendance.upsert.mockResolvedValue({});

      const dto: SaveStaffAttendanceDto = {
        date: '2026-07-21',
        marks: [
          { personId: TEACHER_1, kind: 'TEACHER', status: 'ABSENT' },
          { personId: TEACHER_2, kind: 'TEACHER', status: 'PRESENT' },
          { personId: STAFF_1, kind: 'STAFF', status: 'ABSENT' },
          { personId: STAFF_2, kind: 'STAFF', status: 'LATE' },
        ],
      };

      const result = await svc.save(SCHOOL, 'admin-user-1', dto);

      expect(result).toEqual({ saved: 4, absentees: 2 });
      expect(txMock.staffAttendance.upsert).toHaveBeenCalledTimes(4);
    });

    it('throws VALIDATION and writes nothing when a personId is not on this school\'s teacher roster', async () => {
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER_1 }]);
      txMock.staff.findMany.mockResolvedValue([]);

      const dto: SaveStaffAttendanceDto = {
        date: '2026-07-21',
        marks: [{ personId: 'foreign-teacher', kind: 'TEACHER', status: 'PRESENT' }],
      };

      await expect(svc.save(SCHOOL, 'admin-user-1', dto)).rejects.toMatchObject({
        response: { code: 'VALIDATION' },
      });
      expect(txMock.staffAttendance.upsert).not.toHaveBeenCalled();
    });

    it('throws VALIDATION when a personId is on the roster for the WRONG kind (staff id marked as a teacher)', async () => {
      txMock.teacher.findMany.mockResolvedValue([]);
      txMock.staff.findMany.mockResolvedValue([{ id: STAFF_1 }]);

      const dto: SaveStaffAttendanceDto = {
        date: '2026-07-21',
        marks: [{ personId: STAFF_1, kind: 'TEACHER', status: 'PRESENT' }],
      };

      await expect(svc.save(SCHOOL, 'admin-user-1', dto)).rejects.toMatchObject({
        response: { code: 'VALIDATION' },
      });
      expect(txMock.staffAttendance.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent: re-saving the same person/day targets the identical unique key', async () => {
      txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER_1 }]);
      txMock.staff.findMany.mockResolvedValue([]);
      txMock.staffAttendance.upsert.mockResolvedValue({});

      const dto: SaveStaffAttendanceDto = {
        date: '2026-07-21',
        marks: [{ personId: TEACHER_1, kind: 'TEACHER', status: 'ABSENT' }],
      };

      await svc.save(SCHOOL, 'admin-user-1', dto);
      await svc.save(SCHOOL, 'admin-user-1', {
        ...dto,
        marks: [{ personId: TEACHER_1, kind: 'TEACHER', status: 'PRESENT' }],
      });

      expect(txMock.staffAttendance.upsert).toHaveBeenCalledTimes(2);
      expect(txMock.staffAttendance.upsert.mock.calls[0][0].where).toEqual(
        txMock.staffAttendance.upsert.mock.calls[1][0].where,
      );
      expect(txMock.staffAttendance.upsert.mock.calls[1][0].update.status).toBe('PRESENT');
    });

    it('rejects a malformed date before ever opening a tenant transaction', async () => {
      const dto: SaveStaffAttendanceDto = {
        date: 'not-a-date',
        marks: [{ personId: TEACHER_1, kind: 'TEACHER', status: 'PRESENT' }],
      };

      await expect(svc.save(SCHOOL, 'admin-user-1', dto)).rejects.toThrow(ApiError);
      expect(withTenantMock).not.toHaveBeenCalled();
    });
  });

  describe('person', () => {
    it('computes present/absent/late/onLeave counts and percent for a teacher\'s month', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_1 });
      txMock.staffAttendance.findMany.mockResolvedValue([
        { date: new Date('2026-07-01'), status: 'PRESENT' },
        { date: new Date('2026-07-02'), status: 'PRESENT' },
        { date: new Date('2026-07-03'), status: 'ABSENT' },
        { date: new Date('2026-07-04'), status: 'LATE' },
        { date: new Date('2026-07-05'), status: 'ON_LEAVE' },
      ]);

      const result = await svc.person(SCHOOL, 'TEACHER', TEACHER_1, '2026-07');

      // percent = present / (present + absent + late) — onLeave (1) is
      // excluded from the denominator, so 2 / (2 + 1 + 1) = 50, not
      // 2 / 5 = 40 — leave shouldn't count against attendance.
      expect(result).toEqual({
        present: 2,
        absent: 1,
        late: 1,
        onLeave: 1,
        percent: 50,
        days: [
          { date: '2026-07-01', status: 'PRESENT' },
          { date: '2026-07-02', status: 'PRESENT' },
          { date: '2026-07-03', status: 'ABSENT' },
          { date: '2026-07-04', status: 'LATE' },
          { date: '2026-07-05', status: 'ON_LEAVE' },
        ],
      });
    });

    it('returns 0 percent (not NaN) when every recorded day is ON_LEAVE', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_1 });
      txMock.staffAttendance.findMany.mockResolvedValue([
        { date: new Date('2026-07-01'), status: 'ON_LEAVE' },
        { date: new Date('2026-07-02'), status: 'ON_LEAVE' },
      ]);

      const result = await svc.person(SCHOOL, 'TEACHER', TEACHER_1, '2026-07');

      expect(result.onLeave).toBe(2);
      expect(result.percent).toBe(0);
    });

    it('scopes the query to the half-open UTC month range, schoolId, and the given staffId', async () => {
      txMock.staff.findFirst.mockResolvedValue({ id: STAFF_1 });
      txMock.staffAttendance.findMany.mockResolvedValue([]);

      await svc.person(SCHOOL, 'STAFF', STAFF_1, '2026-07');

      expect(txMock.staffAttendance.findMany).toHaveBeenCalledWith({
        where: {
          schoolId: SCHOOL,
          date: { gte: new Date(Date.UTC(2026, 6, 1)), lt: new Date(Date.UTC(2026, 7, 1)) },
          staffId: STAFF_1,
        },
        orderBy: { date: 'asc' },
        select: { date: true, status: true },
      });
    });

    it('returns 0 percent (not NaN) when nothing is recorded for the month', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_1 });
      txMock.staffAttendance.findMany.mockResolvedValue([]);

      const result = await svc.person(SCHOOL, 'TEACHER', TEACHER_1, '2026-07');

      expect(result.percent).toBe(0);
      expect(result.days).toEqual([]);
    });

    it('throws NOT_FOUND when the id does not belong to this school (closes the no-RLS Staff hole)', async () => {
      txMock.staff.findFirst.mockResolvedValue(null);

      await expect(svc.person(SCHOOL, 'STAFF', 'foreign-staff', '2026-07')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(txMock.staffAttendance.findMany).not.toHaveBeenCalled();
    });

    it('rejects a malformed month before opening a tenant transaction', async () => {
      await expect(svc.person(SCHOOL, 'TEACHER', TEACHER_1, '2026/07')).rejects.toThrow(ApiError);
      expect(withTenantMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid kind', async () => {
      await expect(svc.person(SCHOOL, 'PARENT', TEACHER_1, '2026-07')).rejects.toMatchObject({
        response: { code: 'VALIDATION' },
      });
      expect(withTenantMock).not.toHaveBeenCalled();
    });
  });

  describe('mine', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("resolves the caller's own Staff row from userId and returns identity + monthly summary", async () => {
      txMock.staff.findFirst.mockResolvedValue({
        id: STAFF_1,
        firstName: 'Cy',
        lastName: 'Menon',
        role: 'OFFICE',
      });
      txMock.staffAttendance.findMany.mockResolvedValue([
        { date: new Date('2026-07-01'), status: 'PRESENT' },
        { date: new Date('2026-07-02'), status: 'ABSENT' },
      ]);

      const result = await svc.mine(SCHOOL, 'user-1', '2026-07');

      expect(txMock.staff.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', schoolId: SCHOOL },
        select: { id: true, firstName: true, lastName: true, role: true },
      });
      expect(result).toEqual({
        person: { id: STAFF_1, firstName: 'Cy', lastName: 'Menon', role: 'OFFICE' },
        summary: {
          present: 1,
          absent: 1,
          late: 0,
          onLeave: 0,
          percent: 50,
          days: [
            { date: '2026-07-01', status: 'PRESENT' },
            { date: '2026-07-02', status: 'ABSENT' },
          ],
        },
      });
    });

    it('scopes the attendance query to the half-open UTC month range, schoolId, and the resolved staffId', async () => {
      txMock.staff.findFirst.mockResolvedValue({ id: STAFF_1, firstName: 'Cy', lastName: 'Menon', role: 'OFFICE' });
      txMock.staffAttendance.findMany.mockResolvedValue([]);

      await svc.mine(SCHOOL, 'user-1', '2026-07');

      expect(txMock.staffAttendance.findMany).toHaveBeenCalledWith({
        where: {
          schoolId: SCHOOL,
          staffId: STAFF_1,
          date: { gte: new Date(Date.UTC(2026, 6, 1)), lt: new Date(Date.UTC(2026, 7, 1)) },
        },
        orderBy: { date: 'asc' },
        select: { date: true, status: true },
      });
    });

    it('defaults to the current IST month when no month is supplied', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
      txMock.staff.findFirst.mockResolvedValue({ id: STAFF_1, firstName: 'Cy', lastName: 'Menon', role: 'OFFICE' });
      txMock.staffAttendance.findMany.mockResolvedValue([]);

      await svc.mine(SCHOOL, 'user-1');

      expect(txMock.staffAttendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: { gte: new Date(Date.UTC(2026, 6, 1)), lt: new Date(Date.UTC(2026, 7, 1)) },
          }),
        }),
      );
    });

    it('throws NOT_STAFF (403) when the caller has no linked Staff row, without querying attendance', async () => {
      txMock.staff.findFirst.mockResolvedValue(null);

      await expect(svc.mine(SCHOOL, 'user-with-no-staff-row', '2026-07')).rejects.toMatchObject({
        response: { code: 'NOT_STAFF' },
        status: 403,
      });
      expect(txMock.staffAttendance.findMany).not.toHaveBeenCalled();
    });

    it('rejects a malformed month before opening a tenant transaction', async () => {
      await expect(svc.mine(SCHOOL, 'user-1', '2026/07')).rejects.toThrow(ApiError);
      expect(withTenantMock).not.toHaveBeenCalled();
    });
  });
});

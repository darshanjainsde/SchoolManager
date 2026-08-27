const txMock = {
  classSection: { findFirst: jest.fn(), findMany: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn() },
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  substitution: { findFirst: jest.fn(), findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { AttendanceService } from './attendance.service';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER_USER = 'user-teacher-1';
const TEACHER_ID = 'teacher-1';

describe('AttendanceService', () => {
  const notifications = { notify: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const svc = new AttendanceService(
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    audit.record.mockResolvedValue(undefined);
    // No substitution coverage by default — most of this file's tests are
    // about ownership/roster/marker resolution, not the substitute path.
    txMock.substitution.findMany.mockResolvedValue([]);
  });

  describe('myClassSections', () => {
    it('a class PICKER is not day-scoped — you can post to a class you next see on Thursday', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
      txMock.classSection.findMany.mockResolvedValue([]);

      // No `scheduledOnly`: this is the shape announcements, assignments,
      // diary and results ask for. Day-scoping it would stop a teacher
      // posting an announcement on a Sunday.
      await svc.myClassSections(SCHOOL, TEACHER_USER, 'TEACHER', { date: '2026-08-02' });

      const where = txMock.classSection.findMany.mock.calls[0][0].where;
      expect(where.OR[0]).toEqual({ classTeacherId: TEACHER_ID });
      expect(where.OR[1].timetableSlots.some).toEqual({ teacherId: TEACHER_ID });
    });

    it('asks for the DAY the date falls on — a Sunday register is not everything you teach', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
      txMock.classSection.findMany.mockResolvedValue([]);

      // 2026-08-02 is a Sunday. With no slots that weekday the query returns
      // nothing, which is the point: the page showed every class a teacher had
      // ever taught, on every date, including days the school does not run.
      const result = await svc.myClassSections(SCHOOL, TEACHER_USER, 'TEACHER', {
        date: '2026-08-02',
        scheduledOnly: true,
      });

      const where = txMock.classSection.findMany.mock.calls[0][0].where;
      expect(where.OR[1].timetableSlots.some.dayOfWeek).toBe(7);
      expect(result).toEqual([]);
    });

    it('returns sections where the user is class teacher or has timetable slots (deduped)', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 28 },
        },
        {
          id: 'section-6a',
          name: 'A',
          grade: { name: '6' },
          _count: { students: 30 },
        },
      ]);

      // A MONDAY, asked as the REGISTER asks it.
      const result = await svc.myClassSections(SCHOOL, TEACHER_USER, 'TEACHER', {
        date: '2026-08-03',
        scheduledOnly: true,
      });

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, userId: TEACHER_USER } });
      // Both arms are scoped to the DAY: a register belongs to a period on a
      // timetable, so a class only exists on a date the teacher holds it.
      // `dayOfWeek: 1` is Monday, in TimetableSlot's 1-7 Monday-first encoding.
      const where = txMock.classSection.findMany.mock.calls[0][0].where;
      expect(where.OR[0]).toMatchObject({
        classTeacherId: TEACHER_ID,
        timetableSlots: { some: { dayOfWeek: 1 } },
      });
      expect(where.OR[1]).toMatchObject({
        timetableSlots: { some: { teacherId: TEACHER_ID, dayOfWeek: 1 } },
      });
      expect(result).toEqual([
        { classSectionId: 'section-5b', name: '5-B', studentCount: 28, covering: false },
        { classSectionId: 'section-6a', name: '6-A', studentCount: 30, covering: false },
      ]);
    });

    it('returns an empty list when the caller has no linked Teacher row', async () => {
      txMock.teacher.findFirst.mockResolvedValue(null);

      const result = await svc.myClassSections(SCHOOL, TEACHER_USER, 'TEACHER');

      expect(result).toEqual([]);
      expect(txMock.classSection.findMany).not.toHaveBeenCalled();
    });

    it('returns all sections for SCHOOL_ADMIN without a Teacher lookup', async () => {
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 28 },
        },
      ]);

      const result = await svc.myClassSections(SCHOOL, 'admin-user-1', 'SCHOOL_ADMIN');

      expect(txMock.teacher.findFirst).not.toHaveBeenCalled();
      expect(result).toEqual([
        { classSectionId: 'section-5b', name: '5-B', studentCount: 28, covering: false },
      ]);
    });
  });

  describe('dayStatus', () => {
    it('marks taken=true with counts and marker name when rows exist', async () => {
      txMock.teacher.findFirst.mockResolvedValueOnce({ id: TEACHER_ID }); // caller lookup in myClassSections
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 28 },
        },
      ]);
      const rows = [
        ...Array.from({ length: 26 }, () => ({
          classSectionId: 'section-5b',
          status: 'PRESENT',
          markedById: TEACHER_ID,
          createdAt: new Date('2026-07-21T04:00:00.000Z'),
        })),
        ...Array.from({ length: 2 }, () => ({
          classSectionId: 'section-5b',
          status: 'ABSENT',
          markedById: TEACHER_ID,
          createdAt: new Date('2026-07-21T04:00:00.000Z'),
        })),
      ];
      txMock.attendance.findMany.mockResolvedValue(rows);
      txMock.teacher.findMany.mockResolvedValue([
        { id: TEACHER_ID, firstName: 'Priya', lastName: 'Rao' },
      ]);

      const result = await svc.dayStatus(SCHOOL, TEACHER_USER, 'TEACHER', '2026-07-21');

      expect(result).toEqual([
        {
          classSectionId: 'section-5b',
          name: '5-B',
          total: 28,
          present: 26,
          taken: true,
          markedBy: 'Priya Rao',
          markedAt: '2026-07-21T04:00:00.000Z',
        },
      ]);
      // One batched read + one batched marker lookup, not a per-section loop.
      expect(txMock.attendance.findMany).toHaveBeenCalledTimes(1);
      expect(txMock.teacher.findMany).toHaveBeenCalledTimes(1);
    });

    it('marks taken=false with the live roster count and null marker when no rows exist', async () => {
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 28 },
        },
      ]);
      txMock.attendance.findMany.mockResolvedValue([]);

      const result = await svc.dayStatus(SCHOOL, TEACHER_USER, 'TEACHER', '2026-07-21');

      expect(result).toEqual([
        {
          classSectionId: 'section-5b',
          name: '5-B',
          total: 28,
          present: 0,
          taken: false,
          markedBy: null,
          markedAt: null,
        },
      ]);
      // No rows means no marker to resolve.
      expect(txMock.teacher.findMany).not.toHaveBeenCalled();
    });

    it('computes total from the attendance rows actually marked that day, not the current live roster count', async () => {
      // The roster has grown to 30 since this date was taken (e.g. new
      // admissions) — the day's `total` must still reflect the 28 students
      // who were actually marked, not today's roster size.
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 30 },
        },
      ]);
      const rows = [
        ...Array.from({ length: 26 }, () => ({
          classSectionId: 'section-5b',
          status: 'PRESENT',
          markedById: TEACHER_ID,
          createdAt: new Date('2026-07-21T04:00:00.000Z'),
        })),
        ...Array.from({ length: 2 }, () => ({
          classSectionId: 'section-5b',
          status: 'ABSENT',
          markedById: TEACHER_ID,
          createdAt: new Date('2026-07-21T04:00:00.000Z'),
        })),
      ];
      txMock.attendance.findMany.mockResolvedValue(rows);
      txMock.teacher.findMany.mockResolvedValue([
        { id: TEACHER_ID, firstName: 'Priya', lastName: 'Rao' },
      ]);

      const result = await svc.dayStatus(SCHOOL, 'admin-user-1', 'SCHOOL_ADMIN', '2026-07-21');

      expect(result[0]).toMatchObject({ taken: true, total: 28, present: 26 });
    });

    it('falls back to the live roster count when the day is not taken, even if the roster later grows', async () => {
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 30 },
        },
      ]);
      txMock.attendance.findMany.mockResolvedValue([]);

      const result = await svc.dayStatus(SCHOOL, 'admin-user-1', 'SCHOOL_ADMIN', '2026-07-21');

      expect(result[0]).toMatchObject({ taken: false, total: 30 });
    });

    it('falls back to "School admin" when markedById does not resolve to a Teacher row', async () => {
      txMock.teacher.findFirst.mockResolvedValueOnce({ id: TEACHER_ID }); // caller lookup
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 2 },
        },
      ]);
      txMock.attendance.findMany.mockResolvedValue([
        {
          classSectionId: 'section-5b',
          status: 'PRESENT',
          markedById: 'admin-user-1',
          createdAt: new Date('2026-07-21T04:00:00.000Z'),
        },
      ]);
      txMock.teacher.findMany.mockResolvedValue([]); // 'admin-user-1' has no Teacher row

      const result = await svc.dayStatus(SCHOOL, TEACHER_USER, 'TEACHER', '2026-07-21');

      expect(result[0]).toMatchObject({ taken: true, markedBy: 'School admin' });
    });

    it('resolves every section from ONE batched attendance read and ONE batched teacher lookup, regardless of section count (no per-section N+1)', async () => {
      // SCHOOL_ADMIN can see every section in the school — this is the path
      // where a per-section loop would have hurt most.
      txMock.classSection.findMany.mockResolvedValue([
        { id: 's1', name: 'A', grade: { name: '5' }, _count: { students: 25 } },
        { id: 's2', name: 'B', grade: { name: '5' }, _count: { students: 28 } },
        { id: 's3', name: 'A', grade: { name: '6' }, _count: { students: 20 } }, // untaken
        { id: 's4', name: 'B', grade: { name: '6' }, _count: { students: 22 } },
      ]);
      const at = (t: string) => new Date(t);
      const rows = [
        ...Array.from({ length: 25 }, () => ({
          classSectionId: 's1',
          status: 'PRESENT',
          markedById: 'teacher-A',
          createdAt: at('2026-07-21T04:00:00.000Z'),
        })),
        ...Array.from({ length: 28 }, () => ({
          classSectionId: 's2',
          status: 'PRESENT',
          markedById: 'teacher-B',
          createdAt: at('2026-07-21T04:05:00.000Z'),
        })),
        ...Array.from({ length: 22 }, () => ({
          classSectionId: 's4',
          status: 'PRESENT',
          markedById: 'teacher-B',
          createdAt: at('2026-07-21T04:10:00.000Z'),
        })),
      ];
      txMock.attendance.findMany.mockResolvedValue(rows);
      txMock.teacher.findMany.mockResolvedValue([
        { id: 'teacher-A', firstName: 'Asha', lastName: 'Verma' },
        { id: 'teacher-B', firstName: 'Kiran', lastName: 'Shah' },
      ]);

      const result = await svc.dayStatus(SCHOOL, 'admin-user-1', 'SCHOOL_ADMIN', '2026-07-21');

      expect(txMock.teacher.findFirst).not.toHaveBeenCalled();
      expect(txMock.attendance.findMany).toHaveBeenCalledTimes(1);
      expect(txMock.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            classSectionId: { in: ['s1', 's2', 's3', 's4'] },
          }),
        }),
      );
      expect(txMock.teacher.findMany).toHaveBeenCalledTimes(1);
      expect(txMock.teacher.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: expect.arrayContaining(['teacher-A', 'teacher-B']) } },
        }),
      );

      expect(result).toEqual([
        {
          classSectionId: 's1',
          name: '5-A',
          total: 25,
          present: 25,
          taken: true,
          markedBy: 'Asha Verma',
          markedAt: '2026-07-21T04:00:00.000Z',
        },
        {
          classSectionId: 's2',
          name: '5-B',
          total: 28,
          present: 28,
          taken: true,
          markedBy: 'Kiran Shah',
          markedAt: '2026-07-21T04:05:00.000Z',
        },
        {
          classSectionId: 's3',
          name: '6-A',
          total: 20,
          present: 0,
          taken: false,
          markedBy: null,
          markedAt: null,
        },
        {
          classSectionId: 's4',
          name: '6-B',
          total: 22,
          present: 22,
          taken: true,
          markedBy: 'Kiran Shah',
          markedAt: '2026-07-21T04:10:00.000Z',
        },
      ]);
    });

    it('rejects a malformed date before opening a tenant transaction', async () => {
      await expect(
        svc.dayStatus(SCHOOL, TEACHER_USER, 'TEACHER', 'not-a-date'),
      ).rejects.toThrow();
      expect(txMock.classSection.findMany).not.toHaveBeenCalled();
    });
  });
});

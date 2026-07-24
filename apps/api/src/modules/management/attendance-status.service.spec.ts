const txMock = {
  classSection: { findFirst: jest.fn(), findMany: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn() },
  teacher: { findFirst: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { AttendanceService } from './attendance.service';
import type { NotificationService } from '../../common/notifications/notification.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER_USER = 'user-teacher-1';
const TEACHER_ID = 'teacher-1';

describe('AttendanceService', () => {
  const notifications = { notify: jest.fn() };
  const svc = new AttendanceService(notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
  });

  describe('myClassSections', () => {
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

      const result = await svc.myClassSections(SCHOOL, TEACHER_USER, 'TEACHER');

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { userId: TEACHER_USER } });
      expect(txMock.classSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { classTeacherId: TEACHER_ID },
              { timetableSlots: { some: { teacherId: TEACHER_ID } } },
            ],
          },
        }),
      );
      expect(result).toEqual([
        { classSectionId: 'section-5b', name: '5-B', studentCount: 28 },
        { classSectionId: 'section-6a', name: '6-A', studentCount: 30 },
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
      expect(result).toEqual([{ classSectionId: 'section-5b', name: '5-B', studentCount: 28 }]);
    });
  });

  describe('dayStatus', () => {
    it('marks taken=true with counts and marker name when rows exist', async () => {
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 28 },
        },
      ]);
      txMock.teacher.findFirst
        .mockResolvedValueOnce({ id: TEACHER_ID }) // caller's own Teacher row
        .mockResolvedValueOnce({ firstName: 'Priya', lastName: 'Rao' }); // marker lookup
      const rows = [
        ...Array.from({ length: 26 }, (_, i) => ({
          status: 'PRESENT',
          markedById: TEACHER_ID,
          createdAt: new Date('2026-07-21T04:00:00.000Z'),
        })),
        ...Array.from({ length: 2 }, () => ({
          status: 'ABSENT',
          markedById: TEACHER_ID,
          createdAt: new Date('2026-07-21T04:00:00.000Z'),
        })),
      ];
      txMock.attendance.findMany.mockResolvedValue(rows);

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
    });

    it('marks taken=false with student total and null marker when no rows exist', async () => {
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 28 },
        },
      ]);
      txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER_ID });
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
    });

    it('falls back to "School admin" when markedById does not resolve to a Teacher row', async () => {
      txMock.classSection.findMany.mockResolvedValue([
        {
          id: 'section-5b',
          name: 'B',
          grade: { name: '5' },
          _count: { students: 2 },
        },
      ]);
      txMock.teacher.findFirst
        .mockResolvedValueOnce({ id: TEACHER_ID }) // caller's own Teacher row
        .mockResolvedValueOnce(null); // marker lookup — no Teacher row (SCHOOL_ADMIN saved it)
      txMock.attendance.findMany.mockResolvedValue([
        { status: 'PRESENT', markedById: 'admin-user-1', createdAt: new Date('2026-07-21T04:00:00.000Z') },
      ]);

      const result = await svc.dayStatus(SCHOOL, TEACHER_USER, 'TEACHER', '2026-07-21');

      expect(result[0]).toMatchObject({ taken: true, markedBy: 'School admin' });
    });

    it('rejects a malformed date before opening a tenant transaction', async () => {
      await expect(
        svc.dayStatus(SCHOOL, TEACHER_USER, 'TEACHER', 'not-a-date'),
      ).rejects.toThrow();
      expect(txMock.classSection.findMany).not.toHaveBeenCalled();
    });
  });
});

const txMock = {
  classSection: { findFirst: jest.fn() },
  student: { findMany: jest.fn() },
  attendance: { findMany: jest.fn(), upsert: jest.fn() },
  teacher: { findFirst: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  withTenant: jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock)),
}));

import { AttendanceService } from './attendance.service';
import { ApiError } from '../../common/errors/api-error';
import type { SaveAttendanceDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('AttendanceService', () => {
  const svc = new AttendanceService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('defaults unmarked students to PRESENT and returns the stored status for marked ones', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }, { id: 's-3' }]);
      txMock.attendance.findMany.mockResolvedValue([
        { studentId: 's-1', status: 'ABSENT' },
        { studentId: 's-2', status: 'LATE' },
      ]);

      const result = await svc.list(SCHOOL, CLASS_SECTION, '2026-07-21');

      expect(result).toEqual([
        { studentId: 's-1', status: 'ABSENT' },
        { studentId: 's-2', status: 'LATE' },
        { studentId: 's-3', status: 'PRESENT' },
      ]);
    });

    it('scopes the attendance lookup to the requested classSectionId and date', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([]);
      txMock.attendance.findMany.mockResolvedValue([]);

      await svc.list(SCHOOL, CLASS_SECTION, '2026-07-21');

      expect(txMock.attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classSectionId: CLASS_SECTION, date: new Date('2026-07-21') },
        }),
      );
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      await expect(svc.list(SCHOOL, 'does-not-exist', '2026-07-21')).rejects.toThrow(ApiError);
      expect(txMock.student.findMany).not.toHaveBeenCalled();
    });

    it('rejects a malformed date before ever opening a tenant transaction', async () => {
      await expect(svc.list(SCHOOL, CLASS_SECTION, 'not-a-date')).rejects.toThrow(ApiError);
      expect(txMock.classSection.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('upserts every mark once and returns the correct saved/absentees counts', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([
        { id: 's-1' },
        { id: 's-2' },
        { id: 's-3' },
        { id: 's-4' },
      ]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [
          { studentId: 's-1', status: 'ABSENT' },
          { studentId: 's-2', status: 'PRESENT' },
          { studentId: 's-3', status: 'ABSENT' },
          { studentId: 's-4', status: 'LATE' },
        ],
      };

      const result = await svc.save(SCHOOL, 'user-teacher-1', dto);

      expect(result).toEqual({ saved: 4, absentees: 2 });
      expect(txMock.attendance.upsert).toHaveBeenCalledTimes(4);
      expect(txMock.attendance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { one_mark_per_student_day: { studentId: 's-1', date: new Date('2026-07-21') } },
          create: expect.objectContaining({
            schoolId: SCHOOL,
            studentId: 's-1',
            classSectionId: CLASS_SECTION,
            status: 'ABSENT',
            markedById: 'teacher-1',
          }),
          update: expect.objectContaining({ status: 'ABSENT', markedById: 'teacher-1' }),
        }),
      );
    });

    it('resolves markedById to the caller Teacher.id when a linked Teacher row exists', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-42' });
      txMock.attendance.upsert.mockResolvedValue({});

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      };

      await svc.save(SCHOOL, 'user-teacher-42', dto);

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { userId: 'user-teacher-42' } });
      expect(txMock.attendance.upsert.mock.calls[0][0].create.markedById).toBe('teacher-42');
    });

    it('falls back to the caller User.id when no Teacher row is linked (e.g. SCHOOL_ADMIN)', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue(null);
      txMock.attendance.upsert.mockResolvedValue({});

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      };

      await svc.save(SCHOOL, 'admin-user-1', dto);

      expect(txMock.attendance.upsert.mock.calls[0][0].create.markedById).toBe('admin-user-1');
    });

    it('is idempotent: re-saving the same student/date targets the identical unique key so it upserts rather than duplicates', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      };

      await svc.save(SCHOOL, 'user-teacher-1', dto);
      await svc.save(SCHOOL, 'user-teacher-1', { ...dto, marks: [{ studentId: 's-1', status: 'PRESENT' }] });

      expect(txMock.attendance.upsert).toHaveBeenCalledTimes(2);
      expect(txMock.attendance.upsert.mock.calls[0][0].where).toEqual(
        txMock.attendance.upsert.mock.calls[1][0].where,
      );
      // The second, corrected mark is what should win on re-save.
      expect(txMock.attendance.upsert.mock.calls[1][0].update.status).toBe('PRESENT');
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId and never touches attendance rows', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      const dto: SaveAttendanceDto = {
        classSectionId: 'does-not-exist',
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      };

      await expect(svc.save(SCHOOL, 'user-teacher-1', dto)).rejects.toThrow(ApiError);
      expect(txMock.attendance.upsert).not.toHaveBeenCalled();
    });

    it('throws ApiError VALIDATION and writes nothing when a mark.studentId is not on the class section roster (cross-tenant write guard)', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      // Roster only contains s-1/s-2. Because `Student` has active RLS, a
      // foreign-school studentId would never appear here either — this is
      // the same check that closes the cross-tenant hole.
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [
          { studentId: 's-1', status: 'PRESENT' },
          { studentId: 'foreign-school-student', status: 'ABSENT' },
        ],
      };

      await expect(svc.save(SCHOOL, 'user-teacher-1', dto)).rejects.toMatchObject({
        response: { code: 'VALIDATION' },
      });
      expect(txMock.attendance.upsert).not.toHaveBeenCalled();
    });
  });
});

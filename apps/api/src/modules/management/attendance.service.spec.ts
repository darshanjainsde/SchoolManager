const txMock = {
  classSection: { findFirst: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
  attendance: { findMany: jest.fn(), upsert: jest.fn() },
  teacher: { findFirst: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { AttendanceService } from './attendance.service';
import { ApiError } from '../../common/errors/api-error';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { SaveAttendanceDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Let the post-response (fire-and-forget) notification work run to completion. */
const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

describe('AttendanceService', () => {
  const notifications = { notify: jest.fn() };
  const svc = new AttendanceService(notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    notifications.notify.mockResolvedValue({ sent: 0, failed: 0 });
    txMock.user.findMany.mockResolvedValue([]);
    txMock.school.findFirst.mockResolvedValue({ name: 'Green Valley School' });
    // `save` reads the pre-existing marks for the day to work out who is
    // NEWLY absent; default to "nothing stored yet" so every test that does
    // not care about re-saves behaves like a first save.
    txMock.attendance.findMany.mockResolvedValue([]);
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
    it('fires an ABSENCE_NOTICE only to the linked-user emails of students marked ABSENT in this call', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      // Roster-membership check (all 3 students).
      txMock.student.findMany.mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }, { id: 's-3' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});
      // Recipient resolution for the ABSENT student(s) only (s-1).
      txMock.student.findMany.mockResolvedValueOnce([
        { userId: 'u-1', firstName: 'Aisha', lastName: 'Khan' },
      ]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [
          { studentId: 's-1', status: 'ABSENT' },
          { studentId: 's-2', status: 'PRESENT' },
          { studentId: 's-3', status: 'LATE' },
        ],
      };

      await svc.save(SCHOOL, 'user-teacher-1', dto);
      await flushBackgroundWork();

      expect(txMock.student.findMany).toHaveBeenNthCalledWith(2, {
        where: { schoolId: SCHOOL, id: { in: ['s-1'] }, userId: { not: null } },
        select: { userId: true, firstName: true, lastName: true },
      });
      // Exactly the fields sendAbsenceNotice reads — nothing renders "undefined".
      expect(notifications.notify).toHaveBeenCalledWith('ABSENCE_NOTICE', [
        {
          email: 'parent@x.com',
          payload: {
            schoolName: 'Green Valley School',
            studentName: 'Aisha Khan',
            date: 'Tue, 21 Jul 2026',
          },
        },
      ]);
    });

    it('names each guardian\'s own child when several students are absent', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValueOnce([{ id: 's-1' }, { id: 's-2' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});
      txMock.student.findMany.mockResolvedValueOnce([
        { userId: 'u-1', firstName: 'Aisha', lastName: 'Khan' },
        { userId: 'u-2', firstName: 'Rohan', lastName: 'Mehta' },
      ]);
      txMock.user.findMany.mockResolvedValue([
        { id: 'u-1', email: 'aisha.parent@x.com' },
        { id: 'u-2', email: 'rohan.parent@x.com' },
      ]);

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [
          { studentId: 's-1', status: 'ABSENT' },
          { studentId: 's-2', status: 'ABSENT' },
        ],
      };

      await svc.save(SCHOOL, 'user-teacher-1', dto);
      await flushBackgroundWork();

      expect(notifications.notify).toHaveBeenCalledWith('ABSENCE_NOTICE', [
        {
          email: 'aisha.parent@x.com',
          payload: {
            schoolName: 'Green Valley School',
            studentName: 'Aisha Khan',
            date: 'Tue, 21 Jul 2026',
          },
        },
        {
          email: 'rohan.parent@x.com',
          payload: {
            schoolName: 'Green Valley School',
            studentName: 'Rohan Mehta',
            date: 'Tue, 21 Jul 2026',
          },
        },
      ]);
    });

    it('resolves recipients in a SEPARATE transaction, after the attendance write has committed', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValueOnce([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});
      txMock.student.findMany.mockResolvedValueOnce([
        { userId: 'u-1', firstName: 'Aisha', lastName: 'Khan' },
      ]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      };

      await svc.save(SCHOOL, 'user-teacher-1', dto);
      await flushBackgroundWork();

      expect(withTenantMock).toHaveBeenCalledTimes(2);
      expect(txMock.student.findMany.mock.invocationCallOrder[1]).toBeGreaterThan(
        txMock.attendance.upsert.mock.invocationCallOrder[0],
      );
    });

    it('still saves attendance when recipient resolution itself blows up (no rollback of the write)', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValueOnce([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});
      withTenantMock
        .mockImplementationOnce((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock))
        .mockImplementationOnce(() => Promise.reject(new Error('connection reset')));

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      };

      const result = await svc.save(SCHOOL, 'user-teacher-1', dto);
      await flushBackgroundWork();

      expect(result).toEqual({ saved: 1, absentees: 1 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not call the notification service when no student is marked ABSENT', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      };

      await svc.save(SCHOOL, 'user-teacher-1', dto);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('still saves attendance and returns the normal result even when the notification service rejects', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValueOnce([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});
      txMock.student.findMany.mockResolvedValueOnce([
        { userId: 'u-1', firstName: 'Aisha', lastName: 'Khan' },
      ]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      notifications.notify.mockRejectedValue(new Error('smtp down'));

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      };

      const result = await svc.save(SCHOOL, 'user-teacher-1', dto);
      await flushBackgroundWork();

      expect(result).toEqual({ saved: 1, absentees: 1 });
    });

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

    it('notifies a guardian only on the FIRST save of an ABSENT mark, not on a re-save', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});
      // Roster check (call 1) then recipient resolution (call 2) on save #1;
      // roster check again (call 3) on save #2 — no recipient lookup should
      // follow it, because nobody became newly absent.
      txMock.student.findMany
        .mockResolvedValueOnce([{ id: 's-1' }])
        .mockResolvedValueOnce([{ userId: 'u-1', firstName: 'Aisha', lastName: 'Khan' }])
        .mockResolvedValueOnce([{ id: 's-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      };

      // Save #1 — nothing stored yet, so s-1 is newly absent.
      txMock.attendance.findMany.mockResolvedValueOnce([]);
      const first = await svc.save(SCHOOL, 'user-teacher-1', dto);
      await flushBackgroundWork();

      expect(first).toEqual({ saved: 1, absentees: 1 });
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify).toHaveBeenCalledWith('ABSENCE_NOTICE', [
        expect.objectContaining({ email: 'parent@x.com' }),
      ]);

      // Save #2 — the very same payload, but the row now already says ABSENT.
      notifications.notify.mockClear();
      txMock.attendance.findMany.mockResolvedValueOnce([
        { studentId: 's-1', status: 'ABSENT' },
      ]);
      const second = await svc.save(SCHOOL, 'user-teacher-1', dto);
      await flushBackgroundWork();

      // The mark is still written (and still counted), only the email is skipped.
      expect(second).toEqual({ saved: 1, absentees: 1 });
      expect(txMock.attendance.upsert).toHaveBeenCalledTimes(2);
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does notify when a student flips from PRESENT to ABSENT on a re-save', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});
      txMock.student.findMany
        .mockResolvedValueOnce([{ id: 's-1' }])
        .mockResolvedValueOnce([{ userId: 'u-1', firstName: 'Aisha', lastName: 'Khan' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      txMock.attendance.findMany.mockResolvedValue([{ studentId: 's-1', status: 'PRESENT' }]);

      await svc.save(SCHOOL, 'user-teacher-1', {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      });
      await flushBackgroundWork();

      expect(notifications.notify).toHaveBeenCalledTimes(1);
    });

    it('reads the pre-existing marks for the same class/date inside the write transaction', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.upsert.mockResolvedValue({});

      await svc.save(SCHOOL, 'user-teacher-1', {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      });

      expect(txMock.attendance.findMany).toHaveBeenCalledWith({
        where: { classSectionId: CLASS_SECTION, date: new Date('2026-07-21') },
        select: { studentId: true, status: true },
      });
      // Read before the writes, so the "was already absent" answer is not
      // poisoned by this call's own upserts.
      expect(txMock.attendance.findMany.mock.invocationCallOrder[0]).toBeLessThan(
        txMock.attendance.upsert.mock.invocationCallOrder[0],
      );
    });
  });
});

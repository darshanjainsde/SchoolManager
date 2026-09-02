const txMock = {
  classSection: { findFirst: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
  attendance: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
  teacher: { findFirst: jest.fn() },
  registerChangeRequest: { findFirst: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

// Keep the real `Prisma` export (prisma-errors.ts's isP2002 relies on
// `instanceof Prisma.PrismaClientKnownRequestError`); only `withTenant`
// itself is stubbed so no real DB connection is ever attempted.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { ConflictException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ApiError } from '../../common/errors/api-error';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { SaveAttendanceDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** Let the post-response (fire-and-forget) notification work run to completion. */
const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

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
    notifications.notify.mockResolvedValue({ sent: 0, failed: 0 });
    audit.record.mockResolvedValue(undefined);
    txMock.user.findMany.mockResolvedValue([]);
    txMock.school.findFirst.mockResolvedValue({ name: 'Green Valley School' });
    // `save` reads the pre-existing marks for the day to work out who is
    // NEWLY absent; default to "nothing stored yet" so every test that does
    // not care about re-saves behaves like a first save.
    txMock.attendance.findMany.mockResolvedValue([]);
    // This suite's `save` tests all target a fixed calendar date
    // ('2026-07-21') that predates the past-day lock added later (see
    // attendance-lock.spec.ts for lock-specific coverage) and has since
    // rolled into the past relative to the real clock. None of these tests
    // are about the lock, so default to an approved, unexpired unlock being
    // on file for that (class, date) — the same shape `save` requires in
    // production — so they keep exercising what they were written for.
    txMock.registerChangeRequest.findFirst.mockResolvedValue({
      id: 'unlock-1',
      status: 'APPROVED',
      expiresAt: new Date('2999-01-01'),
    });
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
          where: { schoolId: SCHOOL, classSectionId: CLASS_SECTION, date: new Date('2026-07-21') },
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
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });
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
          schoolId: SCHOOL,
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
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });
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
          schoolId: SCHOOL,
          payload: {
            schoolName: 'Green Valley School',
            studentName: 'Aisha Khan',
            date: 'Tue, 21 Jul 2026',
          },
        },
        {
          email: 'rohan.parent@x.com',
          schoolId: SCHOOL,
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
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });
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
        txMock.attendance.createMany.mock.invocationCallOrder[0],
      );
    });

    it('still saves attendance when recipient resolution itself blows up (no rollback of the write)', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValueOnce([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });
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
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });

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
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });
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

    it('batches the write and returns the correct saved/absentees counts', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([
        { id: 's-1' },
        { id: 's-2' },
        { id: 's-3' },
        { id: 's-4' },
      ]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });

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
      expect(txMock.attendance.createMany).toHaveBeenCalledTimes(1);
      // Batched write: existing rows for these students on this date are
      // cleared, then all marks inserted in one createMany.
      expect(txMock.attendance.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            date: new Date('2026-07-21'),
            studentId: { in: expect.arrayContaining(['s-1']) },
          }),
        }),
      );
      expect(txMock.attendance.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            schoolId: SCHOOL,
            studentId: 's-1',
            classSectionId: CLASS_SECTION,
            status: 'ABSENT',
            markedById: 'teacher-1',
          }),
        ]),
      });
    });

    it('resolves markedById to the caller Teacher.id when a linked Teacher row exists', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-42' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      };

      await svc.save(SCHOOL, 'user-teacher-42', dto);

      expect(txMock.teacher.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, userId: 'user-teacher-42' } });
      expect(txMock.attendance.createMany.mock.calls[0][0].data[0].markedById).toBe('teacher-42');
    });

    it('falls back to the caller User.id when no Teacher row is linked (e.g. SCHOOL_ADMIN)', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue(null);
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      };

      await svc.save(SCHOOL, 'admin-user-1', dto, 'SCHOOL_ADMIN');

      expect(txMock.attendance.createMany.mock.calls[0][0].data[0].markedById).toBe('admin-user-1');
    });

    it('is idempotent: re-saving clears then re-inserts so it cannot duplicate', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      };

      await svc.save(SCHOOL, 'user-teacher-1', dto);
      await svc.save(SCHOOL, 'user-teacher-1', { ...dto, marks: [{ studentId: 's-1', status: 'PRESENT' }] });

      // Each save clears the day's rows for that student then re-inserts, so a
      // re-save can't duplicate — and the second, corrected mark wins.
      expect(txMock.attendance.createMany).toHaveBeenCalledTimes(2);
      expect(txMock.attendance.deleteMany).toHaveBeenCalledTimes(2);
      expect(txMock.attendance.createMany.mock.calls[0][0].data[0].status).toBe('ABSENT');
      expect(txMock.attendance.createMany.mock.calls[1][0].data[0].status).toBe('PRESENT');
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId and never touches attendance rows', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      const dto: SaveAttendanceDto = {
        classSectionId: 'does-not-exist',
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      };

      await expect(svc.save(SCHOOL, 'user-teacher-1', dto)).rejects.toThrow(ApiError);
      expect(txMock.attendance.createMany).not.toHaveBeenCalled();
    });

    /**
     * Regression net for N2 (retake race → 500): two teachers retaking the
     * same class+date can race to the (studentId, date) unique index — the
     * second writer's `createMany` fails with a Postgres P2002. Before this
     * fix that fell through to the global error filter's catch-all and
     * returned a bare 500. Mirrors AnnouncementsService.create's isP2002
     * handling.
     */
    it('surfaces a concurrent-retake unique-constraint violation as ConflictException (409), not a bare 500', async () => {
      const { Prisma } = jest.requireActual('@skoolos/db');
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 });
      txMock.attendance.createMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`studentId`,`date`)', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const dto: SaveAttendanceDto = {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'ABSENT' }],
      };

      await expect(svc.save(SCHOOL, 'user-teacher-1', dto)).rejects.toThrow(ConflictException);
      await expect(svc.save(SCHOOL, 'user-teacher-1', dto)).rejects.toThrow(
        'Attendance for this class was just taken by someone else — pull to refresh.',
      );
    });

    it('throws ApiError VALIDATION and writes nothing when a mark.studentId is not on the class section roster (cross-tenant write guard)', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      // Roster only contains s-1/s-2. Because `Student` has active RLS, a
      // foreign-school studentId would never appear here either — this is
      // the same check that closes the cross-tenant hole.
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });

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
      expect(txMock.attendance.createMany).not.toHaveBeenCalled();
    });

    it('notifies a guardian only on the FIRST save of an ABSENT mark, not on a re-save', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });
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
      // createMany runs once per save → twice across the first save + re-save.
      expect(second).toEqual({ saved: 1, absentees: 1 });
      expect(txMock.attendance.createMany).toHaveBeenCalledTimes(2);
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does notify when a student flips from PRESENT to ABSENT on a re-save', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });
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
      txMock.attendance.deleteMany.mockResolvedValue({ count: 0 }); txMock.attendance.createMany.mockResolvedValue({ count: 0 });

      await svc.save(SCHOOL, 'user-teacher-1', {
        classSectionId: CLASS_SECTION,
        date: '2026-07-21',
        marks: [{ studentId: 's-1', status: 'PRESENT' }],
      });

      expect(txMock.attendance.findMany).toHaveBeenCalledWith({
        take: 2000,
        where: { schoolId: SCHOOL, classSectionId: CLASS_SECTION, date: new Date('2026-07-21') },
        select: { studentId: true, status: true, markedById: true },
      });
      // Read before the writes, so the "was already absent" answer is not
      // poisoned by this call's own upserts.
      expect(txMock.attendance.findMany.mock.invocationCallOrder[0]).toBeLessThan(
        txMock.attendance.createMany.mock.invocationCallOrder[0],
      );
    });

    describe('retake audit trail', () => {
      it('writes an ATTENDANCE_RETAKE audit entry with prior + new counts and markers when overwriting an existing day', async () => {
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
        txMock.student.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);
        txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-2' }); // this call's marker
        txMock.attendance.deleteMany.mockResolvedValue({ count: 0 });
        txMock.attendance.createMany.mockResolvedValue({ count: 0 });
        // Prior state for this class/date: one PRESENT, one ABSENT, both
        // marked by a DIFFERENT teacher (a previous save).
        txMock.attendance.findMany.mockResolvedValue([
          { studentId: 's-1', status: 'PRESENT', markedById: 'teacher-1' },
          { studentId: 's-2', status: 'ABSENT', markedById: 'teacher-1' },
        ]);

        const dto: SaveAttendanceDto = {
          classSectionId: CLASS_SECTION,
          date: '2026-07-21',
          marks: [
            { studentId: 's-1', status: 'ABSENT' },
            { studentId: 's-2', status: 'ABSENT' },
          ],
        };

        await svc.save(SCHOOL, 'user-teacher-2', dto);

        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            schoolId: SCHOOL,
            actorUserId: 'user-teacher-2',
            action: 'ATTENDANCE_RETAKE',
            entity: 'Attendance',
            entityId: CLASS_SECTION,
            meta: expect.objectContaining({
              classSectionId: CLASS_SECTION,
              date: '2026-07-21',
              previous: expect.objectContaining({
                present: 1,
                absent: 1,
                total: 2,
                markedById: 'teacher-1',
              }),
              current: expect.objectContaining({
                present: 0,
                absent: 2,
                total: 2,
                markedById: 'teacher-2',
              }),
            }),
          }),
        );
      });

      it('does not write a retake audit entry when the day had no prior rows (a fresh save)', async () => {
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
        txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
        txMock.teacher.findFirst.mockResolvedValue({ id: 'teacher-1' });
        txMock.attendance.deleteMany.mockResolvedValue({ count: 0 });
        txMock.attendance.createMany.mockResolvedValue({ count: 0 });
        txMock.attendance.findMany.mockResolvedValue([]); // nothing stored yet for this day

        const dto: SaveAttendanceDto = {
          classSectionId: CLASS_SECTION,
          date: '2026-07-21',
          marks: [{ studentId: 's-1', status: 'PRESENT' }],
        };

        await svc.save(SCHOOL, 'user-teacher-1', dto);

        expect(audit.record).not.toHaveBeenCalled();
      });
    });
  });
});

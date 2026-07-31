const txMock = {
  classSection: { findFirst: jest.fn() },
  exam: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
  subject: { findFirst: jest.fn() },
  result: { upsert: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  notificationOutbox: { create: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { ExamsService } from './exams.service';
import { ApiError } from '../../common/errors/api-error';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { AttendanceService } from './attendance.service';
import type { CreateExamDto, SaveExamResultsDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUBJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CALLER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const EXAM_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
/** A class section distinct from `CLASS_SECTION` — never in the caller's `myClassSections`. */
const OTHER_SECTION = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** Let the post-response (fire-and-forget) notification work run to completion. */
const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

describe('ExamsService', () => {
  const notifications = { notify: jest.fn() };
  const attendance = { myClassSections: jest.fn() };
  const svc = new ExamsService(
    notifications as unknown as NotificationService,
    attendance as unknown as AttendanceService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    notifications.notify.mockResolvedValue({ sent: 0, failed: 0 });
    // Recipient resolution runs after every create()/publish() — default to no
    // linked-user students so tests that don't care about notifications
    // don't need to stub these too.
    txMock.student.findMany.mockResolvedValue([]);
    txMock.user.findMany.mockResolvedValue([]);
    txMock.school.findFirst.mockResolvedValue({ name: 'Green Valley School' });
    txMock.subject.findFirst.mockResolvedValue({ name: 'Mathematics' });
    txMock.notificationOutbox.create.mockResolvedValue({ id: 'outbox-1' });
    // Most existing tests call as SCHOOL_ADMIN (unrestricted); this default
    // only matters for the TEACHER-ownership tests below, which override it.
    attendance.myClassSections.mockResolvedValue([]);
  });

  describe('create', () => {
    const dto: CreateExamDto = {
      classSectionId: CLASS_SECTION,
      subjectId: SUBJECT,
      title: 'Unit Test',
      scheduledAt: '2026-08-01T09:00:00.000Z',
      maxMarks: 100,
    };

    it('validates the classSection belongs to the school and sets createdById from the caller', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
        // `toExam()` (create()'s Date -> ISO-string mapping) reads every
        // column, including createdAt — a real `exam.create()` row always has one.
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      });

      const result = await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);

      expect(txMock.classSection.findFirst).toHaveBeenCalledWith({ where: { id: CLASS_SECTION } });
      expect(txMock.exam.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          schoolId: SCHOOL,
          classSectionId: CLASS_SECTION,
          subjectId: SUBJECT,
          title: 'Unit Test',
          maxMarks: 100,
          createdById: CALLER,
        }),
      });
      expect(result).toEqual(expect.objectContaining({ id: EXAM_ID }));
    });

    it('resolves section recipients and fires a TEST_SCHEDULED notification after the exam is created', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
        // `toExam()` (create()'s Date -> ISO-string mapping) reads every
        // column, including createdAt — a real `exam.create()` row always has one.
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);
      await flushBackgroundWork();

      expect(txMock.student.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, classSectionId: CLASS_SECTION, userId: { not: null } },
        select: { userId: true },
      });
      // The payload must carry exactly what the mail composer reads — the
      // names, not the ids — or the email renders "undefined". The third
      // argument restricts this best-effort call to email — push for this
      // event is the guaranteed NotificationOutbox row instead (see the
      // 'notification outbox' describe block below).
      expect(notifications.notify).toHaveBeenCalledWith(
        'TEST_SCHEDULED',
        [
          {
            email: 'parent@x.com',
            schoolId: SCHOOL,
            payload: {
              schoolName: 'Green Valley School',
              subjectName: 'Mathematics',
              examTitle: 'Unit Test',
              scheduledAt: 'Sat, 1 Aug 2026, 2:30 PM',
            },
          },
        ],
        ['email'],
      );
    });

    it('loads the school and subject names it needs, scoped to this school', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
        // `toExam()` (create()'s Date -> ISO-string mapping) reads every
        // column, including createdAt — a real `exam.create()` row always has one.
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);
      await flushBackgroundWork();

      expect(txMock.school.findFirst).toHaveBeenCalledWith({
        where: { id: SCHOOL },
        select: { name: true },
      });
      expect(txMock.subject.findFirst).toHaveBeenCalledWith({
        where: { id: SUBJECT, schoolId: SCHOOL },
        select: { name: true },
      });
    });

    it('resolves recipients in a SEPARATE transaction, after the exam write has committed', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
        // `toExam()` (create()'s Date -> ISO-string mapping) reads every
        // column, including createdAt — a real `exam.create()` row always has one.
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      });

      await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);
      await flushBackgroundWork();

      // One transaction for the mutation, a second for the notification reads.
      expect(withTenantMock).toHaveBeenCalledTimes(2);
      // …and the recipient lookup happens strictly after the exam write.
      expect(txMock.student.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
        txMock.exam.create.mock.invocationCallOrder[0],
      );
    });

    it('still creates the exam when recipient resolution itself blows up (no rollback of the write)', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
        // `toExam()` (create()'s Date -> ISO-string mapping) reads every
        // column, including createdAt — a real `exam.create()` row always has one.
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      // First withTenant (the mutation) succeeds; the notification one fails.
      withTenantMock
        .mockImplementationOnce((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock))
        .mockImplementationOnce(() => Promise.reject(new Error('connection reset')));

      const result = await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);
      await flushBackgroundWork();

      expect(result).toEqual(expect.objectContaining({ id: EXAM_ID }));
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('still creates the exam and returns it even when the notification service rejects', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
        // `toExam()` (create()'s Date -> ISO-string mapping) reads every
        // column, including createdAt — a real `exam.create()` row always has one.
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      notifications.notify.mockRejectedValue(new Error('smtp down'));

      const result = await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);
      await flushBackgroundWork();

      expect(result).toEqual(expect.objectContaining({ id: EXAM_ID }));
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId and never creates the exam', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      await expect(svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto)).rejects.toMatchObject({
        response: { code: 'CLASS_NOT_FOUND' },
      });
      expect(txMock.exam.create).not.toHaveBeenCalled();
    });

    it('rejects a non-positive maxMarks with VALIDATION before opening a tenant transaction', async () => {
      await expect(
        svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', { ...dto, maxMarks: 0 }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(txMock.classSection.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a non-integer maxMarks with VALIDATION', async () => {
      await expect(
        svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', { ...dto, maxMarks: 50.5 }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    });
  });

  // S6/S7 wiring: `create()` writes a NotificationOutbox row IN THE SAME
  // `withTenant` transaction as the Exam row, so a scheduled exam is never
  // visible without its outbox row (and a rolled-back transaction leaves no
  // orphan row either). Deletion-proof: delete the `tx.notificationOutbox.create`
  // call from `create()` and the first test below fails.
  describe('create — NotificationOutbox (S6/S7 wiring)', () => {
    const dto: CreateExamDto = {
      classSectionId: CLASS_SECTION,
      subjectId: SUBJECT,
      title: 'Unit Test',
      scheduledAt: '2026-08-01T09:00:00.000Z',
      maxMarks: 100,
    };

    beforeEach(() => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      });
    });

    it('writes an EXAM_SCHEDULED outbox row in the SAME transaction as the exam, with a fully denormalised payload', async () => {
      await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);

      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          kind: 'EXAM_SCHEDULED',
          classSectionId: CLASS_SECTION,
          payload: {
            schoolName: 'Green Valley School',
            subjectName: 'Mathematics',
            examTitle: 'Unit Test',
            scheduledAt: 'Sat, 1 Aug 2026, 2:30 PM',
            classSectionName: '8-C',
            maxMarks: 100,
          },
        },
      });
      // Both writes happened via the SAME `withTenant` call (the mutation
      // transaction) — the notification-context withTenant call used by the
      // best-effort email path is a separate, later one.
      expect(withTenantMock.mock.calls[0][0]).toBe(SCHOOL);
      expect(txMock.notificationOutbox.create.mock.invocationCallOrder[0]).toBeGreaterThan(
        txMock.exam.create.mock.invocationCallOrder[0],
      );
    });

    it('rolls back the exam write when the outbox write itself fails — same transaction, same fate', async () => {
      txMock.notificationOutbox.create.mockRejectedValue(new Error('db exploded'));

      await expect(svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto)).rejects.toThrow('db exploded');
    });
  });

  describe('list', () => {
    it('splits exams into upcoming and past ordered by scheduledAt', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      const now = new Date('2026-07-21T12:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      // classSectionId/subjectId/title/syllabus/maxMarks/createdById/createdAt
      // are irrelevant to this test's split-by-date assertions, but `list()`
      // now maps every row through `toExam()` (which stringifies `createdAt`
      // via `.toISOString()`), so a real row shape is needed here — a real
      // `Exam.findMany` result always carries every column.
      const base = {
        classSectionId: CLASS_SECTION,
        subjectId: SUBJECT,
        title: 'Unit Test',
        syllabus: null,
        maxMarks: 100,
        createdById: CALLER,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
      };
      txMock.exam.findMany.mockResolvedValue([
        { id: 'e1', ...base, scheduledAt: new Date('2026-07-20T00:00:00.000Z') },
        { id: 'e2', ...base, scheduledAt: new Date('2026-07-22T00:00:00.000Z') },
        { id: 'e3', ...base, scheduledAt: new Date('2026-07-21T12:00:00.000Z') },
      ]);

      const result = await svc.list(SCHOOL, CLASS_SECTION, CALLER, 'SCHOOL_ADMIN');

      expect(result.past.map((e) => e.id)).toEqual(['e1']);
      expect(result.upcoming.map((e) => e.id)).toEqual(['e2', 'e3']);
      expect(txMock.exam.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { schoolId: SCHOOL, classSectionId: CLASS_SECTION },
          orderBy: [{ scheduledAt: 'asc' }],
        }),
      );

      jest.useRealTimers();
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      await expect(svc.list(SCHOOL, 'does-not-exist', CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'CLASS_NOT_FOUND' },
      });
      expect(txMock.exam.findMany).not.toHaveBeenCalled();
    });
  });

  describe('results', () => {
    it('returns studentId/marks/publishedAt for every stored mark', async () => {
      txMock.exam.findFirst.mockResolvedValue({ id: EXAM_ID, schoolId: SCHOOL });
      const published = new Date('2026-08-02T10:00:00.000Z');
      txMock.result.findMany.mockResolvedValue([
        { studentId: 's-1', marks: 41, publishedAt: published },
        { studentId: 's-2', marks: 88, publishedAt: null },
      ]);

      const rows = await svc.results(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');

      // The shared `SavedResult` contract types `publishedAt` as an ISO
      // string, not `Date` — the shape every consumer actually receives once
      // Nest serialises the response to JSON (mirrors HolidaysService.toRow).
      expect(rows).toEqual([
        { studentId: 's-1', marks: 41, publishedAt: published.toISOString() },
        { studentId: 's-2', marks: 88, publishedAt: null },
      ]);
      expect(txMock.result.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { examId: EXAM_ID },
          select: { studentId: true, marks: true, publishedAt: true },
        }),
      );
    });

    it('scopes the exam lookup to the caller school and 404s on a foreign exam id', async () => {
      txMock.exam.findFirst.mockResolvedValue(null);

      await expect(svc.results(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(txMock.exam.findFirst).toHaveBeenCalledWith({
        where: { id: EXAM_ID, schoolId: SCHOOL },
      });
      expect(txMock.result.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty array when nothing has been marked yet', async () => {
      txMock.exam.findFirst.mockResolvedValue({ id: EXAM_ID, schoolId: SCHOOL });
      txMock.result.findMany.mockResolvedValue([]);

      await expect(svc.results(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN')).resolves.toEqual([]);
    });
  });

  describe('saveResults', () => {
    const dto: SaveExamResultsDto = {
      marks: [
        { studentId: 's-1', marks: 80 },
        { studentId: 's-2', marks: 45 },
      ],
    };

    it('rejects a foreign/out-of-section studentId with VALIDATION and writes nothing', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        maxMarks: 100,
      });
      // Roster only has s-1 — s-2 is foreign to this exam's class section.
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);

      await expect(svc.saveResults(SCHOOL, EXAM_ID, dto, CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'VALIDATION' },
      });
      expect(txMock.result.upsert).not.toHaveBeenCalled();
    });

    it('rejects marks above exam.maxMarks with VALIDATION and writes nothing', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        maxMarks: 50,
      });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);

      await expect(svc.saveResults(SCHOOL, EXAM_ID, dto, CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'VALIDATION' },
      });
      expect(txMock.result.upsert).not.toHaveBeenCalled();
    });

    it('rejects negative marks with VALIDATION and writes nothing', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        maxMarks: 100,
      });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);

      await expect(
        svc.saveResults(SCHOOL, EXAM_ID, { marks: [{ studentId: 's-1', marks: -5 }] }, CALLER, 'SCHOOL_ADMIN'),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(txMock.result.upsert).not.toHaveBeenCalled();
    });

    it('upserts every in-range mark once and returns the saved count', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        maxMarks: 100,
      });
      txMock.student.findMany.mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]);
      txMock.result.upsert.mockResolvedValue({});

      const result = await svc.saveResults(SCHOOL, EXAM_ID, dto, CALLER, 'SCHOOL_ADMIN');

      expect(result).toEqual({ saved: 2 });
      expect(txMock.result.upsert).toHaveBeenCalledTimes(2);
      expect(txMock.result.upsert).toHaveBeenCalledWith({
        where: { one_result_per_exam_student: { examId: EXAM_ID, studentId: 's-1' } },
        create: { examId: EXAM_ID, studentId: 's-1', marks: 80 },
        update: { marks: 80 },
      });
    });

    it('throws ApiError NOT_FOUND for a foreign/invalid exam id and never touches results', async () => {
      txMock.exam.findFirst.mockResolvedValue(null);

      await expect(svc.saveResults(SCHOOL, 'does-not-exist', dto, CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(txMock.student.findMany).not.toHaveBeenCalled();
      expect(txMock.result.upsert).not.toHaveBeenCalled();
    });

    it('scopes the exam lookup to this school so a foreign-school examId is treated as NOT_FOUND', async () => {
      txMock.exam.findFirst.mockResolvedValue(null);

      await svc.saveResults(SCHOOL, EXAM_ID, dto, CALLER, 'SCHOOL_ADMIN').catch(() => undefined);

      expect(txMock.exam.findFirst).toHaveBeenCalledWith({ where: { id: EXAM_ID, schoolId: SCHOOL } });
    });
  });

  describe('publish', () => {
    it('sets publishedAt on all of the exam Results in one call and returns the published count', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        maxMarks: 100,
      });
      txMock.result.updateMany.mockResolvedValue({ count: 3 });

      const result = await svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');

      expect(result).toEqual({ published: 3 });
      expect(txMock.result.updateMany).toHaveBeenCalledWith({
        where: { examId: EXAM_ID },
        data: { publishedAt: expect.any(Date) },
      });
    });

    it('resolves section recipients and fires a RESULTS_PUBLISHED notification after publishing', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        subjectId: SUBJECT,
        title: 'Midterm',
        maxMarks: 100,
      });
      txMock.result.updateMany.mockResolvedValue({ count: 2 });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      txMock.subject.findFirst.mockResolvedValue({ name: 'Chemistry' });

      await svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');
      await flushBackgroundWork();

      // Third argument restricts this best-effort call to email — see the
      // matching comment on the TEST_SCHEDULED assertion above.
      expect(notifications.notify).toHaveBeenCalledWith(
        'RESULTS_PUBLISHED',
        [
          {
            email: 'parent@x.com',
            schoolId: SCHOOL,
            payload: {
              schoolName: 'Green Valley School',
              subjectName: 'Chemistry',
              examTitle: 'Midterm',
            },
          },
        ],
        ['email'],
      );
    });

    it('does not announce "results published" when nothing was actually published', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        subjectId: SUBJECT,
        title: 'Midterm',
        maxMarks: 100,
      });
      txMock.result.updateMany.mockResolvedValue({ count: 0 });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      const result = await svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');
      await flushBackgroundWork();

      expect(result).toEqual({ published: 0 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('resolves recipients in a SEPARATE transaction, after the publish write has committed', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        subjectId: SUBJECT,
        title: 'Midterm',
        maxMarks: 100,
      });
      txMock.result.updateMany.mockResolvedValue({ count: 2 });

      await svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');
      await flushBackgroundWork();

      // Three transactions now: `loadExamForOwnership`'s ownership-resolution
      // read, the publish mutation itself, and a third for the notification
      // reads — still strictly sequential, never nested (see
      // `loadExamForOwnership`'s doc comment on why it can't share a tx with
      // `AttendanceService.myClassSections`).
      expect(withTenantMock).toHaveBeenCalledTimes(3);
      expect(txMock.student.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
        txMock.result.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('still returns the published count even when the notification service rejects', async () => {
      txMock.exam.findFirst.mockResolvedValue({
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        subjectId: SUBJECT,
        title: 'Midterm',
        maxMarks: 100,
      });
      txMock.result.updateMany.mockResolvedValue({ count: 3 });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      notifications.notify.mockRejectedValue(new Error('smtp down'));

      const result = await svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');
      await flushBackgroundWork();

      expect(result).toEqual({ published: 3 });
    });

    it('throws ApiError NOT_FOUND for a foreign/invalid exam id and never touches results', async () => {
      txMock.exam.findFirst.mockResolvedValue(null);

      await expect(svc.publish(SCHOOL, 'does-not-exist', CALLER, 'SCHOOL_ADMIN')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(txMock.result.updateMany).not.toHaveBeenCalled();
    });
  });

  // S6/S7 wiring: `publish()` writes a NotificationOutbox row IN THE SAME
  // `withTenant` transaction as the Result.updateMany write, gated on
  // `count > 0` exactly like the existing best-effort email path. Deletion-
  // proof: delete the `tx.notificationOutbox.create` call from `publish()`
  // and the first test below fails.
  describe('publish — NotificationOutbox (S6/S7 wiring)', () => {
    const examRow = {
      id: EXAM_ID,
      schoolId: SCHOOL,
      classSectionId: CLASS_SECTION,
      subjectId: SUBJECT,
      title: 'Midterm',
      maxMarks: 100,
    };

    beforeEach(() => {
      txMock.exam.findFirst.mockResolvedValue(examRow);
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION, name: '8-C' });
      txMock.subject.findFirst.mockResolvedValue({ name: 'Chemistry' });
    });

    it('writes a RESULT_PUBLISHED outbox row in the SAME transaction as the publish, with a fully denormalised payload', async () => {
      txMock.result.updateMany.mockResolvedValue({ count: 2 });

      await svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');

      expect(txMock.notificationOutbox.create).toHaveBeenCalledWith({
        data: {
          schoolId: SCHOOL,
          kind: 'RESULT_PUBLISHED',
          classSectionId: CLASS_SECTION,
          payload: {
            schoolName: 'Green Valley School',
            subjectName: 'Chemistry',
            examTitle: 'Midterm',
            classSectionName: '8-C',
            maxMarks: 100,
          },
        },
      });
      expect(txMock.notificationOutbox.create.mock.invocationCallOrder[0]).toBeGreaterThan(
        txMock.result.updateMany.mock.invocationCallOrder[0],
      );
    });

    it('writes NO outbox row when nothing was actually published (count: 0) — telling parents results are out would be a lie', async () => {
      txMock.result.updateMany.mockResolvedValue({ count: 0 });

      await svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN');

      expect(txMock.notificationOutbox.create).not.toHaveBeenCalled();
    });

    it('rolls back the publish write when the outbox write itself fails — same transaction, same fate', async () => {
      txMock.result.updateMany.mockResolvedValue({ count: 2 });
      txMock.notificationOutbox.create.mockRejectedValue(new Error('db exploded'));

      await expect(svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN')).rejects.toThrow('db exploded');
    });
  });

  // Any TEACHER who learned another class's UUID could otherwise schedule a
  // test for it (which emails that class's students/guardians), list its
  // exams, and enter/publish its results. Mirrors the ownership rule
  // `AnnouncementsService.create` already enforces for broadcast rights.
  describe('TEACHER class ownership', () => {
    const dto: CreateExamDto = {
      classSectionId: CLASS_SECTION,
      subjectId: SUBJECT,
      title: 'Unit Test',
      scheduledAt: '2026-08-01T09:00:00.000Z',
      maxMarks: 100,
    };
    const ownedSection = { classSectionId: CLASS_SECTION, name: '8-C', studentCount: 30, covering: false };
    const coveringOnlySection = {
      classSectionId: CLASS_SECTION,
      name: '8-C',
      studentCount: 30,
      covering: true,
    };

    describe('create', () => {
      it('rejects a TEACHER targeting a class section they do not own — no exam created, no notification fired', async () => {
        attendance.myClassSections.mockResolvedValue([]); // owns nothing

        await expect(svc.create(SCHOOL, CALLER, 'TEACHER', dto)).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        await flushBackgroundWork();

        expect(txMock.exam.create).not.toHaveBeenCalled();
        expect(notifications.notify).not.toHaveBeenCalled();
      });

      it('succeeds for a TEACHER targeting a class section they own', async () => {
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
        txMock.exam.create.mockResolvedValue({
          id: EXAM_ID,
          ...dto,
          scheduledAt: new Date(dto.scheduledAt),
          createdById: CALLER,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        });

        const result = await svc.create(SCHOOL, CALLER, 'TEACHER', dto);

        expect(result).toEqual(expect.objectContaining({ id: EXAM_ID }));
        expect(txMock.exam.create).toHaveBeenCalled();
      });

      it('rejects a TEACHER who only COVERS the class as a one-day substitute — covering a class once does not let you schedule tests for it', async () => {
        attendance.myClassSections.mockResolvedValue([coveringOnlySection]);

        await expect(svc.create(SCHOOL, CALLER, 'TEACHER', dto)).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.exam.create).not.toHaveBeenCalled();
      });
    });

    describe('list', () => {
      it('rejects a TEACHER listing exams for a class section they do not own', async () => {
        attendance.myClassSections.mockResolvedValue([]);

        await expect(svc.list(SCHOOL, CLASS_SECTION, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.exam.findMany).not.toHaveBeenCalled();
      });

      it('rejects a TEACHER who only COVERS the class', async () => {
        attendance.myClassSections.mockResolvedValue([coveringOnlySection]);

        await expect(svc.list(SCHOOL, CLASS_SECTION, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.exam.findMany).not.toHaveBeenCalled();
      });

      it('succeeds for a TEACHER listing exams for a class section they own', async () => {
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
        txMock.exam.findMany.mockResolvedValue([]);

        await expect(svc.list(SCHOOL, CLASS_SECTION, CALLER, 'TEACHER')).resolves.toEqual({
          upcoming: [],
          past: [],
        });
      });
    });

    // `results`/`saveResults`/`publish` take no classSectionId at all — a
    // caller cannot even attempt to substitute one in. Ownership is resolved
    // solely from the exam row's OWN, persisted classSectionId, fetched
    // fresh from the database rather than trusted from anywhere else.
    describe('results/saveResults/publish resolve ownership from the STORED exam row', () => {
      const examRow = {
        id: EXAM_ID,
        schoolId: SCHOOL,
        classSectionId: CLASS_SECTION,
        subjectId: SUBJECT,
        title: 'Midterm',
        maxMarks: 100,
      };

      it('results: rejects a TEACHER who does not own the exam\'s stored class section', async () => {
        txMock.exam.findFirst.mockResolvedValue(examRow);
        attendance.myClassSections.mockResolvedValue([]); // does not own CLASS_SECTION

        await expect(svc.results(SCHOOL, EXAM_ID, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.result.findMany).not.toHaveBeenCalled();
      });

      it('results: succeeds for a TEACHER who owns the exam\'s stored class section', async () => {
        txMock.exam.findFirst.mockResolvedValue(examRow);
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.result.findMany.mockResolvedValue([]);

        await expect(svc.results(SCHOOL, EXAM_ID, CALLER, 'TEACHER')).resolves.toEqual([]);
      });

      it('saveResults: rejects a TEACHER who does not own the exam\'s stored class section — writes nothing', async () => {
        txMock.exam.findFirst.mockResolvedValue(examRow);
        attendance.myClassSections.mockResolvedValue([]); // owns some OTHER class, not this exam's

        await expect(
          svc.saveResults(
            SCHOOL,
            EXAM_ID,
            { marks: [{ studentId: 's-1', marks: 10 }] },
            CALLER,
            'TEACHER',
          ),
        ).rejects.toMatchObject({ response: { code: 'CLASS_NOT_OWNED' } });
        expect(txMock.result.upsert).not.toHaveBeenCalled();
      });

      it('saveResults: succeeds for a TEACHER who owns the exam\'s stored class section', async () => {
        txMock.exam.findFirst.mockResolvedValue(examRow);
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.student.findMany.mockResolvedValue([{ id: 's-1' }]);
        txMock.result.upsert.mockResolvedValue({});

        await expect(
          svc.saveResults(
            SCHOOL,
            EXAM_ID,
            { marks: [{ studentId: 's-1', marks: 10 }] },
            CALLER,
            'TEACHER',
          ),
        ).resolves.toEqual({ saved: 1 });
      });

      it('publish: rejects a TEACHER who does not own the exam\'s stored class section — publishes nothing', async () => {
        txMock.exam.findFirst.mockResolvedValue(examRow);
        attendance.myClassSections.mockResolvedValue([]);

        await expect(svc.publish(SCHOOL, EXAM_ID, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.result.updateMany).not.toHaveBeenCalled();
      });

      it('publish: succeeds for a TEACHER who owns the exam\'s stored class section', async () => {
        txMock.exam.findFirst.mockResolvedValue(examRow);
        attendance.myClassSections.mockResolvedValue([ownedSection]);
        txMock.result.updateMany.mockResolvedValue({ count: 2 });

        await expect(svc.publish(SCHOOL, EXAM_ID, CALLER, 'TEACHER')).resolves.toEqual({ published: 2 });
      });

      it('publish: a covering-only TEACHER cannot publish results for the class they substituted in', async () => {
        txMock.exam.findFirst.mockResolvedValue(examRow);
        attendance.myClassSections.mockResolvedValue([coveringOnlySection]);

        await expect(svc.publish(SCHOOL, EXAM_ID, CALLER, 'TEACHER')).rejects.toMatchObject({
          response: { code: 'CLASS_NOT_OWNED' },
        });
        expect(txMock.result.updateMany).not.toHaveBeenCalled();
      });
    });

    describe('SCHOOL_ADMIN is unrestricted', () => {
      it('create: never consults myClassSections for a SCHOOL_ADMIN caller', async () => {
        txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
        txMock.exam.create.mockResolvedValue({
          id: EXAM_ID,
          ...dto,
          scheduledAt: new Date(dto.scheduledAt),
          createdById: CALLER,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        });

        await svc.create(SCHOOL, CALLER, 'SCHOOL_ADMIN', dto);

        expect(attendance.myClassSections).not.toHaveBeenCalled();
      });

      it('publish: never consults myClassSections for a SCHOOL_ADMIN caller, even on an unowned-looking class', async () => {
        txMock.exam.findFirst.mockResolvedValue({
          id: EXAM_ID,
          schoolId: SCHOOL,
          classSectionId: OTHER_SECTION,
          subjectId: SUBJECT,
          title: 'Midterm',
          maxMarks: 100,
        });
        txMock.result.updateMany.mockResolvedValue({ count: 1 });

        await expect(svc.publish(SCHOOL, EXAM_ID, CALLER, 'SCHOOL_ADMIN')).resolves.toEqual({
          published: 1,
        });
        expect(attendance.myClassSections).not.toHaveBeenCalled();
      });
    });
  });
});

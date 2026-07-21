const txMock = {
  classSection: { findFirst: jest.fn() },
  exam: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
  subject: { findFirst: jest.fn() },
  result: { upsert: jest.fn(), updateMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { ExamsService } from './exams.service';
import { ApiError } from '../../common/errors/api-error';
import type { NotificationService } from '../../common/notifications/notification.service';
import type { CreateExamDto, SaveExamResultsDto } from './management.dto';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SUBJECT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CALLER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const EXAM_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

/** Let the post-response (fire-and-forget) notification work run to completion. */
const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

describe('ExamsService', () => {
  const notifications = { notify: jest.fn() };
  const svc = new ExamsService(notifications as unknown as NotificationService);

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
      });

      const result = await svc.create(SCHOOL, CALLER, dto);

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
      });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      await svc.create(SCHOOL, CALLER, dto);
      await flushBackgroundWork();

      expect(txMock.student.findMany).toHaveBeenCalledWith({
        where: { schoolId: SCHOOL, classSectionId: CLASS_SECTION, userId: { not: null } },
        select: { userId: true },
      });
      // The payload must carry exactly what the mail composer reads — the
      // names, not the ids — or the email renders "undefined".
      expect(notifications.notify).toHaveBeenCalledWith('TEST_SCHEDULED', [
        {
          email: 'parent@x.com',
          payload: {
            schoolName: 'Green Valley School',
            subjectName: 'Mathematics',
            examTitle: 'Unit Test',
            scheduledAt: '2026-08-01T09:00:00.000Z',
          },
        },
      ]);
    });

    it('loads the school and subject names it needs, scoped to this school', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      txMock.exam.create.mockResolvedValue({
        id: EXAM_ID,
        ...dto,
        scheduledAt: new Date(dto.scheduledAt),
        createdById: CALLER,
      });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

      await svc.create(SCHOOL, CALLER, dto);
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
      });

      await svc.create(SCHOOL, CALLER, dto);
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
      });
      // First withTenant (the mutation) succeeds; the notification one fails.
      withTenantMock
        .mockImplementationOnce((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock))
        .mockImplementationOnce(() => Promise.reject(new Error('connection reset')));

      const result = await svc.create(SCHOOL, CALLER, dto);
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
      });
      txMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      txMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      notifications.notify.mockRejectedValue(new Error('smtp down'));

      const result = await svc.create(SCHOOL, CALLER, dto);
      await flushBackgroundWork();

      expect(result).toEqual(expect.objectContaining({ id: EXAM_ID }));
    });

    it('throws ApiError CLASS_NOT_FOUND for a foreign/invalid classSectionId and never creates the exam', async () => {
      txMock.classSection.findFirst.mockResolvedValue(null);

      await expect(svc.create(SCHOOL, CALLER, dto)).rejects.toMatchObject({
        response: { code: 'CLASS_NOT_FOUND' },
      });
      expect(txMock.exam.create).not.toHaveBeenCalled();
    });

    it('rejects a non-positive maxMarks with VALIDATION before opening a tenant transaction', async () => {
      await expect(
        svc.create(SCHOOL, CALLER, { ...dto, maxMarks: 0 }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
      expect(txMock.classSection.findFirst).not.toHaveBeenCalled();
    });

    it('rejects a non-integer maxMarks with VALIDATION', async () => {
      await expect(
        svc.create(SCHOOL, CALLER, { ...dto, maxMarks: 50.5 }),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    });
  });

  describe('list', () => {
    it('splits exams into upcoming and past ordered by scheduledAt', async () => {
      txMock.classSection.findFirst.mockResolvedValue({ id: CLASS_SECTION });
      const now = new Date('2026-07-21T12:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);

      txMock.exam.findMany.mockResolvedValue([
        { id: 'e1', scheduledAt: new Date('2026-07-20T00:00:00.000Z') },
        { id: 'e2', scheduledAt: new Date('2026-07-22T00:00:00.000Z') },
        { id: 'e3', scheduledAt: new Date('2026-07-21T12:00:00.000Z') },
      ]);

      const result = await svc.list(SCHOOL, CLASS_SECTION);

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

      await expect(svc.list(SCHOOL, 'does-not-exist')).rejects.toMatchObject({
        response: { code: 'CLASS_NOT_FOUND' },
      });
      expect(txMock.exam.findMany).not.toHaveBeenCalled();
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

      await expect(svc.saveResults(SCHOOL, EXAM_ID, dto)).rejects.toMatchObject({
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

      await expect(svc.saveResults(SCHOOL, EXAM_ID, dto)).rejects.toMatchObject({
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
        svc.saveResults(SCHOOL, EXAM_ID, { marks: [{ studentId: 's-1', marks: -5 }] }),
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

      const result = await svc.saveResults(SCHOOL, EXAM_ID, dto);

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

      await expect(svc.saveResults(SCHOOL, 'does-not-exist', dto)).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(txMock.student.findMany).not.toHaveBeenCalled();
      expect(txMock.result.upsert).not.toHaveBeenCalled();
    });

    it('scopes the exam lookup to this school so a foreign-school examId is treated as NOT_FOUND', async () => {
      txMock.exam.findFirst.mockResolvedValue(null);

      await svc.saveResults(SCHOOL, EXAM_ID, dto).catch(() => undefined);

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

      const result = await svc.publish(SCHOOL, EXAM_ID);

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

      await svc.publish(SCHOOL, EXAM_ID);
      await flushBackgroundWork();

      expect(notifications.notify).toHaveBeenCalledWith('RESULTS_PUBLISHED', [
        {
          email: 'parent@x.com',
          payload: {
            schoolName: 'Green Valley School',
            subjectName: 'Chemistry',
            examTitle: 'Midterm',
          },
        },
      ]);
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

      const result = await svc.publish(SCHOOL, EXAM_ID);
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

      await svc.publish(SCHOOL, EXAM_ID);
      await flushBackgroundWork();

      expect(withTenantMock).toHaveBeenCalledTimes(2);
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

      const result = await svc.publish(SCHOOL, EXAM_ID);
      await flushBackgroundWork();

      expect(result).toEqual({ published: 3 });
    });

    it('throws ApiError NOT_FOUND for a foreign/invalid exam id and never touches results', async () => {
      txMock.exam.findFirst.mockResolvedValue(null);

      await expect(svc.publish(SCHOOL, 'does-not-exist')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(txMock.result.updateMany).not.toHaveBeenCalled();
    });
  });
});

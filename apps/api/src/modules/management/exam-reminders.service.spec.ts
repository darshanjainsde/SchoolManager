const dbMock = {
  exam: { findMany: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findMany: jest.fn() },
  subject: { findMany: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => dbMock,
}));

import { ExamRemindersService } from './exam-reminders.service';
import type { NotificationService } from '../../common/notifications/notification.service';

const SCHOOL_1 = 'school-1';
const SCHOOL_2 = 'school-2';

describe('ExamRemindersService', () => {
  const notifications = { notify: jest.fn() };
  const svc = new ExamRemindersService(notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.school.findMany.mockResolvedValue([
      { id: SCHOOL_1, name: 'Green Valley School' },
      { id: SCHOOL_2, name: 'Riverside Academy' },
    ]);
    dbMock.subject.findMany.mockResolvedValue([
      { id: 'sub-1', name: 'Mathematics' },
      { id: 'sub-2', name: 'Physics' },
    ]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries exams via a date range covering exactly T-2 and T-1 UTC calendar days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([]);

    await svc.run();

    expect(dbMock.exam.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              scheduledAt: {
                gte: new Date('2026-07-23T00:00:00.000Z'),
                lt: new Date('2026-07-24T00:00:00.000Z'),
              },
            },
            {
              scheduledAt: {
                gte: new Date('2026-07-22T00:00:00.000Z'),
                lt: new Date('2026-07-23T00:00:00.000Z'),
              },
            },
          ],
        },
      }),
    );
  });

  it('bounds the scan: a capped take and a narrow select, so one busy day cannot blow maxDuration', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([]);

    await svc.run();

    const args = dbMock.exam.findMany.mock.calls[0][0];
    expect(args.take).toBe(200);
    expect(args.orderBy).toEqual([{ scheduledAt: 'asc' }]);
    expect(args.select).toEqual({
      id: true,
      schoolId: true,
      classSectionId: true,
      subjectId: true,
      title: true,
      scheduledAt: true,
    });
  });

  it('resolves per-exam recipients across schools, sends TEST_REMINDER, and tallies exams/sent', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e1',
        schoolId: SCHOOL_1,
        classSectionId: 'cs-1',
        subjectId: 'sub-1',
        title: 'Midterm',
        scheduledAt: new Date('2026-07-23T09:00:00.000Z'),
      },
      {
        id: 'e2',
        schoolId: SCHOOL_2,
        classSectionId: 'cs-2',
        subjectId: 'sub-2',
        title: 'Quiz',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
    ]);
    // First exam's section has one linked-user student; second has none.
    dbMock.student.findMany
      .mockResolvedValueOnce([{ userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    dbMock.user.findMany.mockResolvedValueOnce([{ id: 'u-1', email: 'parent@x.com' }]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });

    const result = await svc.run();

    expect(result).toEqual({ exams: 2, sent: 1 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    // Names, not ids — this is what the reminder email actually renders.
    expect(notifications.notify).toHaveBeenCalledWith('TEST_REMINDER', [
      {
        email: 'parent@x.com',
        schoolId: SCHOOL_1,
        payload: {
          schoolName: 'Green Valley School',
          subjectName: 'Mathematics',
          examTitle: 'Midterm',
          scheduledAt: 'Thu, 23 Jul 2026, 2:30 PM',
          daysUntil: 2,
        },
      },
    ]);
  });

  it('marks a T-1-day exam as 1 day out', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e2',
        schoolId: SCHOOL_2,
        classSectionId: 'cs-2',
        subjectId: 'sub-2',
        title: 'Quiz',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
    ]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-2' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-2', email: 'other@x.com' }]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });

    await svc.run();

    expect(notifications.notify).toHaveBeenCalledWith('TEST_REMINDER', [
      {
        email: 'other@x.com',
        schoolId: SCHOOL_2,
        payload: {
          schoolName: 'Riverside Academy',
          subjectName: 'Physics',
          examTitle: 'Quiz',
          scheduledAt: 'Wed, 22 Jul 2026, 2:30 PM',
          daysUntil: 1,
        },
      },
    ]);
  });

  it('scopes recipient resolution to the exam\'s own school (the platform client bypasses RLS)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e1',
        schoolId: SCHOOL_1,
        classSectionId: 'cs-1',
        subjectId: 'sub-1',
        title: 'Midterm',
        scheduledAt: new Date('2026-07-23T09:00:00.000Z'),
      },
    ]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });

    await svc.run();

    expect(dbMock.student.findMany).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL_1, classSectionId: 'cs-1', userId: { not: null } },
      select: { userId: true },
    });
    expect(dbMock.user.findMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL_1);
  });

  it('does not call notify for an exam whose section has no linked-user recipients', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e3',
        schoolId: 'school-3',
        classSectionId: 'cs-3',
        subjectId: 'sub-1',
        title: 'No recipients',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
    ]);
    dbMock.student.findMany.mockResolvedValue([]);

    const result = await svc.run();

    expect(result).toEqual({ exams: 1, sent: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does not query names or recipients at all when no exam is due', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([]);

    const result = await svc.run();

    expect(result).toEqual({ exams: 0, sent: 0 });
    expect(dbMock.school.findMany).not.toHaveBeenCalled();
    expect(dbMock.student.findMany).not.toHaveBeenCalled();
  });

  it('does not abort the run when one exam errors out — other exams still get their reminder sent', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e-fail',
        schoolId: SCHOOL_1,
        classSectionId: 'cs-fail',
        subjectId: 'sub-1',
        title: 'Broken',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
      {
        id: 'e-ok',
        schoolId: SCHOOL_2,
        classSectionId: 'cs-ok',
        subjectId: 'sub-2',
        title: 'Fine',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
    ]);
    dbMock.student.findMany
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce([{ userId: 'u-2' }]);
    dbMock.user.findMany.mockResolvedValueOnce([{ id: 'u-2', email: 'ok@x.com' }]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });

    await expect(svc.run()).resolves.toEqual({ exams: 2, sent: 1 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('processes a large day in bounded concurrent batches rather than one long serial chain', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    const exams = Array.from({ length: 25 }, (_, i) => ({
      id: `e-${i}`,
      schoolId: SCHOOL_1,
      classSectionId: `cs-${i}`,
      subjectId: 'sub-1',
      title: `Test ${i}`,
      scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
    }));
    dbMock.exam.findMany.mockResolvedValue(exams);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });

    const result = await svc.run();

    expect(result).toEqual({ exams: 25, sent: 25 });
    expect(notifications.notify).toHaveBeenCalledTimes(25);
    // School/subject names are batched up front, not re-queried per exam.
    expect(dbMock.school.findMany).toHaveBeenCalledTimes(1);
    expect(dbMock.subject.findMany).toHaveBeenCalledTimes(1);
  });
});

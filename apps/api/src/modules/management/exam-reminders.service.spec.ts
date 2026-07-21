const dbMock = {
  exam: { findMany: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => dbMock,
}));

import { ExamRemindersService } from './exam-reminders.service';
import type { NotificationService } from '../../common/notifications/notification.service';

describe('ExamRemindersService', () => {
  const notifications = { notify: jest.fn() };
  const svc = new ExamRemindersService(notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries exams via a date range covering exactly T-2 and T-1 UTC calendar days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([]);

    await svc.run();

    expect(dbMock.exam.findMany).toHaveBeenCalledWith({
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
    });
  });

  it('resolves per-exam recipients across schools, sends TEST_REMINDER, and tallies exams/sent', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e1',
        schoolId: 'school-1',
        classSectionId: 'cs-1',
        title: 'Midterm',
        scheduledAt: new Date('2026-07-23T09:00:00.000Z'),
      },
      {
        id: 'e2',
        schoolId: 'school-2',
        classSectionId: 'cs-2',
        title: 'Quiz',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
    ]);
    // First exam's section has one linked-user student; second has none.
    dbMock.student.findMany
      .mockResolvedValueOnce([{ userId: 'u-1' }])
      .mockResolvedValueOnce([]);
    dbMock.user.findMany.mockResolvedValueOnce([{ email: 'parent@x.com' }]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });

    const result = await svc.run();

    expect(result).toEqual({ exams: 2, sent: 1 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      'TEST_REMINDER',
      ['parent@x.com'],
      expect.objectContaining({ examId: 'e1', schoolId: 'school-1', daysUntil: 2 }),
    );
  });

  it('does not call notify for an exam whose section has no linked-user recipients', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e3',
        schoolId: 'school-3',
        classSectionId: 'cs-3',
        title: 'No recipients',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
    ]);
    dbMock.student.findMany.mockResolvedValue([]);

    const result = await svc.run();

    expect(result).toEqual({ exams: 1, sent: 0 });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('does not abort the run when one exam errors out — other exams still get their reminder sent', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T03:00:00.000Z'));
    dbMock.exam.findMany.mockResolvedValue([
      {
        id: 'e-fail',
        schoolId: 'school-1',
        classSectionId: 'cs-fail',
        title: 'Broken',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
      {
        id: 'e-ok',
        schoolId: 'school-2',
        classSectionId: 'cs-ok',
        title: 'Fine',
        scheduledAt: new Date('2026-07-22T09:00:00.000Z'),
      },
    ]);
    dbMock.student.findMany
      .mockRejectedValueOnce(new Error('db exploded'))
      .mockResolvedValueOnce([{ userId: 'u-2' }]);
    dbMock.user.findMany.mockResolvedValueOnce([{ email: 'ok@x.com' }]);
    notifications.notify.mockResolvedValue({ sent: 1, failed: 0 });

    await expect(svc.run()).resolves.toEqual({ exams: 2, sent: 1 });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });
});

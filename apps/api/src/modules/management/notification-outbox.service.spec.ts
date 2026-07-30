const dbMock = {
  notificationOutbox: { findMany: jest.fn(), update: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => dbMock,
}));

import { NotificationOutboxService } from './notification-outbox.service';
import type { PushChannel } from '../../common/notifications/push.channel';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const examScheduledRow = {
  id: 'row-1',
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
  sentAt: null,
  attempts: 0,
  lastError: null,
};

const resultPublishedRow = {
  id: 'row-2',
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
  sentAt: null,
  attempts: 0,
  lastError: null,
};

const assignmentPostedRow = {
  id: 'row-3',
  schoolId: SCHOOL,
  kind: 'ASSIGNMENT_POSTED',
  classSectionId: CLASS_SECTION,
  payload: {
    schoolName: 'Green Valley School',
    subjectName: 'Mathematics',
    assignmentTitle: 'Worksheet 3',
    dueDate: 'Wed, 5 Aug 2026',
    classSectionName: '8-C',
  },
  sentAt: null,
  attempts: 0,
  lastError: null,
};

describe('NotificationOutboxService', () => {
  const push = { send: jest.fn() };
  const svc = new NotificationOutboxService(push as unknown as PushChannel);

  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.notificationOutbox.findMany.mockResolvedValue([]);
    dbMock.notificationOutbox.update.mockResolvedValue({});
    dbMock.student.findMany.mockResolvedValue([]);
    dbMock.user.findMany.mockResolvedValue([]);
    push.send.mockResolvedValue(true);
  });

  it('only fetches unsent rows with attempts under the cap, oldest first, up to the batch cap', async () => {
    await svc.drain();

    expect(dbMock.notificationOutbox.findMany).toHaveBeenCalledWith({
      where: { sentAt: null, attempts: { lt: 5 } },
      orderBy: [{ createdAt: 'asc' }],
      take: 200,
    });
  });

  it('resolves recipients for the row\'s own classSectionId, sends push to each, and marks sentAt on success', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

    const result = await svc.drain();

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(dbMock.student.findMany).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, classSectionId: CLASS_SECTION, userId: { not: null } },
      select: { userId: true },
    });
    expect(push.send).toHaveBeenCalledWith(
      'parent@x.com',
      {
        kind: 'TEST_SCHEDULED',
        payload: {
          schoolName: 'Green Valley School',
          subjectName: 'Mathematics',
          examTitle: 'Unit Test',
          scheduledAt: 'Sat, 1 Aug 2026, 2:30 PM',
          classSectionName: '8-C',
        },
      },
      SCHOOL,
    );
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('maps a RESULT_PUBLISHED row onto the RESULTS_PUBLISHED push text, dropping the extra denormalised fields the template does not render', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([resultPublishedRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-2' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-2', email: 'other@x.com' }]);

    await svc.drain();

    expect(push.send).toHaveBeenCalledWith(
      'other@x.com',
      {
        kind: 'RESULTS_PUBLISHED',
        payload: {
          schoolName: 'Green Valley School',
          subjectName: 'Chemistry',
          examTitle: 'Midterm',
        },
      },
      SCHOOL,
    );
  });

  it('maps an ASSIGNMENT_POSTED row onto the EXISTING ANNOUNCEMENT push text — no new template', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([assignmentPostedRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-3' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-3', email: 'family@x.com' }]);

    await svc.drain();

    expect(push.send).toHaveBeenCalledWith(
      'family@x.com',
      {
        kind: 'ANNOUNCEMENT',
        payload: {
          schoolName: 'Green Valley School',
          title: 'Worksheet 3',
          body: 'Mathematics — due Wed, 5 Aug 2026',
          className: '8-C',
        },
      },
      SCHOOL,
    );
  });

  it('never reads Exam/Subject/ClassSection — the payload is denormalised, so the drain does not join', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

    await svc.drain();

    expect((dbMock as Record<string, unknown>).exam).toBeUndefined();
    expect((dbMock as Record<string, unknown>).subject).toBeUndefined();
    expect((dbMock as Record<string, unknown>).classSection).toBeUndefined();
  });

  it('marks a row sent even with zero recipients — nothing to retry', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([]);

    const result = await svc.drain();

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(push.send).not.toHaveBeenCalled();
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('on failure, increments attempts and records lastError, leaves sentAt unset, and continues the rest of the batch', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([examScheduledRow, resultPublishedRow]);
    dbMock.student.findMany
      .mockResolvedValueOnce([{ userId: 'u-1' }]) // row-1's recipients blow up below
      .mockResolvedValueOnce([{ userId: 'u-2' }]); // row-2 succeeds
    dbMock.user.findMany
      .mockResolvedValueOnce([{ id: 'u-1', email: 'parent@x.com' }])
      .mockResolvedValueOnce([{ id: 'u-2', email: 'other@x.com' }]);
    push.send
      .mockRejectedValueOnce(new Error('expo down'))
      .mockResolvedValueOnce(true);

    const result = await svc.drain();

    expect(result).toEqual({ processed: 2, sent: 1, failed: 1 });
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { attempts: { increment: 1 }, lastError: 'expo down' },
    });
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-2' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('an invalid/unknown kind is treated as a failure for that row, not a crash of the whole drain', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([
      { ...examScheduledRow, kind: 'SOMETHING_ELSE' },
    ]);

    const result = await svc.drain();

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { attempts: { increment: 1 }, lastError: expect.stringContaining('SOMETHING_ELSE') },
    });
  });

  it('does not blow up the whole run when even the failure-bookkeeping update rejects', async () => {
    dbMock.notificationOutbox.findMany.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
    push.send.mockRejectedValue(new Error('expo down'));
    dbMock.notificationOutbox.update.mockRejectedValue(new Error('db also down'));

    await expect(svc.drain()).resolves.toEqual({ processed: 1, sent: 0, failed: 1 });
  });
});

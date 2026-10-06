const dbMock = {
  $queryRaw: jest.fn(),
  notificationOutbox: { findMany: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => dbMock,
}));

import { NotificationOutboxService } from './notification-outbox.service';
import type { PushChannel } from '../../common/notifications/push.channel';
import { OUTBOX_DRAIN_DELAY_MS, resetOutboxSignal, requestOutboxDrain } from '../../common/notifications/outbox-signal';

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
  const whatsapp = { send: jest.fn().mockResolvedValue(false) };
  const svc = new NotificationOutboxService(push as unknown as PushChannel, whatsapp as never);

  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationOutbox.update.mockResolvedValue({});
    dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.student.findMany.mockResolvedValue([]);
    dbMock.user.findMany.mockResolvedValue([]);
    dbMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School' });
    push.send.mockResolvedValue(true);
  });

  it('claims unsent rows under the attempt cap, oldest first, skipping rows another drain holds', async () => {
    await svc.drain();

    // The batch is claimed in one statement rather than merely selected: the
    // cron now runs every minute, so two drains overlapping is routine, and a
    // plain read would let both send the same row.
    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = dbMock.$queryRaw.mock.calls[0];
    const sql = (strings as string[]).join(' ? ');

    expect(sql).toMatch(/UPDATE "NotificationOutbox"/);
    expect(sql).toMatch(/SET "claimedAt" = now\(\)/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(sql).toMatch(/"sentAt" IS NULL/);
    expect(sql).toMatch(/ORDER BY "createdAt" ASC/);
    // Bound parameters, never interpolated: attempt cap, stale-claim cutoff, batch cap.
    expect(values[0]).toBe(5);
    expect(values[1]).toBeInstanceOf(Date);
    expect(values[2]).toBe(200);
  });

  it('resolves recipients for the row\'s own classSectionId, sends push to each, and marks sentAt on success', async () => {
    dbMock.$queryRaw.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

    const result = await svc.drain();

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, purged: 0 });
    expect(dbMock.student.findMany).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, status: 'ACTIVE', classSectionId: CLASS_SECTION, userId: { not: null } },
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
    dbMock.$queryRaw.mockResolvedValue([resultPublishedRow]);
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
    dbMock.$queryRaw.mockResolvedValue([assignmentPostedRow]);
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
          // The day the row is drained, written for a reader ("5 August").
          // Pinned by SHAPE, not value: the drain runs on a real clock.
          postedOn: expect.stringMatching(/^\d{1,2} [A-Z][a-z]+$/),
        },
      },
      SCHOOL,
    );
  });

  it('a SPORTS_NOTICE row with no schoolName gets the school\'s name filled in by the drain, once per school', async () => {
    const sportsRow = (id: string) => ({
      id,
      schoolId: SCHOOL,
      kind: 'SPORTS_NOTICE',
      classSectionId: null,
      targetUserId: 'u-9',
      payload: { title: '100 m U-11: Final', body: '14.2 s · 1st — champion!' },
      sentAt: null,
      attempts: 0,
      lastError: null,
    });
    dbMock.$queryRaw.mockResolvedValue([sportsRow('row-s1'), sportsRow('row-s2')]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-9', email: 'sports@x.com' }]);

    await svc.drain();

    expect(whatsapp.send).toHaveBeenCalledTimes(2);
    expect(whatsapp.send).toHaveBeenCalledWith(
      'sports@x.com',
      expect.objectContaining({
        kind: 'ANNOUNCEMENT',
        payload: expect.objectContaining({ schoolName: 'Raffles Public School', title: '100 m U-11: Final', className: 'Sports' }),
      }),
      SCHOOL,
    );
    expect(dbMock.school.findFirst).toHaveBeenCalledTimes(1);
  });

  it('never reads Exam/Subject/ClassSection — the payload is denormalised, so the drain does not join', async () => {
    dbMock.$queryRaw.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);

    await svc.drain();

    expect((dbMock as Record<string, unknown>).exam).toBeUndefined();
    expect((dbMock as Record<string, unknown>).subject).toBeUndefined();
    expect((dbMock as Record<string, unknown>).classSection).toBeUndefined();
  });

  it('marks a row sent even with zero recipients — nothing to retry', async () => {
    dbMock.$queryRaw.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([]);

    const result = await svc.drain();

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, purged: 0 });
    expect(push.send).not.toHaveBeenCalled();
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('on failure, increments attempts and records lastError, leaves sentAt unset, and continues the rest of the batch', async () => {
    dbMock.$queryRaw.mockResolvedValue([examScheduledRow, resultPublishedRow]);
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

    expect(result).toEqual({ processed: 2, sent: 1, failed: 1, purged: 0 });
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { attempts: { increment: 1 }, claimedAt: null, lastError: 'expo down' },
    });
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-2' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('an invalid/unknown kind is treated as a failure for that row, not a crash of the whole drain', async () => {
    dbMock.$queryRaw.mockResolvedValue([
      { ...examScheduledRow, kind: 'SOMETHING_ELSE' },
    ]);

    const result = await svc.drain();

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1, purged: 0 });
    expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { attempts: { increment: 1 }, claimedAt: null, lastError: expect.stringContaining('SOMETHING_ELSE') },
    });
  });

  it('does not blow up the whole run when even the failure-bookkeeping update rejects', async () => {
    dbMock.$queryRaw.mockResolvedValue([examScheduledRow]);
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
    push.send.mockRejectedValue(new Error('expo down'));
    dbMock.notificationOutbox.update.mockRejectedValue(new Error('db also down'));

    await expect(svc.drain()).resolves.toEqual({ processed: 1, sent: 0, failed: 1, purged: 0 });
  });

  describe('retention sweep', () => {
    /**
     * The safety property of the purge, asserted on the predicate itself
     * rather than on a count: `sentAt: { lt: cutoff }` compiles to
     * `"sentAt" < $1`, and SQL never returns true for a NULL comparison, so an
     * undelivered row cannot match however old it is. If someone later
     * "simplifies" this to an OR on `sentAt: null`, or drops the `sentAt`
     * clause and filters on `createdAt` instead, this fails.
     */
    /**
     * The sweep filters on `sentAt`, which is not the leading column of the
     * only index here, so it scans. Once a night that is nothing; on the
     * opportunistic path it rode along with every message sent. These assert
     * the sweep stays on the cron.
     */
    it('the opportunistic delivery path does not sweep', async () => {
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationOutbox.deleteMany).not.toHaveBeenCalled();
      expect(r.purged).toBe(0);
    });

    it('drainSoon never sweeps — it runs on the hot path of an ordinary request', async () => {
      jest.useFakeTimers();
      try {
        svc.onModuleInit();
        svc.drainSoon();
        // The claim query should not have been called yet (waiting for delay)
        expect(dbMock.$queryRaw).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
        // After delay, drain runs and makes the claim query
        expect(dbMock.$queryRaw).toHaveBeenCalled();
        // But purge must NOT run (purge: false)
        expect(dbMock.notificationOutbox.deleteMany).not.toHaveBeenCalled();
      } finally {
        resetOutboxSignal();
        jest.useRealTimers();
      }
    });

    it('onModuleInit registers the drainer, onModuleDestroy unregisters it', async () => {
      jest.useFakeTimers();
      try {
        const drainSpy = jest.spyOn(svc, 'drain').mockResolvedValue({ processed: 0, sent: 0, failed: 0, purged: 0 });

        // After init, requestOutboxDrain should schedule the drain
        svc.onModuleInit();
        requestOutboxDrain();
        await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
        expect(drainSpy).toHaveBeenCalledWith({ purge: false });

        // After destroy, requestOutboxDrain should do nothing
        drainSpy.mockClear();
        svc.onModuleDestroy();
        requestOutboxDrain();
        await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
        expect(drainSpy).not.toHaveBeenCalled();

        drainSpy.mockRestore();
      } finally {
        resetOutboxSignal();
        jest.useRealTimers();
      }
    });

    it('only ever deletes rows that were actually delivered', async () => {
      await svc.drain();

      expect(dbMock.notificationOutbox.deleteMany).toHaveBeenCalledTimes(1);
      const where = dbMock.notificationOutbox.deleteMany.mock.calls[0][0].where;
      expect(Object.keys(where)).toEqual(['sentAt']);
      expect(where.sentAt.lt).toBeInstanceOf(Date);
    });

    it('uses a 30-day cutoff', async () => {
      const before = Date.now();
      await svc.drain();

      const cutoff: Date = dbMock.notificationOutbox.deleteMany.mock.calls[0][0].where.sentAt.lt;
      const days = (before - cutoff.getTime()) / (24 * 60 * 60 * 1000);
      expect(days).toBeCloseTo(30, 3);
    });

    it('reports how many it removed', async () => {
      dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 7 });

      await expect(svc.drain()).resolves.toEqual({
        processed: 0,
        sent: 0,
        failed: 0,
        purged: 7,
      });
    });

    /**
     * Tidying up is not the job — delivery is. A retention failure must not
     * turn a successful drain into a failed cron run.
     */
    it('does not fail the drain when the sweep itself rejects', async () => {
      dbMock.$queryRaw.mockResolvedValue([examScheduledRow]);
      dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
      dbMock.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'parent@x.com' }]);
      dbMock.notificationOutbox.deleteMany.mockRejectedValue(new Error('lock timeout'));

      await expect(svc.drain()).resolves.toEqual({
        processed: 1,
        sent: 1,
        failed: 0,
        purged: 0,
      });
    });
  });
});

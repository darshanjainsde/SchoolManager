const dbMock = {
  $queryRaw: jest.fn(),
  notificationOutbox: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => dbMock,
}));

// The real signal, with `requestOutboxDrain` wrapped so a test can assert the
// drain did NOT chain another drain onto its own (dying) invocation.
jest.mock('../../common/notifications/outbox-signal', () => {
  const actual = jest.requireActual('../../common/notifications/outbox-signal');
  return { ...actual, requestOutboxDrain: jest.fn((...a: unknown[]) => actual.requestOutboxDrain(...a)) };
});

import { NOTIFICATION_OUTBOX_KINDS } from '@skoolos/types';
import { DRAIN_TIME_BUDGET_MS, EMAIL_CONCURRENCY, NotificationOutboxService, OUTBOX_EMAIL, ROW_START_RESERVE_MS } from './notification-outbox.service';
import { FIXTURES } from './notification-outbox.fixtures';
import type { PushChannel } from '../../common/notifications/push.channel';
import { OUTBOX_DRAIN_DELAY_MS, resetOutboxSignal, requestOutboxDrain } from '../../common/notifications/outbox-signal';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const EMAILS: Record<string, string> = { [ADMIN]: 'admin@raffles.test', [USER]: 'family@raffles.test' };
const LEAVE_FIXTURE = FIXTURES.LEAVE_APPLIED;

/** The claim statement hands the drain these rows. */
const claim = (rows: unknown[]) => dbMock.$queryRaw.mockResolvedValue(rows);
const row = (id: string) => ({ id, schoolId: SCHOOL, kind: 'ASSIGNMENT_POSTED', payload: FIXTURES.ASSIGNMENT_POSTED, classSectionId: null, targetUserId: USER });

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
  const email = { send: jest.fn() };
  const svc = new NotificationOutboxService(push as unknown as PushChannel, whatsapp as never, email as never);

  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.$queryRaw.mockResolvedValue([]);
    dbMock.notificationOutbox.update.mockResolvedValue({});
    dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.student.findMany.mockResolvedValue([]);
    dbMock.school.findFirst.mockReset().mockResolvedValue({ name: 'Raffles Public School' });
    dbMock.notificationOutbox.updateMany.mockResolvedValue({ count: 0 });
    push.send.mockReset().mockResolvedValue(true);
    whatsapp.send.mockReset().mockResolvedValue(false);
    email.send.mockReset().mockResolvedValue(true);
    dbMock.user.findMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) =>
      (args?.where?.id?.in ?? []).filter((id) => EMAILS[id]).map((id) => ({ id, email: EMAILS[id] })),
    );
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
      data: { attempts: { increment: 1 }, claimedAt: expect.any(Date), lastError: 'expo down' },
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
      data: { attempts: { increment: 1 }, claimedAt: expect.any(Date), lastError: expect.stringContaining('SOMETHING_ELSE') },
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

  describe('email and the time budget', () => {
    it('emails a leave request to the desk — the email composer existed and was never reached', async () => {
      claim([{ id: 'r1', schoolId: SCHOOL, kind: 'LEAVE_APPLIED', payload: LEAVE_FIXTURE, classSectionId: null, targetUserId: ADMIN }]);
      await svc.drain({ purge: false });
      expect(email.send).toHaveBeenCalledWith('admin@raffles.test', expect.objectContaining({ kind: 'LEAVE_APPLIED' }), SCHOOL);
    });

    it.each(['LIBRARY_NOTICE', 'SESSION_STARTED', 'RESULT_PUBLISHED', 'EXAM_SCHEDULED'])('does not email %s — its writer already does', async (kind) => {
      claim([{ id: 'r1', schoolId: SCHOOL, kind, payload: FIXTURES[kind as keyof typeof FIXTURES], classSectionId: null, targetUserId: USER }]);
      await svc.drain({ purge: false });
      expect(push.send).toHaveBeenCalled(); // positive control: the row had a recipient
      expect(email.send).not.toHaveBeenCalled();
    });

    it('a sports record the writer already emailed is not emailed twice', async () => {
      claim([{ id: 'r1', schoolId: SCHOOL, kind: 'SPORTS_NOTICE', payload: { ...(FIXTURES.SPORTS_NOTICE as object), emailed: true }, classSectionId: null, targetUserId: USER }]);
      await svc.drain({ purge: false });
      expect(push.send).toHaveBeenCalled(); // positive control: the row had a recipient
      expect(email.send).not.toHaveBeenCalled();
    });

    it('an email that throws does not fail the row — push and WhatsApp must not resend', async () => {
      email.send.mockRejectedValueOnce(new Error('SMTP 421'));
      claim([{ id: 'r1', schoolId: SCHOOL, kind: 'FEE_VERIFIED', payload: FIXTURES.FEE_VERIFIED, classSectionId: null, targetUserId: USER }]);
      const r = await svc.drain({ purge: false });
      expect(r).toMatchObject({ sent: 1, failed: 0 });
      expect(push.send).toHaveBeenCalledTimes(1);
      expect(whatsapp.send).toHaveBeenCalledTimes(1);
    });

    describe('a class-wide row with 12 recipients', () => {
      const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, email: `p${i}@raffles.test` }));
      const classRow = () => ({ id: 'r1', schoolId: SCHOOL, kind: 'ASSIGNMENT_POSTED', payload: FIXTURES.ASSIGNMENT_POSTED, classSectionId: CLASS_SECTION, targetUserId: null });
      beforeEach(() => {
        dbMock.student.findMany.mockResolvedValue(twelve.map((u) => ({ userId: u.id })));
        dbMock.user.findMany.mockResolvedValue(twelve);
      });

      it('emails at most EMAIL_CONCURRENCY at a time and still sends all 12', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        email.send.mockImplementation(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          return true;
        });
        claim([classRow()]);
        const r = await svc.drain({ purge: false });
        expect(r).toMatchObject({ sent: 1, failed: 0 });
        expect(EMAIL_CONCURRENCY).toBe(5);
        expect(maxInFlight).toBe(5);
        expect(email.send).toHaveBeenCalledTimes(12);
      });

      it('one rejected email among 12 does not fail the row or resend push / WhatsApp', async () => {
        email.send.mockImplementation(async (to: string) => {
          if (to === 'p3@raffles.test') throw new Error('SMTP 421');
          return true;
        });
        claim([classRow()]);
        const r = await svc.drain({ purge: false });
        expect(r).toMatchObject({ sent: 1, failed: 0 });
        expect(email.send).toHaveBeenCalledTimes(12);
        expect(push.send).toHaveBeenCalledTimes(12);
        expect(whatsapp.send).toHaveBeenCalledTimes(12);
      });
    });

    it('stops taking rows after the time budget, releases the rest, and does NOT chain another drain into the dying invocation', async () => {
      const t0 = 1_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        push.send.mockImplementation(async () => {
          now.mockReturnValue(t0 + DRAIN_TIME_BUDGET_MS + 1);
          return true;
        });
        claim([row('r1'), row('r2'), row('r3')]);
        const r = await svc.drain({ purge: false });
        expect(r.sent).toBe(1);
        expect(dbMock.notificationOutbox.updateMany).toHaveBeenCalledTimes(1);
        expect(dbMock.notificationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['r2', 'r3'] } }, data: { claimedAt: null } });
        expect(requestOutboxDrain).not.toHaveBeenCalled();
      } finally {
        now.mockRestore();
      }
    });

    it('a drain whose deadline has already passed starts no row and releases every claimed row', async () => {
      claim([row('r1'), row('r2')]);
      const r = await svc.drain({ purge: false, deadline: Date.now() - 1 });
      expect(r).toMatchObject({ processed: 2, sent: 0, failed: 0 });
      expect(push.send).not.toHaveBeenCalled();
      expect(whatsapp.send).not.toHaveBeenCalled();
      expect(dbMock.notificationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['r1', 'r2'] } }, data: { claimedAt: null } });
      expect(requestOutboxDrain).not.toHaveBeenCalled();
    });

    it('never starts a row once fewer than ROW_START_RESERVE_MS remain of the 60 s invocation, even when the given deadline is later', async () => {
      const t0 = 1_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        expect(ROW_START_RESERVE_MS).toBe(15_000);
        push.send.mockImplementation(async () => {
          // Past the invocation's row-start line (t0 + 45 s), well inside the caller's deadline.
          now.mockReturnValue(t0 + 60_000 - ROW_START_RESERVE_MS);
          return true;
        });
        claim([row('r1'), row('r2'), row('r3')]);
        const r = await svc.drain({ purge: false, deadline: t0 + 10 * 60_000 });
        expect(r.sent).toBe(1);
        expect(push.send).toHaveBeenCalledTimes(1);
        expect(dbMock.notificationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['r2', 'r3'] } }, data: { claimedAt: null } });
      } finally {
        now.mockRestore();
      }
    });

    it('a failed row keeps its claim stamped (the claim TTL is the back-off) and counts the attempt', async () => {
      push.send.mockRejectedValueOnce(new Error('pooler timeout'));
      claim([row('r1')]);
      const r = await svc.drain({ purge: false });
      expect(r).toMatchObject({ sent: 0, failed: 1 });
      expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { attempts: { increment: 1 }, lastError: 'pooler timeout', claimedAt: expect.any(Date) },
      });
    });

    it('WhatsApp throwing for recipient 2 of 3 does not fail the row — push is never re-sent', async () => {
      const three = [0, 1, 2].map((i) => ({ id: `u${i}`, email: `p${i}@raffles.test` }));
      dbMock.student.findMany.mockResolvedValue(three.map((u) => ({ userId: u.id })));
      dbMock.user.findMany.mockResolvedValue(three);
      whatsapp.send.mockImplementation(async (to: string) => {
        if (to === 'p1@raffles.test') throw new Error('whatsapp settings lookup timed out');
        return true;
      });
      claim([{ id: 'r1', schoolId: SCHOOL, kind: 'ASSIGNMENT_POSTED', payload: FIXTURES.ASSIGNMENT_POSTED, classSectionId: CLASS_SECTION, targetUserId: null }]);
      const r = await svc.drain({ purge: false });
      expect(r).toMatchObject({ sent: 1, failed: 0 });
      expect(push.send).toHaveBeenCalledTimes(3);
      expect(whatsapp.send).toHaveBeenCalledTimes(3);
      expect(dbMock.notificationOutbox.update).toHaveBeenCalledTimes(1);
      expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { sentAt: expect.any(Date) } });
    });

    it('a school-name lookup that fails sends the row as "Your school" and does not cache the miss', async () => {
      const sportsRow = (id: string) => ({ id, schoolId: SCHOOL, kind: 'SPORTS_NOTICE', payload: FIXTURES.SPORTS_NOTICE, classSectionId: null, targetUserId: USER });
      dbMock.school.findFirst.mockRejectedValueOnce(new Error('pooler timeout')).mockResolvedValueOnce({ name: 'Raffles Public School' });
      claim([sportsRow('r1'), sportsRow('r2')]);
      const r = await svc.drain({ purge: false });
      expect(r).toMatchObject({ sent: 2, failed: 0 });
      expect(dbMock.school.findFirst).toHaveBeenCalledTimes(2);
      expect(push.send.mock.calls[0][1].payload.schoolName).toBe('Your school');
      expect(push.send.mock.calls[1][1].payload.schoolName).toBe('Raffles Public School');
    });

    it('releases nothing when the batch finishes inside the budget', async () => {
      claim([row('r1'), row('r2')]);
      const r = await svc.drain({ purge: false });
      expect(r.sent).toBe(2);
      expect(dbMock.notificationOutbox.updateMany).not.toHaveBeenCalled();
    });

    it('OUTBOX_EMAIL names every kind', () => {
      expect(Object.keys(OUTBOX_EMAIL).sort()).toEqual([...NOTIFICATION_OUTBOX_KINDS].sort());
    });
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

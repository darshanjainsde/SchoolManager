const dbMock = {
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  notificationOutbox: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  notificationDelivery: { createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  student: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  school: { findFirst: jest.fn() },
};

jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => dbMock }));

// The real signal, with `requestOutboxDrain` wrapped so a test can assert the
// drain did NOT chain another drain onto its own (dying) invocation.
jest.mock('../../common/notifications/outbox-signal', () => {
  const actual = jest.requireActual('../../common/notifications/outbox-signal');
  return { ...actual, requestOutboxDrain: jest.fn((...a: unknown[]) => actual.requestOutboxDrain(...a)) };
});

import { Logger } from '@nestjs/common';
import { Prisma } from '@skoolos/db';
import { NOTIFICATION_OUTBOX_KINDS } from '@skoolos/types';
import {
  DELIVERY_BACKOFF_MS,
  DELIVERY_BATCH_CAP,
  DELIVERY_CONCURRENCY,
  DELIVERY_PER_SCHOOL_CAP,
  HARD_STOP_MARGIN_MS,
  NotificationOutboxService,
  OUTBOX_EMAIL,
  ROW_START_RESERVE_MS,
} from './notification-outbox.service';
import { FIXTURES } from './notification-outbox.fixtures';
import { OUTBOX_DRAIN_DELAY_MS, requestOutboxDrain, resetOutboxSignal } from '../../common/notifications/outbox-signal';
import { runInvocation } from '../../common/notifications/invocation-clock';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_SCHOOL = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const CLASS_SECTION = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const USERS: Record<string, string> = { 'u-1': 'p1@raffles.test', 'u-2': 'p2@raffles.test', 'u-admin': 'head@raffles.test' };

let outboxClaim: unknown[] = [];
let deliveryClaim: unknown[] = [];
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?');

// The stamp the delivery claim wrote and read back (RETURNING "claimedAt").
const CLAIMED_AT = new Date('2026-10-06T09:00:00.000Z');
type UpdateManyArg = { where: { id: string | { in: string[] }; claimedAt?: Date } };
// Status writes carry the claim stamp; releases are by id list.
const recorded = () => dbMock.notificationDelivery.updateMany.mock.calls.filter((c) => (c[0] as UpdateManyArg).where.claimedAt !== undefined);
const released = () => dbMock.notificationDelivery.updateMany.mock.calls.filter((c) => (c[0] as UpdateManyArg).where.claimedAt === undefined);

const outboxRow = (o: Partial<{ id: string; kind: string; payload: unknown; classSectionId: string | null; targetUserId: string | null }> = {}) => ({
  id: 'r1', schoolId: SCHOOL, kind: 'ASSIGNMENT_POSTED', payload: FIXTURES.ASSIGNMENT_POSTED, classSectionId: CLASS_SECTION, targetUserId: null, ...o,
});
const delivery = (id: string, channel: 'EMAIL' | 'PUSH' | 'WHATSAPP', o: Partial<{ attempts: number; userId: string; outboxId: string; schoolId: string }> = {}) => ({
  id, schoolId: SCHOOL, outboxId: 'r1', userId: 'u-1', channel, attempts: 0, claimedAt: CLAIMED_AT, ...o,
});
const summary = (o: Partial<{ id: string; kind: string; payload: unknown; schoolId: string }> = {}) => ({
  id: 'r1', schoolId: SCHOOL, kind: 'ASSIGNMENT_POSTED', payload: FIXTURES.ASSIGNMENT_POSTED, ...o,
});

describe('NotificationOutboxService.drain', () => {
  const push = { attempt: jest.fn() };
  const whatsapp = { attempt: jest.fn() };
  const email = { attempt: jest.fn() };
  const svc = new NotificationOutboxService(push as never, whatsapp as never, email as never);

  beforeEach(() => {
    jest.clearAllMocks();
    outboxClaim = [];
    deliveryClaim = [];
    dbMock.$queryRaw.mockImplementation(async (strings: string[]) => (strings.join('?').includes('UPDATE "NotificationDelivery"') ? deliveryClaim : outboxClaim));
    dbMock.$executeRaw.mockResolvedValue(0);
    dbMock.notificationOutbox.update.mockResolvedValue({});
    dbMock.notificationOutbox.updateMany.mockResolvedValue({ count: 0 });
    dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.notificationOutbox.findMany.mockResolvedValue([summary()]);
    dbMock.notificationDelivery.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
    dbMock.notificationDelivery.updateMany.mockResolvedValue({ count: 1 });
    dbMock.student.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }]);
    dbMock.user.findMany.mockImplementation(async (a: { where: { id: { in: string[] }; schoolId: string } }) =>
      a.where.schoolId === SCHOOL ? a.where.id.in.filter((id) => USERS[id]).map((id) => ({ id, email: USERS[id] })) : [],
    );
    dbMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School' });
    for (const c of [push, whatsapp, email]) c.attempt.mockReset().mockResolvedValue({ status: 'SENT' });
  });

  describe('expansion', () => {
    it('claims only unexpanded rows, and binds the attempt cap, stale cutoff and batch cap', async () => {
      await svc.drain({ purge: false });
      const call = dbMock.$queryRaw.mock.calls.find((c) => sqlOf(c).includes('UPDATE "NotificationOutbox"'))!;
      const sql = sqlOf(call);
      expect(sql).toMatch(/"expandedAt" IS NULL/);
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(call.slice(1)).toEqual([expect.any(Date), 5, expect.any(Date), 200]);
    });

    it('a full outbox claim says there is more', async () => {
      outboxClaim = Array.from({ length: 200 }, (_, i) => outboxRow({ id: `r${i}`, classSectionId: null, targetUserId: null }));
      await expect(svc.drain({ purge: false })).resolves.toMatchObject({ processed: 200, more: true });
    });

    it('expansion stopped by the deadline releases the rows it did not reach, says more, and claims no delivery', async () => {
      const t0 = 1_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        outboxClaim = [outboxRow({ id: 'r1' }), outboxRow({ id: 'r2' }), outboxRow({ id: 'r3' })];
        dbMock.notificationDelivery.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => {
          now.mockReturnValue(t0 + 60_000);
          return { count: data.length };
        });
        const r = await svc.drain({ purge: false });
        expect(dbMock.notificationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['r2', 'r3'] } }, data: { claimedAt: null } });
        expect(dbMock.$queryRaw.mock.calls.some((c) => sqlOf(c).includes('UPDATE "NotificationDelivery"'))).toBe(false);
        expect(r).toMatchObject({ processed: 3, more: true });
      } finally {
        now.mockRestore();
      }
    });

    it('a class row becomes one delivery per person per channel, email included where the writer does not email', async () => {
      outboxClaim = [outboxRow()];
      const r = await svc.drain({ purge: false });
      const { data, skipDuplicates } = dbMock.notificationDelivery.createMany.mock.calls[0][0];
      expect(skipDuplicates).toBe(true);
      expect(data).toHaveLength(6);
      expect(data).toContainEqual({ schoolId: SCHOOL, outboxId: 'r1', userId: 'u-2', channel: 'EMAIL' });
      expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({ where: { id: 'r1', schoolId: SCHOOL }, data: { expandedAt: expect.any(Date), claimedAt: null } });
      expect(r).toMatchObject({ processed: 1, expanded: 6 });
    });

    it('a row whose writer already emails gets no EMAIL delivery', async () => {
      outboxClaim = [outboxRow({ kind: 'EXAM_SCHEDULED', payload: FIXTURES.EXAM_SCHEDULED })];
      await svc.drain({ purge: false });
      const channels = dbMock.notificationDelivery.createMany.mock.calls[0][0].data.map((d: { channel: string }) => d.channel);
      expect(new Set(channels)).toEqual(new Set(['PUSH', 'WHATSAPP']));
    });

    it('an unknown kind fails expansion: attempt counted, claim stamped as the back-off, nothing created', async () => {
      outboxClaim = [outboxRow({ kind: 'SOMETHING_ELSE' })];
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.createMany).not.toHaveBeenCalled();
      expect(dbMock.notificationOutbox.update).toHaveBeenCalledWith({
        where: { id: 'r1', schoolId: SCHOOL },
        data: { attempts: { increment: 1 }, lastError: expect.stringContaining('SOMETHING_ELSE'), claimedAt: expect.any(Date) },
      });
      expect(r.failed).toBe(1);
    });

    it('nobody to tell: no deliveries, and the close step marks the row sent', async () => {
      outboxClaim = [outboxRow()];
      dbMock.student.findMany.mockResolvedValue([]);
      dbMock.$executeRaw.mockResolvedValue(1);
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.createMany).not.toHaveBeenCalled();
      const close = sqlOf(dbMock.$executeRaw.mock.calls[0]);
      expect(close).toMatch(/SET "sentAt" = \(\?::timestamptz AT TIME ZONE 'UTC'\)/);
      expect(close).toMatch(/"expandedAt" IS NOT NULL/);
      expect(close).toMatch(/NOT EXISTS[\s\S]*d\."schoolId" = o\."schoolId"[\s\S]*status IN \('QUEUED', 'HELD'\)/);
      expect(r.closed).toBe(1);
    });

    it('a row parked at MAX_ATTEMPTS with its deliveries written is still closed once they end (its expandedAt write kept failing)', async () => {
      await svc.drain({ purge: false });
      const call = dbMock.$executeRaw.mock.calls[0];
      const close = sqlOf(call);
      expect(close).toMatch(/"expandedAt" IS NOT NULL\s+OR \(\s+o\.attempts >= \?\s+AND EXISTS \(SELECT 1 FROM "NotificationDelivery" e WHERE e\."outboxId" = o\.id AND e\."schoolId" = o\."schoolId"\)/);
      expect(call.slice(1)).toEqual([expect.any(Date), 5]);
      // Closing stamps sentAt — the one column the retention sweep reads — so
      // the parked row is purged on the ordinary 30-day rule.
      dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 1 });
      await expect(svc.drain()).resolves.toMatchObject({ purged: 1 });
      expect(Object.keys(dbMock.notificationOutbox.deleteMany.mock.calls[0][0].where)).toEqual(['sentAt']);
    });
  });

  describe('sending', () => {
    it('claims due QUEUED/HELD deliveries, soonest first, skipping ones another drain holds', async () => {
      await svc.drain({ purge: false });
      const sql = sqlOf(dbMock.$queryRaw.mock.calls.find((c) => sqlOf(c).includes('UPDATE "NotificationDelivery"'))!);
      expect(sql).toMatch(/status IN \('QUEUED', 'HELD'\)/);
      expect(sql).toMatch(/"nextAttemptAt" <= \(\?::timestamptz AT TIME ZONE 'UTC'\)/);
      expect(sql).toMatch(/ORDER BY "nextAttemptAt" ASC/);
      expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
    });

    it('is fair across schools: each school is numbered by due time, capped per drain, and the schools interleaved', async () => {
      await svc.drain({ purge: false });
      const call = dbMock.$queryRaw.mock.calls.find((c) => sqlOf(c).includes('UPDATE "NotificationDelivery"'))!;
      const sql = sqlOf(call);
      expect(sql).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY "schoolId" ORDER BY "nextAttemptAt" ASC, id ASC\) AS rn/);
      expect(sql).toMatch(/WHERE rn <= \?\s+ORDER BY rn ASC, "nextAttemptAt" ASC\s+LIMIT \?/);
      // The lock is on a plain table SELECT, never beside the window function.
      expect(sql).toMatch(/SELECT id FROM "NotificationDelivery"\s+WHERE id IN \(SELECT id FROM picked\)[\s\S]*FOR UPDATE SKIP LOCKED/);
      expect(call.slice(1)).toEqual([expect.any(Date), expect.any(Date), DELIVERY_PER_SCHOOL_CAP, DELIVERY_BATCH_CAP, expect.any(Date), expect.any(Date)]);
      expect(DELIVERY_PER_SCHOOL_CAP).toBe(60);
    });

    it("compares claim and due times in JS time, never the database's now()", async () => {
      outboxClaim = [outboxRow()];
      await svc.drain({ purge: false });
      const calls = [...dbMock.$queryRaw.mock.calls, ...dbMock.$executeRaw.mock.calls];
      expect(calls.length).toBeGreaterThanOrEqual(3);
      let dates = 0;
      for (const call of calls) {
        expect(sqlOf(call)).not.toMatch(/now\(\)/i);
        // Prisma binds a Date as timestamptz and the columns are timestamp
        // (UTC wall-clock): every bound time must be cast, or the session
        // time zone shifts it.
        const strings = call[0] as string[];
        call.slice(1).forEach((v: unknown, k: number) => {
          if (v instanceof Date) {
            dates += 1;
            expect(strings[k + 1].startsWith("::timestamptz AT TIME ZONE 'UTC')")).toBe(true);
          }
        });
      }
      expect(dates).toBe(7);
    });

    it('one school at its per-drain cap says there is more', async () => {
      deliveryClaim = Array.from({ length: DELIVERY_PER_SCHOOL_CAP }, (_, i) => delivery(`d${i}`, 'PUSH'));
      await expect(svc.drain({ purge: false })).resolves.toMatchObject({ sent: DELIVERY_PER_SCHOOL_CAP, more: true });
    });

    it('a claim below every cap says there is no more', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'PUSH', { schoolId: OTHER_SCHOOL })];
      await expect(svc.drain({ purge: false })).resolves.toMatchObject({ more: false });
    });

    it('a failed lookup after the claim releases the whole batch and counts no attempt', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'EMAIL')];
      dbMock.notificationOutbox.findMany.mockRejectedValue(new Error('pooler timeout'));
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['d1', 'd2'] } }, data: { claimedAt: null } });
      expect(recorded()).toHaveLength(0);
      expect(push.attempt).not.toHaveBeenCalled();
      expect(r).toMatchObject({ sent: 0, failed: 0, retried: 0, more: false });
    });

    it('a failed lookup after a FULL claim releases it and says more: false, so the workflow does not hammer an outage', async () => {
      deliveryClaim = Array.from({ length: DELIVERY_BATCH_CAP }, (_, i) => delivery(`d${i}`, 'PUSH'));
      dbMock.notificationOutbox.findMany.mockRejectedValue(new Error('pooler timeout'));
      const r = await svc.drain({ purge: false });
      expect(released()).toHaveLength(1);
      expect(push.attempt).not.toHaveBeenCalled();
      expect(r.more).toBe(false);
    });

    it('sends each delivery through its own channel and records SENT with the provider id', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'WHATSAPP'), delivery('d3', 'EMAIL')];
      whatsapp.attempt.mockResolvedValue({ status: 'SENT', providerId: 'wamid.1' });
      const r = await svc.drain({ purge: false });
      expect(push.attempt).toHaveBeenCalledWith('p1@raffles.test', expect.objectContaining({ kind: 'ANNOUNCEMENT' }), SCHOOL);
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: 'd2', schoolId: SCHOOL, claimedAt: CLAIMED_AT },
        data: { status: 'SENT', sentAt: expect.any(Date), providerId: 'wamid.1', attempts: 1, error: null, claimedAt: null },
      });
      expect(r).toMatchObject({ sent: 3, failed: 0, retried: 0 });
    });

    it('a transient failure (Meta 130429) is one row retried on the backoff — 1 m, 5 m, 30 m, 2 h, 12 h — then FAILED', async () => {
      const t0 = 1_700_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        whatsapp.attempt.mockResolvedValue({ status: 'RETRY', error: 'rate limited (code 130429)' });
        for (let failures = 0; failures < DELIVERY_BACKOFF_MS.length; failures += 1) {
          dbMock.notificationDelivery.updateMany.mockClear();
          deliveryClaim = [delivery('d1', 'WHATSAPP', { attempts: failures })];
          await svc.drain({ purge: false });
          expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({
            where: { id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT },
            data: { status: 'QUEUED', attempts: failures + 1, error: 'rate limited (code 130429)', nextAttemptAt: new Date(t0 + DELIVERY_BACKOFF_MS[failures]), claimedAt: null },
          });
        }
        expect(DELIVERY_BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
        dbMock.notificationDelivery.updateMany.mockClear();
        deliveryClaim = [delivery('d1', 'WHATSAPP', { attempts: 5 })];
        await svc.drain({ purge: false });
        expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT }, data: { status: 'FAILED', attempts: 6, error: 'rate limited (code 130429)', claimedAt: null } });
        // Push and email for the same parent were never part of this: one row, not five.
        expect(push.attempt).not.toHaveBeenCalled();
        expect(email.attempt).not.toHaveBeenCalled();
      } finally {
        now.mockRestore();
      }
    });

    it('a permanent failure is FAILED at once', async () => {
      deliveryClaim = [delivery('d1', 'WHATSAPP')];
      whatsapp.attempt.mockResolvedValue({ status: 'FAILED', error: 'not on WhatsApp (code 131026)' });
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT }, data: { status: 'FAILED', attempts: 1, error: 'not on WhatsApp (code 131026)', claimedAt: null } });
      expect(r.failed).toBe(1);
    });

    it('SKIPPED and SUPPRESSED record their reason and end the delivery', async () => {
      deliveryClaim = [delivery('d1', 'WHATSAPP'), delivery('d2', 'EMAIL')];
      whatsapp.attempt.mockResolvedValue({ status: 'SKIPPED', reason: 'channel-off' });
      email.attempt.mockResolvedValue({ status: 'SUPPRESSED', reason: 'BOUNCE: hard' });
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT }, data: { status: 'SKIPPED', reason: 'channel-off', claimedAt: null } });
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: 'd2', schoolId: SCHOOL, claimedAt: CLAIMED_AT }, data: { status: 'SUPPRESSED', reason: 'BOUNCE: hard', claimedAt: null } });
      expect(r.skipped).toBe(2);
    });

    it('a channel that throws is a retry for that delivery, never a crash of the batch', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'PUSH', { userId: 'u-2' })];
      push.attempt.mockRejectedValueOnce(new Error('pooler timeout')).mockResolvedValueOnce({ status: 'SENT' });
      const t0 = 1_700_000_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        const r = await svc.drain({ purge: false });
        expect(r).toMatchObject({ sent: 1, retried: 1, failed: 0 });
        // Scheduled exactly like a RETRY outcome: first backoff, one attempt counted.
        expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({
          where: { id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT },
          data: { status: 'QUEUED', attempts: 1, error: 'pooler timeout', nextAttemptAt: new Date(t0 + DELIVERY_BACKOFF_MS[0]), claimedAt: null },
        });
        expect(push.attempt).toHaveBeenCalledTimes(2);
      } finally {
        now.mockRestore();
      }
    });

    it('template-pending ends the WhatsApp delivery without burning an attempt; push and email for the row still go', async () => {
      deliveryClaim = [delivery('d1', 'WHATSAPP'), delivery('d2', 'PUSH'), delivery('d3', 'EMAIL')];
      whatsapp.attempt.mockResolvedValue({ status: 'SKIPPED', reason: 'template-pending' });
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT },
        data: { status: 'SKIPPED', reason: 'template-pending', claimedAt: null },
      });
      expect(r).toMatchObject({ sent: 2, skipped: 1, failed: 0, retried: 0 });
      expect(push.attempt).toHaveBeenCalledTimes(1);
      expect(email.attempt).toHaveBeenCalledTimes(1);
    });

    it('a login with no email any more is SKIPPED no-address', async () => {
      deliveryClaim = [delivery('d1', 'PUSH', { userId: 'u-gone' })];
      await svc.drain({ purge: false });
      expect(push.attempt).not.toHaveBeenCalled();
      expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT }, data: { status: 'SKIPPED', reason: 'no-address', claimedAt: null } });
    });

    it('never sends a delivery whose outbox row belongs to another school', async () => {
      deliveryClaim = [delivery('d1', 'PUSH')];
      dbMock.notificationOutbox.findMany.mockResolvedValue([summary({ schoolId: OTHER_SCHOOL })]);
      await svc.drain({ purge: false });
      expect(push.attempt).not.toHaveBeenCalled();
      expect(dbMock.notificationDelivery.updateMany.mock.calls[0][0].data.status).toBe('FAILED');
    });

    it('looks logins up with the school in the where — the platform client bypasses RLS', async () => {
      deliveryClaim = [delivery('d1', 'PUSH')];
      await svc.drain({ purge: false });
      expect(dbMock.user.findMany.mock.calls.at(-1)[0]).toEqual({ where: { schoolId: SCHOOL, id: { in: ['u-1'] } }, select: { id: true, email: true } });
    });

    it('renders a row once and signs the leave buttons at send time, not on the row', async () => {
      deliveryClaim = [delivery('d1', 'WHATSAPP', { userId: 'u-admin' }), delivery('d2', 'EMAIL', { userId: 'u-admin' })];
      dbMock.notificationOutbox.findMany.mockResolvedValue([summary({ kind: 'LEAVE_APPLIED', payload: FIXTURES.LEAVE_APPLIED })]);
      await svc.drain({ purge: false });
      const message = whatsapp.attempt.mock.calls[0][1];
      expect(message.kind).toBe('LEAVE_APPLIED');
      expect(message.payload.approvePayload).toMatch(/^v2:lv:a:/);
      expect(email.attempt.mock.calls[0][1]).toBe(message);
    });

    it('sends at most DELIVERY_CONCURRENCY at a time', async () => {
      deliveryClaim = Array.from({ length: 12 }, (_, i) => delivery(`d${i}`, 'EMAIL'));
      let inFlight = 0;
      let peak = 0;
      email.attempt.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return { status: 'SENT' };
      });
      await svc.drain({ purge: false });
      expect(DELIVERY_CONCURRENCY).toBe(5);
      expect(peak).toBe(5);
      expect(email.attempt).toHaveBeenCalledTimes(12);
    });
  });

  describe('what a crash can and cannot repeat (Tier 0 residual a)', () => {
    it('a failed close (sentAt) write re-sends nothing: the next drain finds no row to expand and no delivery due', async () => {
      outboxClaim = [outboxRow({ classSectionId: null, targetUserId: 'u-1' })];
      deliveryClaim = [delivery('d1', 'PUSH')];
      dbMock.$executeRaw.mockRejectedValueOnce(new Error('pooler timeout'));
      await expect(svc.drain({ purge: false })).resolves.toMatchObject({ sent: 1, closed: 0 });
      expect(push.attempt).toHaveBeenCalledTimes(1);

      // Next drain: the row was stamped expandedAt (never re-expanded) and the
      // delivery is SENT (never re-claimed). The close simply runs again.
      outboxClaim = [];
      deliveryClaim = [];
      await svc.drain({ purge: false });
      expect(push.attempt).toHaveBeenCalledTimes(1);
    });

    it('a failed status write leaves only THAT delivery to the 5-minute claim TTL; the batch carries on', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'PUSH', { userId: 'u-2' })];
      dbMock.notificationDelivery.updateMany.mockRejectedValueOnce(new Error('pooler timeout')).mockResolvedValueOnce({ count: 1 });
      await expect(svc.drain({ purge: false })).resolves.toMatchObject({ sent: 2 });
      expect(push.attempt).toHaveBeenCalledTimes(2);
      expect(released()).toHaveLength(0);
    });
  });

  describe('a late-finishing send cannot overwrite a newer drain', () => {
    it('the status write matches the claimedAt this drain stamped, read back from the claim', async () => {
      deliveryClaim = [delivery('d1', 'PUSH')];
      await svc.drain({ purge: false });
      expect(recorded()).toHaveLength(1);
      expect((recorded()[0][0] as UpdateManyArg).where).toEqual({ id: 'd1', schoolId: SCHOOL, claimedAt: CLAIMED_AT });
      expect(sqlOf(dbMock.$queryRaw.mock.calls.find((c) => sqlOf(c).includes('UPDATE "NotificationDelivery"'))!)).toMatch(/RETURNING[^;]*"claimedAt"/);
    });

    it('when a newer drain has re-claimed the row the write matches nothing: it is logged and skipped, the batch carries on', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'PUSH', { userId: 'u-2' })];
        dbMock.notificationDelivery.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
        await expect(svc.drain({ purge: false })).resolves.toMatchObject({ sent: 2 });
        expect(recorded()).toHaveLength(2);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Delivery d1'));
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe('deploy before migrate (the code ships before the owner runs the migration)', () => {
    const missing = (sqlState: '42P01' | '42703', what: string) =>
      new Prisma.PrismaClientKnownRequestError(`Raw query failed. Code: \`${sqlState}\`. Message: \`${what} does not exist\``, {
        code: 'P2010',
        clientVersion: '5.22.0',
        meta: { code: sqlState, message: `${what} does not exist` },
      });

    it('no expandedAt column (42703): the drain logs once, returns quietly, and touches no row', async () => {
      const fresh = new NotificationOutboxService(push as never, whatsapp as never, email as never);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        dbMock.$queryRaw.mockRejectedValue(missing('42703', 'column "expandedAt"'));
        const first = await fresh.drain();
        const second = await fresh.drain();
        expect(first).toEqual({ processed: 0, expanded: 0, sent: 0, failed: 0, retried: 0, skipped: 0, closed: 0, purged: 0, more: false });
        expect(second).toEqual(first);
        expect(warn.mock.calls.filter((c) => String(c[0]).includes('migration'))).toHaveLength(1);
        expect(dbMock.notificationOutbox.update).not.toHaveBeenCalled();
        expect(dbMock.notificationOutbox.updateMany).not.toHaveBeenCalled();
        expect(dbMock.notificationOutbox.deleteMany).not.toHaveBeenCalled();
        expect(dbMock.$executeRaw).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('no NotificationDelivery table (42P01 / P2021): claimed rows are released, no attempt is burned, nothing is sent', async () => {
      const fresh = new NotificationOutboxService(push as never, whatsapp as never, email as never);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        outboxClaim = [outboxRow(), outboxRow({ id: 'r2' })];
        dbMock.notificationDelivery.createMany.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('The table `public.NotificationDelivery` does not exist in the current database.', { code: 'P2021', clientVersion: '5.22.0' }),
        );
        const r = await fresh.drain();
        expect(r).toMatchObject({ failed: 0, sent: 0, purged: 0 });
        expect(dbMock.notificationOutbox.update).not.toHaveBeenCalled();
        expect(dbMock.notificationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['r1', 'r2'] } }, data: { claimedAt: null } });
        expect(push.attempt).not.toHaveBeenCalled();
        const migrationWarnings = () => warn.mock.calls.filter((c) => String(c[0]).includes('migration')).length;
        expect(migrationWarnings()).toBe(1);

        // The delivery claim itself on a missing table is the same quiet return,
        // and the warning is not repeated.
        jest.clearAllMocks();
        outboxClaim = [];
        dbMock.$queryRaw.mockImplementation(async (strings: string[]) => {
          if (strings.join('?').includes('UPDATE "NotificationDelivery"')) throw missing('42P01', 'relation "NotificationDelivery"');
          return [];
        });
        await expect(fresh.drain({ purge: false })).resolves.toMatchObject({ sent: 0, failed: 0 });
        expect(dbMock.$executeRaw).not.toHaveBeenCalled();
        expect(migrationWarnings()).toBe(0);
      } finally {
        warn.mockRestore();
      }
    });

    it('any other claim failure still surfaces', async () => {
      dbMock.$queryRaw.mockRejectedValue(new Error('pooler timeout'));
      await expect(svc.drain({ purge: false })).rejects.toThrow('pooler timeout');
    });
  });

  describe('the time budget', () => {
    it('a drain whose deadline has passed claims no delivery at all, says more, and does not chain a drain', async () => {
      deliveryClaim = [delivery('d1', 'PUSH'), delivery('d2', 'EMAIL')];
      const r = await svc.drain({ purge: false, deadline: Date.now() - 1 });
      expect(push.attempt).not.toHaveBeenCalled();
      expect(dbMock.$queryRaw.mock.calls.some((c) => sqlOf(c).includes('UPDATE "NotificationDelivery"'))).toBe(false);
      expect(dbMock.notificationDelivery.updateMany).not.toHaveBeenCalled();
      expect(r.more).toBe(true);
      expect(requestOutboxDrain).not.toHaveBeenCalled();
    });

    it('the 60 s counts from the INVOCATION: a drain begun 30 s into one abandons a hung send 30 s sooner', async () => {
      jest.useFakeTimers();
      try {
        deliveryClaim = Array.from({ length: DELIVERY_CONCURRENCY + 2 }, (_, i) => delivery(`d${i}`, 'PUSH'));
        push.attempt.mockImplementation(() => new Promise(() => undefined));
        let settled = false;
        const run = runInvocation(() => svc.drain({ purge: false, deadline: Date.now() + 10 * 60_000 }), Date.now() - 30_000).then((r) => {
          settled = true;
          return r;
        });
        await jest.advanceTimersByTimeAsync(30_000 - HARD_STOP_MARGIN_MS - 1_000);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1_000);
        const r = await run;
        expect(settled).toBe(true);
        expect(r.more).toBe(true);
        expect(released()).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a hung send is abandoned at the hard stop: unstarted deliveries are released, the hung ones keep their claim', async () => {
      jest.useFakeTimers();
      try {
        deliveryClaim = Array.from({ length: DELIVERY_CONCURRENCY + 2 }, (_, i) => delivery(`d${i}`, 'PUSH'));
        push.attempt.mockImplementation(() => new Promise(() => undefined)); // never settles
        let settled = false;
        const run = svc.drain({ purge: false }).then((r) => {
          settled = true;
          return r;
        });
        await jest.advanceTimersByTimeAsync(60_000 - HARD_STOP_MARGIN_MS - 1_000);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1_000);
        const r = await run;
        expect(push.attempt).toHaveBeenCalledTimes(DELIVERY_CONCURRENCY);
        expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledTimes(1);
        expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['d5', 'd6'] } }, data: { claimedAt: null } });
        expect(recorded()).toHaveLength(0);
        expect(r.more).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('never starts a chunk once fewer than ROW_START_RESERVE_MS remain of the 60 s invocation, whatever deadline is passed', async () => {
      const t0 = 1_000_000;
      const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        deliveryClaim = Array.from({ length: DELIVERY_CONCURRENCY + 2 }, (_, i) => delivery(`d${i}`, 'PUSH'));
        push.attempt.mockImplementation(async () => {
          now.mockReturnValue(t0 + 60_000 - ROW_START_RESERVE_MS);
          return { status: 'SENT' };
        });
        const r = await svc.drain({ purge: false, deadline: t0 + 10 * 60_000 });
        expect(push.attempt).toHaveBeenCalledTimes(DELIVERY_CONCURRENCY);
        expect(dbMock.notificationDelivery.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['d5', 'd6'] } }, data: { claimedAt: null } });
        // ...and the run says there is more, so the workflow calls again.
        expect(r.more).toBe(true);
      } finally {
        now.mockRestore();
      }
    });
  });

  it('a sports row with no school name is filled once per school, and a failed lookup sends as "Your school" without caching', async () => {
    deliveryClaim = [delivery('d1', 'PUSH', { outboxId: 's1' }), delivery('d2', 'PUSH', { outboxId: 's2' })];
    dbMock.notificationOutbox.findMany.mockResolvedValue([summary({ id: 's1', kind: 'SPORTS_NOTICE', payload: FIXTURES.SPORTS_NOTICE }), summary({ id: 's2', kind: 'SPORTS_NOTICE', payload: FIXTURES.SPORTS_NOTICE })]);
    dbMock.school.findFirst.mockRejectedValueOnce(new Error('pooler timeout')).mockResolvedValueOnce({ name: 'Raffles Public School' });
    await svc.drain({ purge: false });
    const names = push.attempt.mock.calls.map((c) => c[1].payload.schoolName).sort();
    expect(names).toEqual(['Raffles Public School', 'Your school']);
  });

  it('OUTBOX_EMAIL names every kind', () => {
    expect(Object.keys(OUTBOX_EMAIL).sort()).toEqual([...NOTIFICATION_OUTBOX_KINDS].sort());
  });

  describe('retention sweep', () => {
    it('the opportunistic path does not sweep', async () => {
      const r = await svc.drain({ purge: false });
      expect(dbMock.notificationOutbox.deleteMany).not.toHaveBeenCalled();
      expect(r.purged).toBe(0);
    });

    it('only ever deletes delivered rows, 30 days old, and reports how many', async () => {
      dbMock.notificationOutbox.deleteMany.mockResolvedValue({ count: 7 });
      const before = Date.now();
      const r = await svc.drain();
      const where = dbMock.notificationOutbox.deleteMany.mock.calls[0][0].where;
      expect(Object.keys(where)).toEqual(['sentAt']);
      expect((before - where.sentAt.lt.getTime()) / 86_400_000).toBeCloseTo(30, 3);
      expect(r.purged).toBe(7);
    });

    it('a failed sweep does not fail the drain', async () => {
      dbMock.notificationOutbox.deleteMany.mockRejectedValue(new Error('lock timeout'));
      await expect(svc.drain()).resolves.toMatchObject({ purged: 0 });
    });

    it('drainSoon never sweeps — it runs on the hot path of an ordinary request', async () => {
      jest.useFakeTimers();
      try {
        svc.onModuleInit();
        svc.drainSoon();
        await jest.advanceTimersByTimeAsync(OUTBOX_DRAIN_DELAY_MS);
        expect(dbMock.$queryRaw).toHaveBeenCalled();
        expect(dbMock.notificationOutbox.deleteMany).not.toHaveBeenCalled();
      } finally {
        resetOutboxSignal();
        jest.useRealTimers();
      }
    });
  });
});

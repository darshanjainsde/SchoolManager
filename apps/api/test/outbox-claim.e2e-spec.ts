/**
 * The REAL drain — `NotificationOutboxService.drain()` — against real Postgres.
 *
 * Until Tier 1 this file held a copy of the Tier-0 claim SQL and tested the
 * copy, so a change to the drain could never fail it. Claiming (SKIP LOCKED),
 * the claim TTL and the UTC-vs-session-time-zone casts are Postgres behaviour a
 * mock cannot show; only the real statements against a real database can.
 *
 * Every connection of this file's platform client runs with the session time
 * zone set to Asia/Kolkata (the `options` connection parameter, below) — the
 * zone that moved every back-off by 5 h 30 m when a bound Date was compared
 * without `::timestamptz AT TIME ZONE 'UTC'`.
 *
 * The drain is cross-tenant on purpose and sweeps every school, including rows
 * earlier suites left behind; the channels here are stubs that answer SENT for
 * those. Every assertion is scoped to THIS suite's school.
 */
const IST = 'Asia/Kolkata';
{
  const url = process.env.DATABASE_URL_PLATFORM ?? process.env.DATABASE_URL ?? '';
  // Must be set before the first getPlatformPrisma() of this file builds its client.
  process.env.DATABASE_URL_PLATFORM = `${url}${url.includes('?') ? '&' : '?'}options=-c%20timezone%3D${encodeURIComponent(IST)}`;
}

import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { NotificationOutboxService, type NotificationOutboxDrainResult } from '../src/modules/management/notification-outbox.service';
import type { DeliveryOutcome, NotificationMessage } from '../src/common/notifications/notification.types';

type ChannelName = 'PUSH' | 'WHATSAPP' | 'EMAIL';
interface Sent { channel: ChannelName; to: string; title: string }

describe('NotificationOutboxService.drain() on real Postgres (session time zone Asia/Kolkata)', () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let schoolId: string;
  /** Every attempt this suite's school received, by channel. */
  let sent: Sent[] = [];
  /** Emails whose WhatsApp attempt answers RETRY. */
  const retryOn = new Set<string>();

  const stub = (channel: ChannelName) => ({
    name: channel.toLowerCase(),
    send: async () => true,
    attempt: async (to: string, message: NotificationMessage, sid: string): Promise<DeliveryOutcome> => {
      // A few ms of "network" so two concurrent drains really overlap.
      await new Promise((r) => setTimeout(r, 5));
      if (sid !== schoolId) return { status: 'SENT' };
      sent.push({ channel, to, title: String((message.payload as { title?: unknown }).title ?? '') });
      if (channel === 'WHATSAPP' && retryOn.has(to)) return { status: 'RETRY', error: 'Meta 131000 (stub)' };
      return { status: 'SENT', providerId: `${channel}-stub` };
    },
  });
  const service = () => new NotificationOutboxService(stub('PUSH') as never, stub('WHATSAPP') as never, stub('EMAIL') as never);

  /** Drains until nothing is left to do — other suites' leftovers can fill a single drain's caps. */
  async function drainUntilQuiet(svc = service()): Promise<NotificationOutboxDrainResult[]> {
    const runs: NotificationOutboxDrainResult[] = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await svc.drain({ purge: false });
      runs.push(r);
      if (!r.more) break;
    }
    return runs;
  }

  async function user(tag: string): Promise<{ id: string; email: string }> {
    const email = `${tag}-${suffix}@outbox.test`;
    const u = await getPlatformPrisma().user.create({
      data: { schoolId, email, role: 'TEACHER', passwordHash: 'not-a-login' },
      select: { id: true, email: true },
    });
    return u;
  }

  /** A single-reader row the drain fans out to PUSH, WHATSAPP and EMAIL. */
  async function outboxFor(userId: string, title: string, extra: { attempts?: number } = {}): Promise<string> {
    const row = await getPlatformPrisma().notificationOutbox.create({
      data: { schoolId, kind: 'FEE_VERIFIED', targetUserId: userId, payload: { schoolName: 'Outbox School', title, body: 'Thank you.' }, ...extra },
      select: { id: true },
    });
    return row.id;
  }

  beforeAll(async () => {
    const school = await getPlatformPrisma().school.create({
      data: { slug: `outbox-drain-${suffix}`, name: 'Outbox Drain School', tier: 'PRO', status: 'LIVE' },
      select: { id: true },
    });
    schoolId = school.id;
  });

  beforeEach(() => {
    sent = [];
    retryOn.clear();
  });

  afterAll(async () => {
    const p = getPlatformPrisma();
    await p.notificationOutbox.deleteMany({ where: { schoolId } }); // deliveries cascade
    await p.user.deleteMany({ where: { schoolId } });
    await p.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await disconnectAll();
  });

  it('runs every connection in the Asia/Kolkata session time zone', async () => {
    const rows = await getPlatformPrisma().$queryRawUnsafe<Array<{ TimeZone: string }>>('SHOW TIME ZONE');
    expect(rows[0].TimeZone).toBe(IST);
  });

  it('(a) expands a row into three deliveries, sends each, and closes the row', async () => {
    const u = await user('a');
    const outboxId = await outboxFor(u.id, 'Payment confirmed (a)');

    await drainUntilQuiet();

    const p = getPlatformPrisma();
    const deliveries = await p.notificationDelivery.findMany({ where: { schoolId, outboxId }, orderBy: { channel: 'asc' } });
    expect(deliveries.map((d) => [d.channel, d.status, d.attempts])).toEqual([
      ['EMAIL', 'SENT', 1],
      ['PUSH', 'SENT', 1],
      ['WHATSAPP', 'SENT', 1],
    ]);
    expect(deliveries.every((d) => d.userId === u.id && d.providerId === `${d.channel}-stub` && d.claimedAt === null)).toBe(true);
    const row = await p.notificationOutbox.findFirstOrThrow({ where: { id: outboxId, schoolId } });
    expect(row.expandedAt).not.toBeNull();
    expect(row.sentAt).not.toBeNull();
    expect(sent.filter((s) => s.to === u.email).map((s) => s.channel).sort()).toEqual(['EMAIL', 'PUSH', 'WHATSAPP']);
  });

  it('(b) a RETRY waits ~60 s — not 5 h 30 m early or late — even in an IST session', async () => {
    const u = await user('b');
    retryOn.add(u.email);
    const outboxId = await outboxFor(u.id, 'Payment confirmed (b)');

    const before = Date.now();
    await drainUntilQuiet();
    const after = Date.now();

    const p = getPlatformPrisma();
    const wa = await p.notificationDelivery.findFirstOrThrow({ where: { schoolId, outboxId, channel: 'WHATSAPP' } });
    expect(wa.status).toBe('QUEUED');
    expect(wa.attempts).toBe(1);
    expect(wa.error).toContain('131000');
    expect(wa.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 60_000 - 1_000);
    expect(wa.nextAttemptAt.getTime()).toBeLessThanOrEqual(after + 60_000 + 1_000);
    // The stored wall-clock is UTC: the database itself agrees the row is in the future.
    const [{ due }] = await p.$queryRawUnsafe<Array<{ due: boolean }>>(
      `SELECT "nextAttemptAt" <= (now() AT TIME ZONE 'UTC') AS due FROM "NotificationDelivery" WHERE id = $1::uuid`,
      wa.id,
    );
    expect(due).toBe(false);

    // The very next drain must not think it due: compared in the session's
    // zone, a UTC wall-clock reads 5 h 30 m in the past and would go again now.
    sent = [];
    await drainUntilQuiet();
    expect(sent.filter((s) => s.to === u.email)).toEqual([]);
    const still = await p.notificationDelivery.findFirstOrThrow({ where: { id: wa.id } });
    expect(still.attempts).toBe(1);
    // One delivery still owed, so the row stays open.
    expect((await p.notificationOutbox.findFirstOrThrow({ where: { id: outboxId, schoolId } })).sentAt).toBeNull();
  });

  it('(c) two concurrent drains send each delivery exactly once', async () => {
    const p = getPlatformPrisma();
    const users = await Promise.all(Array.from({ length: 12 }, (_, i) => user(`c${i}`)));
    const ids = await Promise.all(users.map((u, i) => outboxFor(u.id, `Payment confirmed (c${i})`)));
    // Already expanded, so both drains reach the DELIVERY claim at the same
    // moment — from scratch, one drain's expansion usually finishes first and
    // the race never happens.
    await p.notificationDelivery.createMany({
      data: users.flatMap((u, i) => (['PUSH', 'WHATSAPP', 'EMAIL'] as const).map((channel) => ({ schoolId, outboxId: ids[i], userId: u.id, channel }))),
    });
    await p.notificationOutbox.updateMany({ where: { schoolId, id: { in: ids } }, data: { expandedAt: new Date() } });

    // Separate service instances, as separate invocations would be.
    await Promise.all([service().drain({ purge: false }), service().drain({ purge: false }), service().drain({ purge: false })]);
    await drainUntilQuiet();

    const keys = sent.filter((s) => s.title.includes('(c')).map((s) => `${s.channel}|${s.to}|${s.title}`);
    expect(new Set(keys).size).toBe(36);
    expect(keys).toHaveLength(36);

    const deliveries = await p.notificationDelivery.findMany({ where: { schoolId, outboxId: { in: ids } } });
    expect(deliveries).toHaveLength(36);
    expect(deliveries.every((d) => d.status === 'SENT' && d.attempts === 1)).toBe(true);
    const rows = await p.notificationOutbox.findMany({ where: { schoolId, id: { in: ids } } });
    expect(rows.every((r) => r.sentAt !== null)).toBe(true);
  });

  it('(c2) two concurrent drains from unexpanded rows expand each row once and send each delivery once', async () => {
    const users = await Promise.all(Array.from({ length: 6 }, (_, i) => user(`e${i}`)));
    const ids = await Promise.all(users.map((u, i) => outboxFor(u.id, `Payment confirmed (e${i})`)));

    await Promise.all([service().drain({ purge: false }), service().drain({ purge: false })]);
    await drainUntilQuiet();

    const keys = sent.filter((s) => s.title.includes('(e')).map((s) => `${s.channel}|${s.to}|${s.title}`);
    expect(keys).toHaveLength(18);
    expect(new Set(keys).size).toBe(18);
    expect(await getPlatformPrisma().notificationDelivery.count({ where: { schoolId, outboxId: { in: ids } } })).toBe(18);
  });

  it('(d) closes a parked row whose deliveries all ended; a parked row with none stays for an operator', async () => {
    const u = await user('d');
    const p = getPlatformPrisma();
    // Parked: expansion's createMany went through, the expandedAt write kept failing.
    const parked = await outboxFor(u.id, 'Payment confirmed (d)', { attempts: 5 });
    await p.notificationDelivery.createMany({
      data: [
        { schoolId, outboxId: parked, userId: u.id, channel: 'PUSH', status: 'SENT', attempts: 1, sentAt: new Date() },
        { schoolId, outboxId: parked, userId: u.id, channel: 'WHATSAPP', status: 'FAILED', attempts: 6, error: 'gave up' },
        { schoolId, outboxId: parked, userId: u.id, channel: 'EMAIL', status: 'SKIPPED', reason: 'no-address' },
      ],
    });
    // Parked with no deliveries: nobody was told — a real failure, left alone.
    const lost = await outboxFor(u.id, 'Payment confirmed (d, lost)', { attempts: 5 });

    await drainUntilQuiet();

    const closed = await p.notificationOutbox.findFirstOrThrow({ where: { id: parked, schoolId } });
    expect(closed.sentAt).not.toBeNull();
    expect(closed.expandedAt).toBeNull();
    const untouched = await p.notificationOutbox.findFirstOrThrow({ where: { id: lost, schoolId } });
    expect(untouched.sentAt).toBeNull();
    expect(await p.notificationDelivery.count({ where: { outboxId: lost } })).toBe(0);
    // Neither was expanded again or sent to anyone.
    expect(sent.filter((s) => s.to === u.email)).toEqual([]);
  });
});

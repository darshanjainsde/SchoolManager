import { getLibraryPlatformPrisma } from '@library/db';
import { OutboxCronController } from '../src/internal-cron/outbox.controller';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * The nightly sweep that vercel.json had been calling into a 404 since Phase 1.
 *
 * The assertion that matters is the NEGATIVE one: an undelivered row is never
 * collected, however old. It represents something a school still owes a
 * parent, and deleting it because it aged would destroy the record of a
 * message that was never sent.
 */
describeLive('internal cron — the outbox sweep', () => {
  const controller = new OutboxCronController();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  const DAY = 86_400_000;

  // The route fails CLOSED on an unset secret, so the suite must configure one
  // like any other required env value. Every sweep below is an AUTHENTICATED
  // call; the unauthenticated cases are asserted explicitly at the bottom.
  const SECRET = 'cron-secret-for-tests';
  const AUTH = `Bearer ${SECRET}`;

  const reloadEnv = async () => {
    const { loadLibraryEnv } = await import('../src/config/env');
    loadLibraryEnv({ force: true });
  };

  beforeAll(async () => {
    process.env.CRON_SECRET = SECRET;
    await reloadEnv();
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`cron-${Date.now().toString(36)}`));
  });
  afterAll(async () => {
    await cleanupOrgs([org.id, other.id]);
    delete process.env.CRON_SECRET;
    await reloadEnv();
  });

  const row = (data: Record<string, unknown>) =>
    prisma.notificationOutbox.create({
      data: {
        orgId: org.id, channel: 'INAPP', templateKey: 'TEST',
        to: 'someone@example.test', payload: {}, ...data,
      } as never,
    });

  beforeEach(async () => {
    await prisma.notificationOutbox.deleteMany({ where: { orgId: org.id } });
  });

  it('collects delivered rows older than the retention window', async () => {
    const old = await row({ sentAt: new Date(Date.now() - 200 * DAY) });
    await controller.sweep(AUTH);
    expect(await prisma.notificationOutbox.findUnique({ where: { id: old.id } })).toBeNull();
  });

  it('keeps a delivered row that is still inside the window', async () => {
    const recent = await row({ sentAt: new Date(Date.now() - 5 * DAY) });
    await controller.sweep(AUTH);
    expect(await prisma.notificationOutbox.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  it('NEVER collects an undelivered row, however old', async () => {
    // Something the school still owes somebody. Age is not a reason to forget
    // it — this table is the only record that the message was never sent.
    const ancient = await row({ sentAt: null, createdAt: new Date(Date.now() - 900 * DAY) });
    await controller.sweep(AUTH);
    expect(await prisma.notificationOutbox.findUnique({ where: { id: ancient.id } })).not.toBeNull();
  });

  it('reports how much a school has not been told', async () => {
    await row({ sentAt: null });
    await row({ sentAt: null });
    const result = await controller.sweep(AUTH);
    expect(result.undelivered).toBeGreaterThanOrEqual(2);
    expect(result.note).toMatch(/no notification is sent/i);
  });

  it('refuses a caller without the secret, when one is configured', async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'a-secret';
    try {
      // The env loader caches; force it to see the new value the same way the
      // config module does.
      const { loadLibraryEnv } = await import('../src/config/env');
      loadLibraryEnv({ force: true });
      await expect(controller.sweep('Bearer wrong')).rejects.toThrow(/for the scheduler/);
      await expect(controller.sweep()).rejects.toThrow(/for the scheduler/);
      await expect(controller.sweep('Bearer a-secret')).resolves.toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
      const { loadLibraryEnv } = await import('../src/config/env');
      loadLibraryEnv({ force: true });
    }
  });

  /**
   * The regression that matters, and the reason the check was rewritten.
   *
   * This route used to read `if (secret && auth !== ...)`, so an UNSET
   * CRON_SECRET left an unauthenticated `deleteMany` reachable by anyone who
   * could guess the path. `CRON_SECRET` was in fact unset on every deployed
   * environment — verified 2026-08-14 via `vercel env ls` — so this was the
   * live state, not a hypothetical.
   *
   * The asymmetry is what made it invisible: `apps/api`'s `cron-secret.guard`
   * fails closed on the same missing variable, so one service went silent
   * (nightly 401s) while this one went open. A single missing value produced
   * two opposite failures, and only the noisy one was ever going to be noticed.
   */
  it('refuses every caller when NO secret is configured — never falls open', async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      await reloadEnv();
      await expect(controller.sweep()).rejects.toThrow(/for the scheduler/);
      await expect(controller.sweep('Bearer anything')).rejects.toThrow(/for the scheduler/);
      // Guards the exact shape the old code would have accepted: with no
      // secret set, `secret && ...` short-circuits to false and the sweep ran.
      await expect(controller.sweep('Bearer ')).rejects.toThrow(/for the scheduler/);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
      await reloadEnv();
    }
  });
});

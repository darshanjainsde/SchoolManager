import { getPlatformPrisma, disconnectAll } from '@skoolos/db';

/**
 * The outbox drain claims its batch with `FOR UPDATE SKIP LOCKED`. That cannot
 * be tested against a mock — SKIP LOCKED is a Postgres behaviour — so this runs
 * against the real database.
 *
 * What it protects: the cron moved from daily to once a minute, which makes two
 * drains overlapping a routine event rather than an impossible one. Without
 * claiming, both would read the same unsent rows and both would send them,
 * turning the documented rare at-least-once duplicate into a regular one.
 */
describe('NotificationOutbox claiming', () => {
  const CLAIM_TTL_MS = 5 * 60_000;
  let schoolId: string;

  const claimSql = (limit: number, staleBefore: Date) => `
    UPDATE "NotificationOutbox" SET "claimedAt" = now()
    WHERE id IN (
      SELECT id FROM "NotificationOutbox"
      WHERE "sentAt" IS NULL AND attempts < 5
        AND ("claimedAt" IS NULL OR "claimedAt" < '${staleBefore.toISOString()}')
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const school = await p.school.upsert({
      where: { slug: 'outbox-claim' },
      update: {},
      create: { slug: 'outbox-claim', name: 'Outbox Claim', tier: 'PRO', status: 'LIVE' },
    });
    schoolId = school.id;
    await p.notificationOutbox.deleteMany({ where: { schoolId } });
    await p.notificationOutbox.createMany({
      data: Array.from({ length: 6 }, () => ({
        schoolId,
        kind: 'RESULTS_PUBLISHED',
        payload: {},
      })),
    });
  });

  afterAll(async () => {
    await getPlatformPrisma().notificationOutbox.deleteMany({ where: { schoolId } });
    await disconnectAll();
  });

  it('gives each row to exactly one of two concurrent drains', async () => {
    const p = getPlatformPrisma();
    const stale = new Date(Date.now() - CLAIM_TTL_MS);

    const [a, b] = await Promise.all([
      p.$queryRawUnsafe<{ id: string }[]>(claimSql(3, stale)),
      p.$queryRawUnsafe<{ id: string }[]>(claimSql(3, stale)),
    ]);

    const ids = [...a.map((r) => r.id), ...b.map((r) => r.id)];
    // No row may appear in both batches.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('does not re-claim a row already claimed inside the TTL', async () => {
    const p = getPlatformPrisma();
    const stale = new Date(Date.now() - CLAIM_TTL_MS);
    // Everything was claimed by the previous test and nothing has been released.
    const again = await p.$queryRawUnsafe<{ id: string }[]>(claimSql(10, stale));
    expect(again).toHaveLength(0);
  });

  it('reclaims a row whose claim has gone stale, so a crashed drain cannot strand it', async () => {
    const p = getPlatformPrisma();
    // Pretend the claiming drain died: age every claim past the TTL.
    await p.notificationOutbox.updateMany({
      where: { schoolId },
      data: { claimedAt: new Date(Date.now() - CLAIM_TTL_MS - 60_000) },
    });
    const stale = new Date(Date.now() - CLAIM_TTL_MS);
    const reclaimed = await p.$queryRawUnsafe<{ id: string }[]>(claimSql(10, stale));
    expect(reclaimed.length).toBe(6);
  });

  it('never claims a row that has already been sent', async () => {
    const p = getPlatformPrisma();
    await p.notificationOutbox.updateMany({
      where: { schoolId },
      data: { sentAt: new Date(), claimedAt: null },
    });
    const stale = new Date(Date.now() - CLAIM_TTL_MS);
    const after = await p.$queryRawUnsafe<{ id: string }[]>(claimSql(10, stale));
    expect(after).toHaveLength(0);
  });
});

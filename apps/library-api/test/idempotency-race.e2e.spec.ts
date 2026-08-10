import { disconnectLibrary, getLibraryPlatformPrisma, withOrg } from '@library/db';
import { PrismaIdempotencyStore } from '../src/common/idempotency/idempotency.interceptor';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Regression test for the race `idempotency.interceptor.ts` documents:
 * "Miss: run the handler, then store the result" means two concurrent
 * identical requests can both observe a miss and both reach `store.create`
 * for the same `(orgId, key)`. The `@@unique([orgId, key])` constraint lets
 * only one INSERT land; `PrismaIdempotencyStore.create` must turn the
 * loser's unique-constraint violation into `{ won: false, existing }`
 * instead of letting a raw `PrismaClientKnownRequestError` (P2002) surface
 * as an unhandled 500 — that's the "make that path produce something sane"
 * requirement from the task brief.
 *
 * Unit tests mock the store entirely, so they can assert the interceptor's
 * *reaction* to `{ won: false }` but can never exercise the real unique
 * constraint doing the rejecting — only real Postgres proves that.
 */
describeLive('PrismaIdempotencyStore.create resolves a concurrent duplicate insert without throwing', () => {
  let orgId: string;

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const org = await prisma.libraryOrg.create({
      data: { slug: `idem-race-e2e-${suffix}`, name: 'Idempotency Race E2E', status: 'LIVE' },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
    await disconnectLibrary();
  });

  it('two genuinely concurrent creates for the same key produce exactly one row and one canonical response', async () => {
    const store = new PrismaIdempotencyStore();

    // Barrier: force real overlap instead of hoping the event loop
    // interleaves two sequential awaits — same technique as
    // quota-race.e2e.spec.ts, for the same reason (without it, a
    // lock-free/race-free implementation could still "pass" by accident).
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const bothArrived = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const arriveAtBarrier = async () => {
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      await bothArrived;
    };

    const attempt = (loanId: string) =>
      arriveAtBarrier().then(() =>
        store.create({
          orgId,
          key: 'race-key-1',
          endpoint: 'POST /loans',
          requestHash: 'same-request-hash',
          responseStatus: 201,
          responseBody: { loanId },
        }),
      );

    // Fire both concurrently — do NOT await sequentially, which would
    // trivially serialize them and prove nothing about the unique
    // constraint actually being what resolves the race.
    const [a, b] = await Promise.all([attempt('FROM-A'), attempt('FROM-B')]);
    const results = [a, b];

    const winners = results.filter((r) => r.won);
    const losers = results.filter((r) => !r.won);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const loserResult = losers[0] as { won: false; existing: { requestHash: string; responseBody: unknown } };
    expect(loserResult.existing.requestHash).toBe('same-request-hash');
    // The loser's `existing.responseBody` is the winner's — whichever of
    // FROM-A/FROM-B actually landed first in Postgres.
    expect(['FROM-A', 'FROM-B']).toContain((loserResult.existing.responseBody as { loanId: string }).loanId);

    // IdempotencyKey is FORCE ROW LEVEL SECURITY — a query against the
    // tenant client with no `app.current_org` GUC set (raw SQL included,
    // not just ORM calls) silently sees zero rows rather than erroring, so
    // this count must run inside withOrg like every other tenant read.
    const count = await withOrg(orgId, (tx) => tx.idempotencyKey.count({ where: { orgId, key: 'race-key-1' } }));
    expect(count).toBe(1);
  });

  it('a genuinely different concurrent request on the same key is a 409, not a silently-served wrong body', async () => {
    const store = new PrismaIdempotencyStore();

    let arrivals = 0;
    let releaseBarrier!: () => void;
    const bothArrived = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const arriveAtBarrier = async () => {
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      await bothArrived;
    };

    const attempt = (requestHash: string, loanId: string) =>
      arriveAtBarrier().then(() => ({
        ownHash: requestHash,
        result: store.create({
          orgId,
          key: 'race-key-2',
          endpoint: 'POST /loans',
          requestHash,
          responseStatus: 201,
          responseBody: { loanId },
        }),
      }));

    const [a, b] = await Promise.all([attempt('hash-A', 'FROM-A'), attempt('hash-B', 'FROM-B')]);
    const [ra, rb] = await Promise.all([a.result, b.result]);
    const pairs = [{ ownHash: a.ownHash, r: ra }, { ownHash: b.ownHash, r: rb }];
    const loserPair = pairs.find((p) => !p.r.won) as { ownHash: string; r: { won: false; existing: { requestHash: string } } };
    const winnerPair = pairs.find((p) => p.r.won);

    expect(winnerPair).toBeDefined();
    expect(loserPair).toBeDefined();
    // The loser's own hash never equals the winner's stored hash here —
    // this is the case the interceptor turns into a 409 rather than
    // treating as a benign replay of the same request.
    expect(loserPair.r.existing.requestHash).not.toBe(loserPair.ownHash);
  });
});

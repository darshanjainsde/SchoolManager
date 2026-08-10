import { ForbiddenException } from '@nestjs/common';
import { withOrg, getLibraryPlatformPrisma, disconnectLibrary, type LibraryTx } from '@library/db';
import { assertQuota } from '../src/modules/plans/internal/require-quota';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Regression test for the race `require-quota.ts` documents: under READ
 * COMMITTED, two transactions that both begin before either commits will
 * both run their `SELECT count(...)` against the same pre-race snapshot and
 * both pass, even though the count happens inside each caller's own
 * transaction. The fix is a `pg_advisory_xact_lock` acquired before the
 * count, which serializes concurrent callers on the same (orgId, what) key.
 *
 * Deleting that lock line reintroduces the double-creation bug silently —
 * every other test in the suite stays green, because none of them race two
 * transactions against the same quota. This test is the only thing in CI
 * that would catch it.
 *
 * Verified by deliberately removing the `pg_advisory_xact_lock` line and
 * re-running: both transactions succeeded and two branches were created
 * (see Task 10 report for the captured output). Restoring the line makes
 * this pass again.
 */
describeLive('assertQuota serializes concurrent transactions with an advisory lock', () => {
  let orgId: string;

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const org = await prisma.libraryOrg.create({
      data: { slug: `quota-race-e2e-${suffix}`, name: 'Quota Race E2E', status: 'LIVE' },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
    await disconnectLibrary();
  });

  it('two genuinely concurrent creations against a limit of 1 produce exactly one winner', async () => {
    const countBranches = (tx: LibraryTx, org: string) => tx.branch.count({ where: { orgId: org } });

    // Barrier: neither transaction is allowed to reach `assertQuota` until
    // BOTH have an open transaction (i.e. both callbacks passed to
    // `withOrg`/`$transaction` have actually started). Without this, two
    // `await`s in sequence could — depending on scheduling — resolve the
    // first transaction (BEGIN..COMMIT) before the second one even opens,
    // which would "pass" even a lock-free implementation and prove nothing.
    // The barrier forces real overlap deterministically instead of hoping
    // the event loop interleaves them.
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const bothArrived = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const arriveAtBarrier = async () => {
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      await bothArrived;
    };

    const attempt = (code: string) =>
      withOrg(orgId, async (tx) => {
        await arriveAtBarrier();
        await assertQuota(tx, orgId, 1, countBranches, 'branches');
        return tx.branch.create({ data: { orgId, name: `Race ${code}`, code } });
      });

    // Fire both concurrently — do NOT await sequentially, which would
    // trivially serialize them and prove nothing about the lock.
    const [first, second] = await Promise.allSettled([attempt('RACE-A'), attempt('RACE-B')]);
    const outcomes = [first, second];

    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ForbiddenException);

    const branches = await getLibraryPlatformPrisma().branch.findMany({ where: { orgId } });
    expect(branches).toHaveLength(1);
  });
});

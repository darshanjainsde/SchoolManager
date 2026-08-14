import { ForbiddenException } from '@nestjs/common';
import { withOrg, getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { issue } from '@library/core';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * The member borrowing limit was unenforced under concurrency.
 *
 * `issue` counts a member's open loans and then creates an Issue. Both happen
 * inside one transaction, which is what makes it look safe — but under READ
 * COMMITTED two transactions that both BEGIN before either COMMITs read the
 * same pre-race snapshot, so a child on their last permitted book is handed
 * two. `issue_one_active_per_copy` does not catch it: that partial unique
 * index constrains the COPY, and this race is two DIFFERENT copies going to
 * one child.
 *
 * That is the whole reason this file exists. Every other circulation test
 * issues books sequentially, so all of them stay green with the lock deleted —
 * this is the only thing in CI that would notice.
 *
 * Watched fail before the fix: with the `pg_advisory_xact_lock` line removed
 * from `packages/library-core/src/circulation/issues.ts`, both attempts
 * succeeded and the member held 2 books against a limit of 1.
 */
describeLive('issue serialises a member against their own borrowing limit', () => {
  let orgId: string;
  let memberId: string;
  let accessionA: string;
  let accessionB: string;

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const org = await prisma.libraryOrg.create({
      data: { slug: `member-limit-race-${suffix}`, name: 'Member Limit Race', status: 'LIVE' },
    });
    orgId = org.id;

    const branch = await prisma.branch.create({ data: { orgId, name: 'Main', code: 'MAIN' } });
    const title = await prisma.title.create({ data: { orgId, title: 'Member Limit Race Title' } });

    // TWO copies. One copy would be refused by the copy-level unique index and
    // would prove nothing about the member limit.
    accessionA = `MLR-A-${suffix}`;
    accessionB = `MLR-B-${suffix}`;
    await prisma.copy.createMany({
      data: [
        { orgId, titleId: title.id, branchId: branch.id, accessionNumber: accessionA },
        { orgId, titleId: title.id, branchId: branch.id, accessionNumber: accessionB },
      ],
    });

    const member = await prisma.member.create({
      data: {
        orgId,
        homeBranchId: branch.id,
        code: `MLR-${suffix}`,
        firstName: 'Race',
        lastName: 'Member',
        status: 'ACTIVE',
        memberType: 'STUDENT',
      },
    });
    memberId = member.id;

    // maxBooks: 1 — the limit under test. Org-wide (branchId null) so
    // `loadPolicy` resolves it for either copy's branch.
    await prisma.circulationPolicy.create({
      data: {
        orgId,
        branchId: null,
        memberType: 'STUDENT',
        maxBooks: 1,
        issueDays: 14,
        renewLimit: 1,
        renewDays: 7,
        finePerDay: 0,
        graceDays: 0,
        maxFine: null,
        maxReservations: 2,
        reservedShelfDays: 3,
        maxOutstandingFine: null,
      },
    });
  });

  afterAll(async () => {
    // Cascades from the org, so the fixture leaves nothing behind.
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
    await disconnectLibrary();
  });

  it('two genuinely concurrent issues to one member against a limit of 1 produce exactly one winner', async () => {
    // Neither side may reach the counting read until BOTH transactions are
    // open. Without the barrier the first could BEGIN..COMMIT before the
    // second even opens, which passes with or without a lock and proves
    // nothing — see quota-race.e2e.spec.ts for the same reasoning.
    let arrivals = 0;
    let releaseBarrier!: () => void;
    const bothArrived = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const arrive = async () => {
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      await bothArrived;
    };

    const now = new Date();
    const attempt = (accessionNumber: string) =>
      withOrg(
        orgId,
        async (tx) => {
          await arrive();
          // 7th argument `null` is `libUserId`. It defaults to `actorUserId`,
          // which is written to `Issue.issuedByUserId` — a foreign key to
          // LibUser. This fixture has no LibUser, so the default would make
          // BOTH attempts fail on the constraint and the test would report a
          // race it never actually ran. (It did, first time: 0 fulfilled.)
          return issue(tx, orgId, { accessionNumber, memberId }, memberId, now, [], null);
        },
        undefined,
        // The loser blocks on the advisory lock until the winner commits, so
        // the default 5s interactive timeout is too tight to be a fair test of
        // the lock rather than of the clock.
        { maxWait: 10_000, timeout: 20_000 },
      );

    const results = await Promise.allSettled([attempt(accessionA), attempt(accessionB)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // A policy refusal, not a crash and not a constraint violation leaking as
    // a 500: MEMBER_LIMIT_REACHED maps to 403.
    expect(rejected[0].reason).toBeInstanceOf(ForbiddenException);

    // The state, not just the return values — one open loan, which is what the
    // limit actually means.
    const openLoans = await getLibraryPlatformPrisma().issue.count({
      where: { orgId, memberId, returnedAt: null },
    });
    expect(openLoans).toBe(1);
  });
});

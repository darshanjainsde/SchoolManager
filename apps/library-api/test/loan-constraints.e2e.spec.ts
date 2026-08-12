import { Client } from 'pg';
import { withOrg, getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

// Dropping/recreating an index requires ownership of the schema object;
// neither `library_app` nor `library_platform` (BYPASSRLS, but still just a
// normal login role with SELECT/INSERT/UPDATE/DELETE grants — see
// scripts/library-db-init.sql) has DDL privileges on `library.*`. Only the
// superuser connection (LIBRARY_DIRECT_URL, same as rls-audit.spec.ts's
// permissive-policy test) can. Gated the same way: outside CI a missing
// superuser URL is a plain skip of just the discriminates-test describe
// block below; inside CI it throws, matching every other live-superuser gate
// in this codebase.
const SUPERUSER_URL = process.env.LIBRARY_DIRECT_URL ?? process.env.LIBRARY_DATABASE_URL;
if (LIVE && !SUPERUSER_URL && process.env.CI) {
  throw new Error(
    'LIVE is true but neither LIBRARY_DIRECT_URL nor LIBRARY_DATABASE_URL is set while process.env.CI ' +
      'is set. The loan_one_active_per_copy discriminates-test needs a superuser connection to drop and ' +
      'recreate the index and must not silently skip in CI.',
  );
}
const describeLiveSuperuser = LIVE && SUPERUSER_URL ? describe : describe.skip;

interface Fixture {
  orgId: string;
  branchId: string;
  copyId: string;
  memberAId: string;
  memberBId: string;
}

async function seedFixture(suffix: string): Promise<Fixture> {
  const prisma = getLibraryPlatformPrisma();
  const org = await prisma.libraryOrg.create({
    data: { slug: `loan-race-e2e-${suffix}`, name: 'Loan Race E2E', status: 'LIVE' },
  });
  const branch = await prisma.branch.create({ data: { orgId: org.id, name: 'Main', code: 'MAIN' } });
  const title = await prisma.title.create({ data: { orgId: org.id, title: 'Loan Race Title' } });
  const copy = await prisma.copy.create({
    data: { orgId: org.id, titleId: title.id, branchId: branch.id, barcode: `RACE-${suffix}` },
  });
  const memberA = await prisma.member.create({
    data: { orgId: org.id, homeBranchId: branch.id, code: `RACE-A-${suffix}`, firstName: 'Race', lastName: 'A', status: 'ACTIVE' },
  });
  const memberB = await prisma.member.create({
    data: { orgId: org.id, homeBranchId: branch.id, code: `RACE-B-${suffix}`, firstName: 'Race', lastName: 'B', status: 'ACTIVE' },
  });
  return { orgId: org.id, branchId: branch.id, copyId: copy.id, memberAId: memberA.id, memberBId: memberB.id };
}

/** Barrier: neither side proceeds to the INSERT until BOTH have an open
 * transaction — see quota-race.e2e.spec.ts for why this is mandatory rather
 * than two sequential `await`s, which would trivially serialize the two
 * attempts and prove nothing about the constraint. */
function makeBarrier(): () => Promise<void> {
  let arrivals = 0;
  let releaseBarrier!: () => void;
  const bothArrived = new Promise<void>((resolve) => { releaseBarrier = resolve; });
  return async () => {
    arrivals += 1;
    if (arrivals === 2) releaseBarrier();
    await bothArrived;
  };
}

function issueLoanAttempt(orgId: string, copyId: string, branchId: string, memberId: string, dueAt: Date, arrive: () => Promise<void>) {
  return withOrg(orgId, async (tx) => {
    await arrive();
    return tx.loan.create({ data: { orgId, copyId, branchId, memberId, dueAt, status: 'ACTIVE' } });
  });
}

/**
 * Regression test for `loan_one_active_per_copy`, the partial unique index
 * (`ON "Loan" ("copyId") WHERE "returnedAt" IS NULL`) that is the actual
 * concurrency guarantee behind "a copy can have at most one active loan" —
 * see docs/superpowers/LIBRARY-TRAPS.md trap 3 and trap 16. A transaction
 * gives atomicity, not mutual exclusion: under READ COMMITTED, two
 * transactions that both `BEGIN` before either commits read the same
 * snapshot, so an application-level "is this copy AVAILABLE?" check inside
 * one transaction still races against a second desk scanning the same
 * barcode at the same moment. Only a database-enforced constraint — not a
 * check-then-write in application code — can make that race impossible
 * rather than merely unlikely.
 *
 * Proven both ways in this file: the index present makes exactly one of two
 * genuinely concurrent issues win (this describe block), and the index
 * absent lets both through (the "discriminates" describe block below, which
 * always restores the index in `finally`, including on assertion failure).
 */
describeLive('loan_one_active_per_copy makes a double-issue impossible', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await seedFixture(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: fx.orgId } });
    await disconnectLibrary();
  });

  it('two genuinely concurrent issues on the same copy produce exactly one winner', async () => {
    const dueAt = new Date(Date.now() + 14 * 86_400_000);
    const arrive = makeBarrier();

    // Fire both concurrently — Promise.allSettled, not sequential awaits.
    const [first, second] = await Promise.allSettled([
      issueLoanAttempt(fx.orgId, fx.copyId, fx.branchId, fx.memberAId, dueAt, arrive),
      issueLoanAttempt(fx.orgId, fx.copyId, fx.branchId, fx.memberBId, dueAt, arrive),
    ]);
    const outcomes = [first, second];

    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeDefined();

    const loans = await getLibraryPlatformPrisma().loan.findMany({ where: { copyId: fx.copyId, returnedAt: null } });
    expect(loans).toHaveLength(1);
  });
});

describeLiveSuperuser('loan_one_active_per_copy — prove it discriminates (Task 4, trap 16)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await seedFixture(`disc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: fx.orgId } });
    await disconnectLibrary();
  });

  it('with the index dropped, both concurrent issues succeed — restored in finally', async () => {
    const superuser = new Client({ connectionString: SUPERUSER_URL });
    await superuser.connect();
    try {
      await superuser.query('DROP INDEX library.loan_one_active_per_copy');
      try {
        const dueAt = new Date(Date.now() + 14 * 86_400_000);
        const arrive = makeBarrier();

        const [first, second] = await Promise.allSettled([
          issueLoanAttempt(fx.orgId, fx.copyId, fx.branchId, fx.memberAId, dueAt, arrive),
          issueLoanAttempt(fx.orgId, fx.copyId, fx.branchId, fx.memberBId, dueAt, arrive),
        ]);
        const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');

        // With the constraint gone, BOTH concurrent issues succeed — this is
        // the exact double-issue bug the index exists to prevent.
        expect(fulfilled).toHaveLength(2);
        const loans = await getLibraryPlatformPrisma().loan.findMany({
          where: { copyId: fx.copyId, returnedAt: null },
        });
        expect(loans).toHaveLength(2);
      } finally {
        // Clean up the two loans this test deliberately let through FIRST —
        // `CREATE UNIQUE INDEX` fails outright if existing rows already
        // violate the constraint being created, so the index must be
        // recreated against a clean table, not the other way around.
        await getLibraryPlatformPrisma().loan.deleteMany({ where: { copyId: fx.copyId } });
        await superuser.query(
          'CREATE UNIQUE INDEX loan_one_active_per_copy ON library."Loan" ("copyId") WHERE "returnedAt" IS NULL',
        );
      }
    } finally {
      await superuser.end();
    }
  });
});

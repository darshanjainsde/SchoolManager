import { randomUUID } from 'node:crypto';
import { getLibraryPlatformPrisma } from '@library/db';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * `Member.externalRef` is the join between a Sckools user and their library
 * membership. Enrolment reads the roster, so a bug or a double-run is exactly
 * how one child ends up with two Member rows — and then BOTH accrue fines, both
 * appear in dues, and the not-returned list names the same person twice with
 * different books.
 *
 * The guard is a PARTIAL unique index, because `externalRef` must stay nullable:
 * EXTERNAL members (alumni, parents) have no Sckools account at all.
 */
describeLive('one library member per Sckools user', () => {
  const prisma = getLibraryPlatformPrisma();
  let org: SeededOrg;
  let other: SeededOrg;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`xref-${Date.now().toString(36)}`));
  });
  afterAll(async () => { await cleanupOrgs([org.id, other.id]); });

  const member = (code: string, externalRef: string | null) =>
    prisma.member.create({
      data: {
        orgId: org.id, homeBranchId: org.branchId, code,
        firstName: 'X', lastName: 'Y', memberType: 'STUDENT',
        externalRef, status: 'ACTIVE',
      } as never,
      select: { id: true },
    });

  it('refuses a SECOND member linked to the same user', async () => {
    const userId = randomUUID();
    await member(`A-${Date.now()}`, userId);

    // Different borrower code, same person — which is precisely the shape a
    // re-run bug produces, and precisely what a lookup-only index allowed.
    await expect(member(`B-${Date.now()}`, userId)).rejects.toThrow();
  });

  it('still allows MANY members with no Sckools account', async () => {
    // Alumni and parents borrow too and have no login. A plain unique index
    // would be useless here (Postgres treats NULLs as distinct) and a NOT NULL
    // column would delete external borrowers outright.
    await expect(member(`N1-${Date.now()}`, null)).resolves.toBeDefined();
    await expect(member(`N2-${Date.now()}`, null)).resolves.toBeDefined();
  });

  it('scopes the rule per org — two schools may both link the same user', async () => {
    // A teacher who works at two schools in the group is two memberships, and
    // an index without orgId would silently forbid the second.
    const userId = randomUUID();
    await member(`S1-${Date.now()}`, userId);

    await expect(
      prisma.member.create({
        data: {
          orgId: other.id, homeBranchId: other.branchId, code: `S2-${Date.now()}`,
          firstName: 'X', lastName: 'Y', memberType: 'STUDENT',
          externalRef: userId, status: 'ACTIVE',
        } as never,
        select: { id: true },
      }),
    ).resolves.toBeDefined();
  });
});

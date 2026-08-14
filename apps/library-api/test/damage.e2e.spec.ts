import { BadRequestException, NotFoundException } from '@nestjs/common';
import { withOrg, getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { recordDamage } from '@library/core';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Damage at return: recorded, never priced.
 *
 * The load-bearing assertion in this file is the NEGATIVE one — that no `Fine`
 * row appears. Everything else here is ordinary behaviour; that one is the
 * product promise. A librarian who suspects the button might bill a family
 * stops pressing it, and then the condition column holds nothing and nobody
 * can tell whether the last borrower tore the page or found it torn.
 */
describeLive('recordDamage — writes the condition, charges nothing', () => {
  let orgId: string;
  let accessionNumber: string;
  let memberId: string;

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const org = await prisma.libraryOrg.create({
      data: { slug: `damage-e2e-${suffix}`, name: 'Damage E2E', status: 'LIVE' },
    });
    orgId = org.id;

    const branch = await prisma.branch.create({ data: { orgId, name: 'Main', code: 'MAIN' } });
    const title = await prisma.title.create({ data: { orgId, title: 'The Hungry Tide' } });
    accessionNumber = `DMG-${suffix}`;
    await prisma.copy.create({
      data: { orgId, titleId: title.id, branchId: branch.id, accessionNumber, condition: 'GOOD' },
    });

    const member = await prisma.member.create({
      data: {
        orgId,
        homeBranchId: branch.id,
        code: `DMG-M-${suffix}`,
        firstName: 'Aarav',
        lastName: 'Sharma',
        status: 'ACTIVE',
      },
    });
    memberId = member.id;
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
    await disconnectLibrary();
  });

  it('records the condition and creates NO fine', async () => {
    const result = await withOrg(orgId, (tx) =>
      recordDamage(
        tx,
        orgId,
        { accessionNumber, condition: 'POOR', note: 'Last twenty pages torn' },
        null,
        new Date(),
      ),
    );

    expect(result.condition).toBe('POOR');
    expect(result.title).toBe('The Hungry Tide');

    const prisma = getLibraryPlatformPrisma();
    const copy = await prisma.copy.findFirst({ where: { orgId, accessionNumber } });
    expect(copy?.condition).toBe('POOR');
    expect(copy?.remarks).toContain('Last twenty pages torn');

    // THE ASSERTION THIS FILE EXISTS FOR.
    const fines = await prisma.fine.count({ where: { orgId } });
    expect(fines).toBe(0);

    // And the record says so in its own words, so a reader a year from now
    // does not have to infer "no charge" from the absence of a row.
    const audit = await prisma.auditLog.findFirst({
      where: { orgId, action: 'circulation.copy.damage' },
      orderBy: { at: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect((audit?.after as { charged?: boolean })?.charged).toBe(false);
  });

  it('appends a second note rather than replacing the first', async () => {
    await withOrg(orgId, (tx) =>
      recordDamage(tx, orgId, { accessionNumber, condition: 'POOR', note: 'Cover off' }, null, new Date()),
    );

    const copy = await getLibraryPlatformPrisma().copy.findFirst({ where: { orgId, accessionNumber } });
    // A copy accumulates a history. Overwriting would erase the earlier damage
    // the moment a second one is noted, and then the register lies by omission.
    expect(copy?.remarks).toContain('Last twenty pages torn');
    expect(copy?.remarks).toContain('Cover off');
  });

  it('refuses NEW — "damaged, condition NEW" is a row nobody can act on', async () => {
    await expect(
      withOrg(orgId, (tx) =>
        recordDamage(tx, orgId, { accessionNumber, condition: 'NEW', note: 'x' }, null, new Date()),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an empty note — the condition alone says nothing useful', async () => {
    await expect(
      withOrg(orgId, (tx) =>
        recordDamage(tx, orgId, { accessionNumber, condition: 'FAIR', note: '   ' }, null, new Date()),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not require an open loan — she often notices while shelving', async () => {
    // No issue was ever created for this copy in this test, and the call above
    // already succeeded. This asserts the member exists but is uninvolved,
    // which is the case a route demanding an active loan would have refused.
    const openLoans = await getLibraryPlatformPrisma().issue.count({
      where: { orgId, memberId, returnedAt: null },
    });
    expect(openLoans).toBe(0);
  });

  it('404s on a number that is not in the register', async () => {
    await expect(
      withOrg(orgId, (tx) =>
        recordDamage(tx, orgId, { accessionNumber: 'NOPE-0000', condition: 'FAIR', note: 'x' }, null, new Date()),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { withOrg } from '@library/db';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

describeLive('cross-org isolation is enforced by Postgres, not by where clauses', () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  beforeAll(async () => { ({ orgA, orgB } = await seedTwoOrgs(Date.now().toString(36))); });
  afterAll(async () => { await cleanupOrgs([orgA.id, orgB.id]); });

  it('cannot read another org\'s member even when asked for it by id', async () => {
    const found = await withOrg(orgA.id, (tx) => tx.member.findUnique({ where: { id: orgB.memberId } }));
    expect(found).toBeNull();
  });

  it('cannot list another org\'s branches', async () => {
    const branches = await withOrg(orgA.id, (tx) => tx.branch.findMany());
    expect(branches.map((b) => b.id)).not.toContain(orgB.branchId);
  });

  it('cannot update another org\'s member', async () => {
    await expect(
      withOrg(orgA.id, (tx) => tx.member.update({ where: { id: orgB.memberId }, data: { firstName: 'Hacked' } })),
    ).rejects.toThrow();
    const untouched = await withOrg(orgB.id, (tx) => tx.member.findUnique({ where: { id: orgB.memberId } }));
    expect(untouched?.firstName).toBe('Test');
  });

  it('cannot insert a row belonging to another org', async () => {
    await expect(
      withOrg(orgA.id, (tx) =>
        tx.branch.create({ data: { orgId: orgB.id, name: 'Smuggled', code: 'SMUG' } })),
    ).rejects.toThrow();
  });

  it('returns zero rows when no org is scoped at all', async () => {
    // Not via withOrg: a raw tenant-client query with no GUC set must see nothing.
    const { getLibraryTenantPrisma } = await import('@library/db');
    const rows = await getLibraryTenantPrisma().member.findMany();
    expect(rows).toEqual([]);
  });
});

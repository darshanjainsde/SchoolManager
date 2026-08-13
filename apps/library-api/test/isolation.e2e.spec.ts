import { getLibraryPlatformPrisma, withOrg } from '@library/db';
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

describeLive('catalogue cross-org isolation (Title, Copy, TitleAuthor)', () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  // Seeded directly via the platform (BYPASSRLS) client, the same way
  // seedTwoOrgs seeds org/branch/member — these fixtures exist purely to be
  // read back through the RLS-bound tenant client under withOrg.
  let titleA: { id: string };
  let titleB: { id: string };
  let copyA: { id: string };
  let authorB: { id: string };
  let titleAuthorB: { titleId: string; authorId: string };

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`cat-${Date.now().toString(36)}`));
    const prisma = getLibraryPlatformPrisma();

    titleA = await prisma.title.create({ data: { orgId: orgA.id, title: 'Org A Title' } });
    titleB = await prisma.title.create({ data: { orgId: orgB.id, title: 'Org B Title' } });
    copyA = await prisma.copy.create({
      data: { orgId: orgA.id, titleId: titleA.id, branchId: orgA.branchId, accessionNumber: 'A-0001' },
    });

    authorB = await prisma.author.create({ data: { orgId: orgB.id, name: 'B Author', sortName: 'author, b' } });
    // TitleAuthor carries no orgId — its own tenancy comes entirely from the
    // Title/Author rows it joins, both belonging to orgB here.
    const joinRow = await prisma.titleAuthor.create({
      data: { titleId: titleB.id, authorId: authorB.id },
    });
    titleAuthorB = { titleId: joinRow.titleId, authorId: joinRow.authorId };
  });

  afterAll(async () => { await cleanupOrgs([orgA.id, orgB.id]); });

  describe('Title', () => {
    it("cannot read another org's title even when asked for it by id", async () => {
      const found = await withOrg(orgA.id, (tx) => tx.title.findUnique({ where: { id: titleB.id } }));
      expect(found).toBeNull();
    });

    it("cannot list another org's titles", async () => {
      const titles = await withOrg(orgA.id, (tx) => tx.title.findMany());
      expect(titles.map((t) => t.id)).not.toContain(titleB.id);
    });

    it("cannot update another org's title", async () => {
      await expect(
        withOrg(orgA.id, (tx) => tx.title.update({ where: { id: titleB.id }, data: { title: 'Hacked' } })),
      ).rejects.toThrow();
      const untouched = await withOrg(orgB.id, (tx) => tx.title.findUnique({ where: { id: titleB.id } }));
      expect(untouched?.title).toBe('Org B Title');
    });

    it('cannot insert a title belonging to another org', async () => {
      await expect(
        withOrg(orgA.id, (tx) => tx.title.create({ data: { orgId: orgB.id, title: 'Smuggled' } })),
      ).rejects.toThrow();
    });

    it('returns zero rows when no org is scoped at all', async () => {
      const { getLibraryTenantPrisma } = await import('@library/db');
      const rows = await getLibraryTenantPrisma().title.findMany();
      expect(rows).toEqual([]);
    });
  });

  describe('Copy', () => {
    it("cannot read another org's copy even when asked for it by id", async () => {
      const found = await withOrg(orgB.id, (tx) => tx.copy.findUnique({ where: { id: copyA.id } }));
      expect(found).toBeNull();
    });

    it("cannot list another org's copies", async () => {
      const copies = await withOrg(orgB.id, (tx) => tx.copy.findMany());
      expect(copies.map((c) => c.id)).not.toContain(copyA.id);
    });

    it("cannot update another org's copy", async () => {
      await expect(
        withOrg(orgB.id, (tx) => tx.copy.update({ where: { id: copyA.id }, data: { shelf: 'Hacked' } })),
      ).rejects.toThrow();
      const untouched = await withOrg(orgA.id, (tx) => tx.copy.findUnique({ where: { id: copyA.id } }));
      expect(untouched?.shelf).toBeNull();
    });

    it('cannot insert a copy belonging to another org', async () => {
      await expect(
        withOrg(orgB.id, (tx) =>
          tx.copy.create({ data: { orgId: orgA.id, titleId: titleA.id, branchId: orgA.branchId, accessionNumber: 'SMUG' } })),
      ).rejects.toThrow();
    });

    it('returns zero rows when no org is scoped at all', async () => {
      const { getLibraryTenantPrisma } = await import('@library/db');
      const rows = await getLibraryTenantPrisma().copy.findMany();
      expect(rows).toEqual([]);
    });
  });

  describe('TitleAuthor (no orgId of its own — scoped indirectly through Title)', () => {
    it("cannot read another org's TitleAuthor row even when asked for it by its composite key", async () => {
      const found = await withOrg(orgA.id, (tx) =>
        tx.titleAuthor.findUnique({
          where: {
            titleId_authorId_role: { titleId: titleAuthorB.titleId, authorId: titleAuthorB.authorId, role: 'AUTHOR' },
          },
        }));
      expect(found).toBeNull();
    });

    it("cannot list another org's TitleAuthor rows", async () => {
      const rows = await withOrg(orgA.id, (tx) => tx.titleAuthor.findMany());
      expect(rows.map((r) => r.titleId)).not.toContain(titleAuthorB.titleId);
    });

    // Regression test for review finding 1 (CRITICAL): the original policy
    // was `EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId")` — it
    // never referenced authorId at all, so joining THIS org's own title to
    // ANOTHER org's author passed WITH CHECK (the EXISTS only asked "does
    // some Title with this id exist and is it mine," never anything about
    // the Author side). Reproduced live against the real database before
    // the fix (20260811200000_join_table_rls_both_sides/migration.sql):
    // `INSERT INTO "TitleAuthor" (titleId, authorId, role) VALUES (<org A's
    // title>, <org B's author>, 'AUTHOR')` succeeded under org A's scope.
    // Because TitleAuthor.author is ON DELETE CASCADE, that smuggled row
    // meant org B deleting their own Author would silently delete an org-A
    // row — a covert cross-tenant side channel. The policy now requires
    // BOTH EXISTS clauses to reservation.
    it("cannot insert a TitleAuthor row joining this org's own title to another org's author", async () => {
      await expect(
        withOrg(orgA.id, (tx) =>
          tx.titleAuthor.create({ data: { titleId: titleA.id, authorId: authorB.id } })),
      ).rejects.toThrow();
      const rows = await withOrg(orgB.id, (tx) => tx.titleAuthor.findMany({ where: { titleId: titleA.id } }));
      expect(rows).toEqual([]);
    });

    it('returns zero rows when no org is scoped at all', async () => {
      const { getLibraryTenantPrisma } = await import('@library/db');
      const rows = await getLibraryTenantPrisma().titleAuthor.findMany();
      expect(rows).toEqual([]);
    });
  });
});

describeLive('circulation cross-org isolation (Issue)', () => {
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let titleB: { id: string };
  let copyB: { id: string };
  let loanB: { id: string };

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`circ-${Date.now().toString(36)}`));
    const prisma = getLibraryPlatformPrisma();

    titleB = await prisma.title.create({ data: { orgId: orgB.id, title: 'Org B Circulation Title' } });
    copyB = await prisma.copy.create({
      data: { orgId: orgB.id, titleId: titleB.id, branchId: orgB.branchId, accessionNumber: 'B-0001' },
    });
    loanB = await prisma.issue.create({
      data: {
        orgId: orgB.id,
        copyId: copyB.id,
        branchId: orgB.branchId,
        memberId: orgB.memberId,
        dueAt: new Date(Date.now() + 14 * 86_400_000),
      },
    });
  });

  afterAll(async () => { await cleanupOrgs([orgA.id, orgB.id]); });

  it("cannot read another org's issue even when asked for it by id", async () => {
    const found = await withOrg(orgA.id, (tx) => tx.issue.findUnique({ where: { id: loanB.id } }));
    expect(found).toBeNull();
  });

  it("cannot list another org's issues", async () => {
    const issues = await withOrg(orgA.id, (tx) => tx.issue.findMany());
    expect(issues.map((l) => l.id)).not.toContain(loanB.id);
  });

  it("cannot update another org's issue", async () => {
    await expect(
      withOrg(orgA.id, (tx) => tx.issue.update({ where: { id: loanB.id }, data: { renewCount: 99 } })),
    ).rejects.toThrow();
    const untouched = await withOrg(orgB.id, (tx) => tx.issue.findUnique({ where: { id: loanB.id } }));
    expect(untouched?.renewCount).toBe(0);
  });

  it('cannot insert a issue belonging to another org', async () => {
    await expect(
      withOrg(orgA.id, (tx) =>
        tx.issue.create({
          data: {
            orgId: orgB.id,
            copyId: copyB.id,
            branchId: orgB.branchId,
            memberId: orgB.memberId,
            dueAt: new Date(Date.now() + 14 * 86_400_000),
          },
        })),
    ).rejects.toThrow();
  });

  it('returns zero rows when no org is scoped at all', async () => {
    const { getLibraryTenantPrisma } = await import('@library/db');
    const rows = await getLibraryTenantPrisma().issue.findMany();
    expect(rows).toEqual([]);
  });
});

import { NotFoundException } from '@nestjs/common';
import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { CategoriesService } from '../src/modules/catalog/internal/categories.service';
import { CopiesService } from '../src/modules/catalog/internal/copies.service';
import { TitlesService } from '../src/modules/catalog/internal/titles.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Review finding 1 (catalogue, Important): `Copy.branchId`,
 * `Title.categoryIds` and `Category.parentId` are client-supplied foreign
 * keys, passed straight from their DTOs into a write with no ownership
 * lookup. RLS does not catch this — Postgres referential-integrity checks
 * bypass row-level security by design, so an FK constraint is satisfied by a
 * row the caller can neither see nor read. A legitimate LIBRARIAN in org A
 * who supplies org B's branch/category UUID would get a row that
 * structurally references org B's data.
 *
 * This is why the proof runs against real Postgres rather than a mocked
 * `tx`: the whole defect is that Postgres's own FK check does NOT reject
 * this write, so a mock that just echoes back whatever the test tells it
 * proves nothing about whether the fix actually discriminates. Each
 * "rejects" case here was run once with its guarding lookup commented out —
 * it failed (the write succeeded, id readable back from the other org) —
 * before the lookup was restored. See catalogue-fixes-report.md for the
 * before/after output.
 */
describeLive('catalogue — client-supplied foreign keys are checked for org ownership', () => {
  const copies = new CopiesService();
  const titles = new TitlesService();
  const categories = new CategoriesService();

  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let titleInOrgA: { id: string };
  let categoryInOrgA: { id: string };
  let categoryInOrgB: { id: string };

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`catown-${Date.now().toString(36)}`));
    const prisma = getLibraryPlatformPrisma();
    titleInOrgA = await prisma.title.create({ data: { orgId: orgA.id, title: 'Ownership Probe Title' } });
    categoryInOrgA = await prisma.category.create({
      data: { orgId: orgA.id, name: `Ownership Probe Category A ${Date.now()}` },
    });
    categoryInOrgB = await prisma.category.create({
      data: { orgId: orgB.id, name: `Ownership Probe Category B ${Date.now()}` },
    });
  });

  afterAll(async () => {
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  describe('Copy.branchId', () => {
    it("404s when the branchId belongs to another org", async () => {
      await expect(
        withOrg(orgA.id, (tx: LibraryTx) =>
          copies.add(tx, orgA.id, titleInOrgA.id, {
            branchId: orgB.branchId,
            accessionNumber: `OWNERSHIP-PROBE-BRANCH-BAD-${Date.now()}`,
          }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("succeeds when the branchId belongs to the caller's own org", async () => {
      const copy = await withOrg(orgA.id, (tx: LibraryTx) =>
        copies.add(tx, orgA.id, titleInOrgA.id, {
          branchId: orgA.branchId,
          accessionNumber: `OWNERSHIP-PROBE-BRANCH-OK-${Date.now()}`,
        }),
      );
      expect(copy?.branchId).toBe(orgA.branchId);
    });
  });

  describe('Title.categoryIds', () => {
    it('404s when a categoryId belongs to another org', async () => {
      await expect(
        withOrg(orgA.id, (tx: LibraryTx) =>
          titles.create(tx, orgA.id, {
            title: `Cross-org category probe ${Date.now()}`,
            categoryIds: [categoryInOrgB.id],
          }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("succeeds when every categoryId belongs to the caller's own org", async () => {
      const title = await withOrg(orgA.id, (tx: LibraryTx) =>
        titles.create(tx, orgA.id, {
          title: `Same-org category probe ${Date.now()}`,
          categoryIds: [categoryInOrgA.id],
        }),
      );
      expect(title?.categories.map((c) => c.categoryId)).toContain(categoryInOrgA.id);
    });
  });

  describe('Category.parentId', () => {
    it('404s when parentId belongs to another org', async () => {
      await expect(
        withOrg(orgA.id, (tx: LibraryTx) =>
          categories.create(tx, orgA.id, {
            name: `Cross-org parent probe ${Date.now()}`,
            parentId: categoryInOrgB.id,
          }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("succeeds when parentId belongs to the caller's own org", async () => {
      const category = await withOrg(orgA.id, (tx: LibraryTx) =>
        categories.create(tx, orgA.id, {
          name: `Same-org parent probe ${Date.now()}`,
          parentId: categoryInOrgA.id,
        }),
      );
      expect(category?.parentId).toBe(categoryInOrgA.id);
    });
  });
});

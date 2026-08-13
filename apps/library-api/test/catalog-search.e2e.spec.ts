import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { SearchService } from '../src/modules/catalog/internal/search.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Table-driven proof of the four things task-6-brief.md requires of search:
 *   1. a title-field match outranks a publisher-field match (setweight A vs C
 *      in the catalogue migration's generated `searchVector` column)
 *   2. a partial word prefix matches (`to_tsquery`'s `:*` on the last token)
 *   3. a title is findable by its AUTHOR's name, even though no word of the
 *      author's name appears anywhere in the title's own indexed columns —
 *      this is the ILIKE-on-Author.sortName branch, the whole reason search
 *      isn't just "query the generated column and stop"
 *   4. results never cross the org boundary
 *
 * Fixtures are seeded once via the BYPASSRLS platform client (same pattern
 * isolation.e2e.spec.ts uses for its own catalogue fixtures) so the
 * generated `searchVector` column populates the same way it would from a
 * real write path; `searchTitles` itself always runs through `withOrg`, the
 * same as the real controller.
 */
describeLive('catalogue search (SearchService, real Postgres)', () => {
  const search = new SearchService();
  let orgA: SeededOrg;
  let orgB: SeededOrg;

  // Title/publisher-weight fixtures (requirement 1 + 4)
  let titleWordInTitle: { id: string };
  let titleWordInPublisherOnly: { id: string };
  let titleWordInPublisherOrgB: { id: string };

  // Prefix fixture (requirement 2)
  let titlePhotosynthesis: { id: string };

  // Author-only fixture (requirement 3) — the title's own title/subtitle/
  // publisher/callNumber deliberately contain NONE of the author's name.
  let titleFindableByAuthorOnly: { id: string };

  beforeAll(async () => {
    ({ orgA, orgB } = await seedTwoOrgs(`catsearch-${Date.now().toString(36)}`));
    const prisma = getLibraryPlatformPrisma();

    titleWordInTitle = await prisma.title.create({
      data: { orgId: orgA.id, title: 'The Voyager Expedition', publisher: 'Northwind Press' },
    });
    titleWordInPublisherOnly = await prisma.title.create({
      data: { orgId: orgA.id, title: 'Charting the Unknown', publisher: 'Voyager House Publishing' },
    });
    titleWordInPublisherOrgB = await prisma.title.create({
      data: { orgId: orgB.id, title: 'A Different Book', publisher: 'Voyager House Publishing' },
    });

    titlePhotosynthesis = await prisma.title.create({
      data: { orgId: orgA.id, title: 'Photosynthesis and Plant Biology', publisher: 'Greenleaf Academic' },
    });

    titleFindableByAuthorOnly = await prisma.title.create({
      data: { orgId: orgA.id, title: 'Silent Fields', subtitle: 'A Wartime Chronicle', publisher: 'Marlowe & Sons' },
    });
    const author = await prisma.author.create({
      data: { orgId: orgA.id, name: 'J.R.R. Tolkien', sortName: 'Tolkien, J.R.R.' },
    });
    await prisma.titleAuthor.create({ data: { titleId: titleFindableByAuthorOnly.id, authorId: author.id } });
  });

  afterAll(async () => {
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  const runSearch = (orgId: string, q: string) =>
    withOrg(orgId, (tx: LibraryTx) => search.searchTitles(tx, orgId, q, 'LIBRARIAN', 20));

  it('ranks a title-field match above a publisher-field match for the same term', async () => {
    const hits = await runSearch(orgA.id, 'voyager');
    const ids = hits.map((h) => h.id);
    expect(ids).toContain(titleWordInTitle.id);
    expect(ids).toContain(titleWordInPublisherOnly.id);
    expect(ids.indexOf(titleWordInTitle.id)).toBeLessThan(ids.indexOf(titleWordInPublisherOnly.id));

    const titleHit = hits.find((h) => h.id === titleWordInTitle.id)!;
    const publisherHit = hits.find((h) => h.id === titleWordInPublisherOnly.id)!;
    expect(titleHit.rank).toBeGreaterThan(publisherHit.rank);
  });

  it('matches on a partial word prefix', async () => {
    const hits = await runSearch(orgA.id, 'photo');
    expect(hits.map((h) => h.id)).toContain(titlePhotosynthesis.id);
  });

  it("finds a title by its author's name even though the title's own text never mentions it", async () => {
    const hits = await runSearch(orgA.id, 'Tolkien');
    expect(hits.map((h) => h.id)).toContain(titleFindableByAuthorOnly.id);
  });

  it("does not return another org's title, even one that matches the same term", async () => {
    const hits = await runSearch(orgA.id, 'voyager');
    expect(hits.map((h) => h.id)).not.toContain(titleWordInPublisherOrgB.id);

    // And the reverse: orgB's own scoped search finds its own row.
    const orgBHits = await runSearch(orgB.id, 'voyager');
    expect(orgBHits.map((h) => h.id)).toContain(titleWordInPublisherOrgB.id);
  });

  it('falls back to a plain alphabetical listing when the query has no searchable tokens', async () => {
    const hits = await runSearch(orgA.id, '!!!');
    // Must not throw (the empty/degenerate-tsquery trap) and must still be org-scoped.
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.rank === 0)).toBe(true);
  });
});

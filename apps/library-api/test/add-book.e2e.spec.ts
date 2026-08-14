import { BadRequestException, ConflictException } from '@nestjs/common';
import { withOrg, getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { addBook, suggestNextAccessionNumbers } from '@library/core';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * The counter's quick-add.
 *
 * The riskiest part is the NUMBERING, because the accession register is an
 * auditor's document and a school's scheme is its own. A suggestion that
 * collides with that scheme is worse than no suggestion — she would write it
 * inside a front cover before anyone noticed.
 */
describeLive('addBook — a title, its copies, and numbers she can trust', () => {
  let orgId: string;

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const org = await prisma.libraryOrg.create({
      data: { slug: `add-book-e2e-${suffix}`, name: 'Add Book E2E', status: 'LIVE' },
    });
    orgId = org.id;
    await prisma.branch.create({ data: { orgId, name: 'Main', code: 'MAIN' } });
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
    await disconnectLibrary();
  });

  it('suggests nothing for an empty register — there is nothing to count from', async () => {
    const next = await withOrg(orgId, (tx) => suggestNextAccessionNumbers(tx, orgId, 3));
    expect(next).toEqual([]);
  });

  it('adds a title with its copies and one author', async () => {
    const result = await withOrg(orgId, (tx) =>
      addBook(
        tx,
        orgId,
        { title: 'The Hungry Tide', author: 'Amitav Ghosh', accessionNumbers: ['1001', '1002'] },
        null,
      ),
    );

    expect(result.copies).toHaveLength(2);
    const prisma = getLibraryPlatformPrisma();
    const copies = await prisma.copy.findMany({ where: { orgId }, orderBy: { accessionNumber: 'asc' } });
    expect(copies.map((c) => c.accessionNumber)).toEqual(['1001', '1002']);
    expect(copies.every((c) => c.status === 'AVAILABLE')).toBe(true);

    // No price is set by this path — seeding replacementPrice is a money rule
    // that belongs on the screen built for it, and two implementations of what
    // a parent eventually pays is exactly what must not happen.
    const title = await prisma.title.findFirst({ where: { orgId } });
    expect(title?.replacementPrice).toBeNull();
    expect(copies.every((c) => c.acquisitionCost === null)).toBe(true);
  });

  it('now suggests the next numbers, counting from the highest', async () => {
    const next = await withOrg(orgId, (tx) => suggestNextAccessionNumbers(tx, orgId, 3));
    expect(next).toEqual(['1003', '1004', '1005']);
  });

  it('reuses one Author row when the same name is typed again', async () => {
    await withOrg(orgId, (tx) =>
      addBook(tx, orgId, { title: 'The Shadow Lines', author: 'Amitav Ghosh', accessionNumbers: ['1003'] }, null),
    );
    const authors = await getLibraryPlatformPrisma().author.findMany({ where: { orgId } });
    // Otherwise every re-typing becomes a new author and the catalogue slowly
    // stops being searchable by author at all.
    expect(authors).toHaveLength(1);
  });

  it('refuses a number already in the register, naming it', async () => {
    await expect(
      withOrg(orgId, (tx) => addBook(tx, orgId, { title: 'Duplicate', accessionNumbers: ['1001'] }, null)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses two copies sharing a number, before the index has to', async () => {
    await expect(
      withOrg(orgId, (tx) =>
        addBook(tx, orgId, { title: 'Twins', accessionNumbers: ['2001', '2001'] }, null),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a book with no name and a book with no numbers', async () => {
    await expect(
      withOrg(orgId, (tx) => addBook(tx, orgId, { title: '  ', accessionNumbers: ['3001'] }, null)),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      withOrg(orgId, (tx) => addBook(tx, orgId, { title: 'No numbers', accessionNumbers: [] }, null)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('suggests nothing once the register uses a scheme it cannot read', async () => {
    // A school numbering ENG/2024/117 gets no suggestion rather than a wrong
    // one. The non-numeric row must not drag the maximum somewhere meaningless
    // either — 1003 is still the highest plain integer here.
    await withOrg(orgId, (tx) =>
      addBook(tx, orgId, { title: 'Scheme', accessionNumbers: ['ENG/2024/117'] }, null),
    );
    const next = await withOrg(orgId, (tx) => suggestNextAccessionNumbers(tx, orgId, 2));
    expect(next).toEqual(['1004', '1005']);
  });
});

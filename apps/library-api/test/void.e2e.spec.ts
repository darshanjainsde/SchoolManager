import { getLibraryPlatformPrisma, withOrg } from '@library/db';
import { VoidService } from '../src/modules/circulation/internal/void.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Undo is the correction a librarian reaches for daily. The tests below are
 * mostly about what undo must NOT leave behind — a copy still marked issued, a
 * reservation stuck COLLECTED, a fine quietly accruing, or an attendance mark
 * for a child who was never there.
 */
describeLive('undo an issue', () => {
  const voids = new VoidService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`void-${Date.now().toString(36)}`));
  });
  afterAll(async () => { await cleanupOrgs([org.id, other.id]); });

  /** A title + one available copy, returned with its accession number. */
  async function makeCopy(accession: string) {
    const title = await prisma.title.create({
      data: { orgId: org.id, title: `Void Test ${accession}` },
      select: { id: true },
    });
    return prisma.copy.create({
      data: {
        orgId: org.id,
        titleId: title.id,
        branchId: org.branchId,
        accessionNumber: accession,
        status: 'AVAILABLE',
      },
      select: { id: true, accessionNumber: true },
    });
  }

  /**
   * Builds the loan directly rather than through `IssuesService.issue`. These
   * tests are about the UNDO, and going through the issue path would couple
   * them to that method's actor/branch signature and its attendance and
   * reservation side effects — none of which these cases assert on.
   */
  async function issueTo(copyId: string) {
    const issue = await prisma.issue.create({
      data: {
        orgId: org.id,
        copyId,
        branchId: org.branchId,
        memberId: org.memberId,
        dueAt: new Date(Date.now() + 14 * 86_400_000),
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    await prisma.copy.update({ where: { id: copyId }, data: { status: 'ISSUED' } });
    return issue;
  }

  it('frees the copy and removes the loan entirely', async () => {
    const copy = await makeCopy(`V-${Date.now().toString(36)}-1`);
    const issued = await issueTo(copy.id);

    await expect(
      prisma.copy.findUnique({ where: { id: copy.id }, select: { status: true } }),
    ).resolves.toMatchObject({ status: 'ISSUED' });

    const result = await withOrg(org.id, (tx) =>
      voids.voidIssue(tx, org.id, issued.id, 'typed the wrong book number', null),
    );

    expect(result.copyStatus).toBe('AVAILABLE');
    await expect(
      prisma.copy.findUnique({ where: { id: copy.id }, select: { status: true } }),
    ).resolves.toMatchObject({ status: 'AVAILABLE' });
    // Gone, not flagged — see the service doc for why a status would keep
    // accruing money across 39 read sites.
    await expect(prisma.issue.findUnique({ where: { id: issued.id } })).resolves.toBeNull();
  });

  it('writes an audit row carrying the whole deleted issue and the reason', async () => {
    // Once the row is deleted this audit entry is the ONLY record it existed.
    const copy = await makeCopy(`V-${Date.now().toString(36)}-2`);
    const issued = await issueTo(copy.id);

    await withOrg(org.id, (tx) =>
      voids.voidIssue(tx, org.id, issued.id, 'issued to the wrong child', null),
    );

    const audit = await prisma.auditLog.findFirst({
      where: { orgId: org.id, action: 'circulation.issue.void', entityId: issued.id },
    });
    expect(audit).not.toBeNull();
    const before = audit!.before as Record<string, unknown>;
    expect(before.accessionNumber).toBe(copy.accessionNumber);
    expect(before.memberId).toBe(org.memberId);
    expect(before.dueAt).toBeTruthy();
    expect((audit!.after as Record<string, unknown>).reason).toBe('issued to the wrong child');
  });

  it('stops the late charge, because the issue no longer exists', async () => {
    // The whole point. A backdated loan is overdue and accruing; after the undo
    // it must contribute nothing to what the member owes.
    const copy = await makeCopy(`V-${Date.now().toString(36)}-3`);
    const issued = await issueTo(copy.id);
    await prisma.issue.update({
      where: { id: issued.id },
      data: { dueAt: new Date(Date.now() - 30 * 86_400_000) },
    });

    const before = await prisma.issue.count({
      where: { orgId: org.id, returnedAt: null, dueAt: { lt: new Date() } },
    });
    expect(before).toBeGreaterThan(0);

    await withOrg(org.id, (tx) => voids.voidIssue(tx, org.id, issued.id, 'never went out', null));

    const after = await prisma.issue.count({
      where: { orgId: org.id, id: issued.id, returnedAt: null, dueAt: { lt: new Date() } },
    });
    expect(after).toBe(0);
  });

  it('does NOT fabricate a return — the day report must not count it', async () => {
    // The tempting shortcut is to "return" the book instead of undoing it.
    // That inflates returns-today and the collections figures. Nothing here may
    // look like a return.
    const copy = await makeCopy(`V-${Date.now().toString(36)}-4`);
    const issued = await issueTo(copy.id);
    const dayStart = new Date(Date.now() - 86_400_000);

    await withOrg(org.id, (tx) => voids.voidIssue(tx, org.id, issued.id, 'mistype', null));

    const returnedToday = await prisma.issue.count({
      where: { orgId: org.id, returnedAt: { gte: dayStart } },
    });
    expect(returnedToday).toBe(0);
  });

  it('refuses an issue that already carries money', async () => {
    // Money is corrected on the fines screen, where the reason is recorded as a
    // waiver. Deleting the loan under a fine would orphan the charge.
    const copy = await makeCopy(`V-${Date.now().toString(36)}-5`);
    const issued = await issueTo(copy.id);
    await prisma.fine.create({
      data: {
        orgId: org.id,
        memberId: org.memberId,
        issueId: issued.id,
        kind: 'OVERDUE',
        amount: 10,
        status: 'OPEN',
      } as never,
    });

    await expect(
      withOrg(org.id, (tx) => voids.voidIssue(tx, org.id, issued.id, 'nope', null)),
    ).rejects.toThrow(/money or a loss/i);

    await expect(prisma.issue.findUnique({ where: { id: issued.id } })).resolves.not.toBeNull();
  });

  it('refuses an issue that has already been returned', async () => {
    const copy = await makeCopy(`V-${Date.now().toString(36)}-6`);
    const issued = await issueTo(copy.id);
    await prisma.issue.update({
      where: { id: issued.id },
      data: { returnedAt: new Date(), status: 'RETURNED' },
    });

    await expect(
      withOrg(org.id, (tx) => voids.voidIssue(tx, org.id, issued.id, 'nope', null)),
    ).rejects.toThrow(/already been returned/i);
  });

  it('cannot reach another org\'s issue', async () => {
    // Cross-tenant isolation on a DESTRUCTIVE route. RLS scopes the read, so
    // the lookup finds nothing and it is a 404, not a silent delete.
    const copy = await makeCopy(`V-${Date.now().toString(36)}-7`);
    const issued = await issueTo(copy.id);

    await expect(
      withOrg(other.id, (tx) => voids.voidIssue(tx, other.id, issued.id, 'attack', null)),
    ).rejects.toThrow(/no such issue/i);

    await expect(prisma.issue.findUnique({ where: { id: issued.id } })).resolves.not.toBeNull();
  });
});

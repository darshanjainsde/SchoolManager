import { getLibraryPlatformPrisma, withOrg, type LibraryTx } from '@library/db';
import { RegisterService } from '../src/modules/register/internal/register.service';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * The register and the stock take.
 *
 * The property that matters: the register is a HISTORY. A lost or withdrawn
 * copy keeps its row and its number for good, because that is precisely what
 * an auditor checks — and the stock take must separate "not on the shelf and
 * nobody knows why" from "not on the shelf for a reason already recorded",
 * because the first is the entire output of the exercise and the second would
 * bury it.
 */
describeLive('register — the fourteen columns, and the annual walk', () => {
  const register = new RegisterService();
  const prisma = getLibraryPlatformPrisma();

  let org: SeededOrg;
  let other: SeededOrg;
  let staffId: string;
  let titleId: string;

  beforeAll(async () => {
    ({ orgA: org, orgB: other } = await seedTwoOrgs(`reg-${Date.now().toString(36)}`));
    staffId = (await prisma.libUser.create({
      data: {
        orgId: org.id, email: `reg-${Date.now()}@t.local`, passwordHash: 'x',
        role: 'LIBRARIAN', branchIds: [org.branchId],
      },
    })).id;
    const author = await prisma.author.create({
      data: { orgId: org.id, name: 'Narayan, R. K.', sortName: 'Narayan, R. K.' },
    });
    const title = await prisma.title.create({
      data: {
        orgId: org.id, title: 'Malgudi Days', publisher: 'Penguin', publishedYear: 1943,
        pageCount: 264, edition: '1st', callNumber: '823.912',
        authors: { create: [{ authorId: author.id, role: 'AUTHOR' }] },
      },
    });
    titleId = title.id;

    // Four copies with distinct fates, so the register has something to say.
    const mk = (n: string, extra: Record<string, unknown> = {}) =>
      prisma.copy.create({
        data: {
          orgId: org.id, titleId, branchId: org.branchId, accessionNumber: n,
          acquiredAt: new Date('2026-01-15'), acquisitionCost: 299,
          source: 'Purchase', billNumber: 'INV-221', ...extra,
        } as never,
      });
    await mk('R-1001');
    await mk('R-1002', { status: 'ISSUED' });
    await mk('R-1003', { status: 'LOST' });
    await mk('R-1004', { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnReason: 'Water damage' });
  });

  afterAll(async () => { await cleanupOrgs([org.id, other.id]); });

  it('produces the fourteen canonical columns', async () => {
    const rows = await withOrg(org.id, (tx: LibraryTx) =>
      register.list(tx, org.id, { limit: 100, offset: 0 }));
    const row = rows.find((r) => r.accessionNumber === 'R-1001')!;

    expect(row.title).toBe('Malgudi Days');
    expect(row.author).toBe('Narayan, R. K.');
    expect(row.publisher).toBe('Penguin');
    expect(row.year).toBe(1943);
    expect(row.pages).toBe(264);
    expect(row.edition).toBe('1st');
    expect(row.callNumber).toBe('823.912');
    expect(row.source).toBe('Purchase');
    expect(row.billNumber).toBe('INV-221');
    // PRICE PAID — from the bill. Never the replacement price.
    expect(row.pricePaid).toBe('299');
  });

  it('keeps lost and withdrawn copies, with what became of them', async () => {
    const rows = await withOrg(org.id, (tx: LibraryTx) =>
      register.list(tx, org.id, { limit: 100, offset: 0 }));
    const numbers = rows.map((r) => r.accessionNumber);

    // A register that dropped these would be a stock list, and the number would
    // look free — which is exactly what must never happen.
    expect(numbers).toContain('R-1003');
    expect(numbers).toContain('R-1004');
    expect(rows.find((r) => r.accessionNumber === 'R-1003')!.remarks).toMatch(/Lost/);
    expect(rows.find((r) => r.accessionNumber === 'R-1004')!.remarks).toMatch(/Withdrawn.*Water damage/);
  });

  it('reads in accession order — a ledger, not a catalogue', async () => {
    const rows = await withOrg(org.id, (tx: LibraryTx) =>
      register.list(tx, org.id, { limit: 100, offset: 0 }));
    const ours = rows.map((r) => r.accessionNumber).filter((n) => n.startsWith('R-'));
    expect(ours).toEqual([...ours].sort());
  });

  describe('stock take', () => {
    it('separates what is genuinely missing from what is absent for a reason', async () => {
      const result = await withOrg(org.id, (tx: LibraryTx) =>
        register.stockTake(tx, org.id, 'R-1001, R-1002, R-1003, R-1004'));

      // On the shelf and typed.
      expect(result.present.map((p) => p.accessionNumber)).toEqual(['R-1001']);

      // Absent, but the register already explains each one. Burying the real
      // gaps under these is the failure this distinction prevents.
      const notes = Object.fromEntries(
        result.accountedFor.map((a) => [a.accessionNumber, a.note]),
      );
      expect(notes['R-1002']).toMatch(/with |on loan/);
      expect(notes['R-1003']).toMatch(/already recorded lost/);
      expect(notes['R-1004']).toMatch(/withdrawn/);
    });

    it('names a number this library never issued, rather than ignoring it', async () => {
      const result = await withOrg(org.id, (tx: LibraryTx) =>
        register.stockTake(tx, org.id, 'R-1001, R-9999'));
      expect(result.unknown).toEqual(['R-9999']);
    });

    it('answers the actual question: what have I not accounted for', async () => {
      // The librarian walked the shelf and typed everything EXCEPT R-1001.
      const missing = await withOrg(org.id, (tx: LibraryTx) =>
        register.unaccountedFor(tx, org.id, 'R-1002, R-1003, R-1004'));
      const numbers = missing.map((m) => m.accessionNumber);

      expect(numbers).toContain('R-1001');
      // On loan, lost and withdrawn are NOT chased — they are absent for
      // reasons the register already knows.
      expect(numbers).not.toContain('R-1002');
      expect(numbers).not.toContain('R-1003');
      expect(numbers).not.toContain('R-1004');
    });

    it('expands a range, so a whole shelf is one entry', async () => {
      const result = await withOrg(org.id, (tx: LibraryTx) =>
        register.stockTake(tx, org.id, '1001-1006'));
      expect(result.checked).toBe(6);
    });

    it("cannot see another org's shelves", async () => {
      await prisma.copy.create({
        data: {
          orgId: other.id,
          titleId: (await prisma.title.create({ data: { orgId: other.id, title: 'Theirs' } })).id,
          branchId: other.branchId, accessionNumber: 'R-1001',
        },
      });
      const result = await withOrg(org.id, (tx: LibraryTx) =>
        register.stockTake(tx, org.id, 'R-1001'));
      // One copy found, ours — not two.
      expect(result.present.length + result.accountedFor.length).toBe(1);
    });
  });

  describe('weeding', () => {
    it('records why and who, and keeps the number retired', async () => {
      const copy = await prisma.copy.create({
        data: { orgId: org.id, titleId, branchId: org.branchId, accessionNumber: `R-WEED-${Date.now()}` },
      });

      await withOrg(org.id, (tx: LibraryTx) =>
        register.weed(tx, org.id, copy.id, 'Superseded by the 2020 edition', 'Head of English, 12 Aug', staffId, new Date()));

      const after = await prisma.copy.findUnique({ where: { id: copy.id } });
      expect(after!.status).toBe('WITHDRAWN');
      expect(after!.withdrawnReason).toMatch(/Superseded/);
      expect(after!.withdrawnByUserId).toBe(staffId);
      expect(after!.withdrawnApprovedByNote).toMatch(/Head of English/);
      // Still in the register, still holding its number.
      const rows = await withOrg(org.id, (tx: LibraryTx) =>
        register.list(tx, org.id, { limit: 500, offset: 0 }));
      expect(rows.map((r) => r.accessionNumber)).toContain(after!.accessionNumber);
    });

    it('refuses to withdraw a book a child is holding', async () => {
      const copy = await prisma.copy.create({
        data: { orgId: org.id, titleId, branchId: org.branchId, accessionNumber: `R-HELD-${Date.now()}`, status: 'ISSUED' },
      });
      await prisma.issue.create({
        data: {
          orgId: org.id, copyId: copy.id, branchId: org.branchId, memberId: org.memberId,
          dueAt: new Date(Date.now() + 86_400_000), status: 'ACTIVE',
        },
      });
      await expect(
        withOrg(org.id, (tx: LibraryTx) =>
          register.weed(tx, org.id, copy.id, 'r', 'a', staffId, new Date())),
      ).rejects.toThrow(/with a member/);
    });
  });
});

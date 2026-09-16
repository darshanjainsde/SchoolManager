const txMock = {
  feeTerm: { findFirst: jest.fn(), findFirstOrThrow: jest.fn() },
  feePlan: { findFirst: jest.fn(), findFirstOrThrow: jest.fn() },
  feeCategory: { findMany: jest.fn() },
  feePlanItem: { findMany: jest.fn() },
  classSection: { findMany: jest.fn() },
  feeInvoice: { findMany: jest.fn(), createMany: jest.fn(), create: jest.fn() },
  feeInvoiceLine: { createMany: jest.fn() },
  feeLedgerEntry: { createMany: jest.fn(), create: jest.fn() },
  student: { findMany: jest.fn() },
  feeAssignment: { findMany: jest.fn() },
  feeConcession: { findMany: jest.fn() },
  academicYear: { findFirstOrThrow: jest.fn() },
  $queryRaw: jest.fn(),
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { FeeBillingService } from './fee-billing.service';

/**
 * Billing a term is four statements, not three round trips per child.
 *
 * `generate()` had NO test at all — the fees suite covers late fees and money
 * maths, neither of which touches it. It looped the roster inside ONE
 * withTenant transaction asking fee_next_number() once per student, then
 * inserting the invoice, then the ledger debit.
 *
 * Measured on production: 5.8 ms per round trip including query execution. At a
 * conservative 3 ms for a small write, 1,500 children x 3 round trips is 13.5
 * seconds against a 10-second transaction timeout — the run aborts, rolls back,
 * and the school cannot bill. The irony is that computeTerm's own comment two
 * methods up warns about exactly this shape.
 *
 * So the count of statements is asserted here, not just the rows. A version
 * that produced identical invoices one at a time would pass a data-only test
 * and still take the school down.
 */
const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TERM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PLAN = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CAT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SECTION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function roll(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `stu-${i}`, schoolId: SCHOOL, classSectionId: SECTION, status: 'ACTIVE',
    firstName: `Child${i}`, lastName: 'Sharma', admissionNo: `ADM-${i}`, isRte: false,
  }));
}

function setup(students: number, alreadyBilledIds: string[] = []) {
  jest.clearAllMocks();
  withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
  txMock.feeTerm.findFirst.mockResolvedValue({
    id: TERM, schoolId: SCHOOL, academicYearId: 'yr1', name: 'Term 1',
    dueDate: new Date('2026-07-10'), lateFeeMode: 'NONE',
  });
  txMock.feePlan.findFirst.mockResolvedValue({ id: PLAN, schoolId: SCHOOL, version: 1 });
  txMock.feeTerm.findFirstOrThrow.mockResolvedValue({
    id: TERM, schoolId: SCHOOL, academicYearId: 'yr1', name: 'Term 1',
    dueDate: new Date('2026-07-10'), lateFeeMode: 'NONE',
  });
  txMock.feePlan.findFirstOrThrow.mockResolvedValue({ id: PLAN, schoolId: SCHOOL, version: 1 });
  txMock.feeCategory.findMany.mockResolvedValue([
    { id: CAT, schoolId: SCHOOL, name: 'Tuition', description: null, isCollectible: true, order: 0, archivedAt: null },
  ]);
  txMock.feePlanItem.findMany.mockResolvedValue([
    { id: 'item1', schoolId: SCHOOL, planId: PLAN, categoryId: CAT, gradeId: 'g1', amountMinor: 500000, termId: null },
  ]);
  txMock.classSection.findMany.mockResolvedValue([
    { id: SECTION, schoolId: SCHOOL, gradeId: 'g1', academicYearId: 'yr1', name: 'A', grade: { id: 'g1', name: 'Grade 1', order: 1 } },
  ]);
  txMock.feeInvoice.findMany.mockResolvedValue(alreadyBilledIds.map((studentId) => ({ studentId })));
  txMock.student.findMany.mockResolvedValue(roll(students));
  txMock.feeAssignment.findMany.mockResolvedValue([]);
  txMock.feeConcession.findMany.mockResolvedValue([]);
  txMock.academicYear.findFirstOrThrow.mockResolvedValue({ name: '2026-27' });
  // The block allocator hands back the FIRST number of a reserved run.
  txMock.$queryRaw.mockResolvedValue([{ fee_next_block: 1 }]);
  txMock.feeInvoice.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  txMock.feeInvoiceLine.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  txMock.feeLedgerEntry.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  return new FeeBillingService();
}

const rowsOf = (m: { mock: { calls: { 0: { data: Record<string, unknown>[] } }[] } }) =>
  m.mock.calls.flatMap((c) => c[0].data);

describe('generate — billing a whole term', () => {
  it('costs a fixed number of statements, whatever the roster', async () => {
    for (const size of [1, 40, 1500]) {
      const svc = setup(size);
      const r = await svc.generate(SCHOOL, TERM);
      expect(r.created).toBe(size);
      // ONE block reservation, however many children.
      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);
      // createMany batches at 1,000 — so ceil(size/1000) statements per table,
      // never one per child. The old code made `size` round trips for numbers
      // alone.
      const batches = Math.ceil(size / 1000);
      expect(txMock.feeInvoice.createMany).toHaveBeenCalledTimes(batches);
      expect(txMock.feeInvoiceLine.createMany).toHaveBeenCalledTimes(batches);
      expect(txMock.feeInvoice.create).not.toHaveBeenCalled();
      expect(txMock.feeLedgerEntry.create).not.toHaveBeenCalled();
      // And all of it inside ONE tenant transaction.
      expect(withTenantMock).toHaveBeenCalledTimes(1);
    }
  });

  it('numbers the invoices consecutively from the reserved block', async () => {
    const svc = setup(3);
    txMock.$queryRaw.mockResolvedValue([{ fee_next_block: 41 }]);
    await svc.generate(SCHOOL, TERM);
    expect(rowsOf(txMock.feeInvoice.createMany).map((r) => r.number))
      .toEqual(['INV/2026-27/00041', 'INV/2026-27/00042', 'INV/2026-27/00043']);
    // It asked for exactly as many numbers as it intends to use — a block it
    // does not consume is a gap in the school's invoice series.
    expect(txMock.$queryRaw.mock.calls[0].slice(1)).toContain(3);
  });

  it('every ledger debit points at its own invoice', async () => {
    const svc = setup(3);
    await svc.generate(SCHOOL, TERM);
    const invoices = rowsOf(txMock.feeInvoice.createMany);
    const ledger = rowsOf(txMock.feeLedgerEntry.createMany);
    expect(ledger).toHaveLength(3);
    for (const [i, entry] of ledger.entries()) {
      expect(entry.refId).toBe(invoices[i].id);
      expect(entry.studentId).toBe(invoices[i].studentId);
      expect(entry.amountMinor).toBe(invoices[i].totalMinor);
      expect(entry.kind).toBe('DEBIT');
      expect(entry.narration).toContain(invoices[i].number);
    }
    // And every line belongs to a real invoice.
    const ids = new Set(invoices.map((r) => r.id));
    for (const line of rowsOf(txMock.feeInvoiceLine.createMany)) expect(ids.has(line.invoiceId)).toBe(true);
  });

  it('bills nobody twice — an already-billed child is skipped', async () => {
    const svc = setup(3, ['stu-1']);
    const r = await svc.generate(SCHOOL, TERM);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(1);
    const billed = rowsOf(txMock.feeInvoice.createMany).map((x) => x.studentId);
    expect(billed).toEqual(['stu-0', 'stu-2']);
    // Two numbers reserved, not three.
    expect(txMock.$queryRaw.mock.calls[0].slice(1)).toContain(2);
  });

  it('writes nothing at all when there is nobody left to bill', async () => {
    const svc = setup(2, ['stu-0', 'stu-1']);
    const r = await svc.generate(SCHOOL, TERM);
    expect(r.created).toBe(0);
    // No block is reserved, so the invoice series gains no gap.
    expect(txMock.$queryRaw).not.toHaveBeenCalled();
    expect(txMock.feeInvoice.createMany).not.toHaveBeenCalled();
  });
});

const txMock = {
  student: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  teacher: { findMany: jest.fn(), count: jest.fn() },
  staff: { findMany: jest.fn() },
  pressIssue: { findMany: jest.fn() },
  feeLedgerEntry: { groupBy: jest.fn(), findMany: jest.fn() },
  attendance: { groupBy: jest.fn(), findMany: jest.fn() },
  enquiry: { findMany: jest.fn(), count: jest.fn() },
  classSection: { count: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  libraryIssue: { findMany: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { ConsoleSearchService } from './console-search.service';
import { PulseService } from './pulse.service';
import { StudentReportService } from './student-report.service';
import type { FeatureResolverService } from '../features';
import type { FeeQueryService } from '../fees';
import type { ReportCardService } from '../press';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
/** 09:00 IST on Tue 2 Sept. */
const NOW = new Date('2026-09-02T03:30:00Z');

const features = (on: string[]) =>
  ({ getFeatures: jest.fn().mockResolvedValue(new Set(on)) }) as unknown as FeatureResolverService;

beforeEach(() => {
  jest.clearAllMocks();
  withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
  for (const table of Object.values(txMock)) {
    for (const fn of Object.values(table)) (fn as jest.Mock).mockReset();
  }
  txMock.student.findMany.mockResolvedValue([]);
  txMock.teacher.findMany.mockResolvedValue([]);
  txMock.staff.findMany.mockResolvedValue([]);
  txMock.pressIssue.findMany.mockResolvedValue([]);
  txMock.feeLedgerEntry.groupBy.mockResolvedValue([]);
  txMock.feeLedgerEntry.findMany.mockResolvedValue([]);
  txMock.attendance.groupBy.mockResolvedValue([]);
  txMock.attendance.findMany.mockResolvedValue([]);
  txMock.enquiry.findMany.mockResolvedValue([]);
  txMock.enquiry.count.mockResolvedValue(0);
  txMock.student.count.mockResolvedValue(0);
  txMock.teacher.count.mockResolvedValue(0);
  txMock.classSection.count.mockResolvedValue(0);
  txMock.academicYear.findFirst.mockResolvedValue(null);
  txMock.libraryIssue.findMany.mockResolvedValue([]);
});

// ── the command bar's index ──────────────────────────────────────────────────

describe('ConsoleSearchService', () => {
  const svc = new ConsoleSearchService();

  it('returns silence below two characters — and fires no query for it', async () => {
    const out = await svc.search(SCHOOL, 'a');
    expect(out).toEqual({ students: [], teachers: [], staff: [], serials: [] });
    expect(withTenantMock).not.toHaveBeenCalled();
  });

  it('carries each student hit with its live fee balance from ONE grouped read', async () => {
    txMock.student.findMany.mockResolvedValue([
      {
        id: 's1', firstName: 'Aarav', lastName: 'Sharma', admissionNo: 'RPS-0790',
        rollNo: '14', isActive: true,
        classSection: { name: 'B', grade: { name: 'VII' } },
      },
    ]);
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { studentId: 's1', kind: 'DEBIT', _sum: { amountMinor: 2400000 } },
      { studentId: 's1', kind: 'CREDIT', _sum: { amountMinor: 1550000 } },
    ]);

    const out = await svc.search(SCHOOL, 'aar');

    expect(out.students[0]).toMatchObject({
      name: 'Aarav Sharma', classLabel: 'VII-B', feesDueMinor: 850000,
    });
    // One grouped call, never a query per hit.
    expect(txMock.feeLedgerEntry.groupBy).toHaveBeenCalledTimes(1);
  });

  it('an overpaid child shows zero due, never a negative chip', async () => {
    txMock.student.findMany.mockResolvedValue([
      { id: 's1', firstName: 'K', lastName: 'M', admissionNo: 'A1', rollNo: null, isActive: true, classSection: null },
    ]);
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { studentId: 's1', kind: 'CREDIT', _sum: { amountMinor: 500000 } },
    ]);
    const out = await svc.search(SCHOOL, 'ka');
    expect(out.students[0]!.feesDueMinor).toBe(0);
  });

  it('searches serials only from four characters — "20" must not match the whole register', async () => {
    await svc.search(SCHOOL, 'RC');
    expect(txMock.pressIssue.findMany).not.toHaveBeenCalled();
    await svc.search(SCHOOL, '0041');
    expect(txMock.pressIssue.findMany).toHaveBeenCalledTimes(1);
  });

  it('caps a runaway query at 80 characters before it reaches the database', async () => {
    await svc.search(SCHOOL, 'x'.repeat(500));
    const where = txMock.student.findMany.mock.calls[0]![0].where;
    expect(where.OR[0].firstName.contains.length).toBe(80);
  });
});

// ── the pulse ────────────────────────────────────────────────────────────────

describe('PulseService', () => {
  const feeQuery = {
    collectionSummary: jest.fn().mockResolvedValue({
      billedMinor: 940000, collectedMinor: 310000, outstandingMinor: 630000,
      todayByMethod: [], todayTotalMinor: 0, awaitingReviewMinor: 0, awaitingReviewCount: 0,
    }),
  } as unknown as FeeQueryService;

  it('draws one point per marked day, LATE counting as present', async () => {
    txMock.attendance.groupBy.mockResolvedValue([
      { date: new Date('2026-09-01'), status: 'PRESENT', _count: { _all: 90 } },
      { date: new Date('2026-09-01'), status: 'ABSENT', _count: { _all: 10 } },
      { date: new Date('2026-09-02'), status: 'PRESENT', _count: { _all: 85 } },
      { date: new Date('2026-09-02'), status: 'LATE', _count: { _all: 10 } },
      { date: new Date('2026-09-02'), status: 'ABSENT', _count: { _all: 5 } },
    ]);
    const svc = new PulseService(features(['MANAGEMENT']), feeQuery);
    const out = await svc.pulse(SCHOOL, NOW);

    expect(out.attendance.series).toEqual([
      { date: '2026-09-01', pct: 90 },
      { date: '2026-09-02', pct: 95 },
    ]);
    expect(out.attendance.todayPct).toBe(95);
    expect(out.fees).toBeNull(); // no FEES feature
  });

  it('splits enquiries 7/7 on the IST calendar and counts the uncontacted', async () => {
    txMock.enquiry.findMany.mockResolvedValue([
      { createdAt: new Date('2026-09-01T10:00:00Z') }, // last-7
      { createdAt: new Date('2026-08-31T20:00:00Z') }, // 01:30 IST 1 Sept → last-7
      { createdAt: new Date('2026-08-24T10:00:00Z') }, // prev-7
    ]);
    txMock.enquiry.count.mockResolvedValue(4);
    const svc = new PulseService(features(['MANAGEMENT']), feeQuery);
    const out = await svc.pulse(SCHOOL, NOW);

    expect(out.enquiries.last7).toBe(2);
    expect(out.enquiries.prev7).toBe(1);
    expect(out.enquiries.uncontacted).toBe(4);
    expect(out.enquiries.series).toHaveLength(7);
  });

  it('counts owing FAMILIES from net balances — a settled child never counts', async () => {
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { studentId: 'a', kind: 'DEBIT', _sum: { amountMinor: 1000 } },
      { studentId: 'a', kind: 'CREDIT', _sum: { amountMinor: 1000 } }, // settled
      { studentId: 'b', kind: 'DEBIT', _sum: { amountMinor: 5000 } },  // owes
    ]);
    const svc = new PulseService(features(['MANAGEMENT', 'FEES']), feeQuery);
    const out = await svc.pulse(SCHOOL, NOW);

    expect(out.fees).toMatchObject({ outstandingMinor: 630000, owingFamilies: 1 });
  });
});

// ── the 360 ──────────────────────────────────────────────────────────────────

describe('StudentReportService', () => {
  const press = {
    compileForStudent: jest.fn().mockResolvedValue({
      windowName: 'Term I', academicYearName: '2026-27',
      subjects: [], overall: { marks: 0, maxMarks: 0, pct: null, grade: null }, remark: null,
    }),
    schoolHeader: jest.fn().mockResolvedValue({ name: 'Raffles', logoUrl: null, addressLine: null, phone: null, email: null }),
  } as unknown as ReportCardService;

  const studentRow = {
    id: 's1', firstName: 'Aarav', lastName: 'Sharma', rollNo: '14', admissionNo: 'RPS-0790',
    code: 'RAF-00790', dob: new Date('2014-06-01'), gender: 'M', guardianName: 'Vikram Sharma',
    guardianPhone: '98290', isActive: true, createdAt: new Date('2020-04-01'),
    classSection: { name: 'B', grade: { name: 'VII' } },
  };

  it('404s a child the tenant cannot see', async () => {
    txMock.student.findFirst.mockResolvedValue(null);
    const svc = new StudentReportService(features(['MANAGEMENT']), press);
    await expect(svc.report(SCHOOL, 's1')).rejects.toMatchObject({ status: 404 });
  });

  it('composes the whole child: identity, attendance strip oldest-first, documents with the void flag', async () => {
    txMock.student.findFirst.mockResolvedValue(studentRow);
    txMock.attendance.groupBy.mockResolvedValue([
      { status: 'PRESENT', _count: { _all: 88 } },
      { status: 'LATE', _count: { _all: 3 } },
      { status: 'ABSENT', _count: { _all: 9 } },
    ]);
    txMock.attendance.findMany.mockResolvedValue([
      { date: new Date('2026-09-02'), status: 'PRESENT' }, // newest (query order desc)
      { date: new Date('2026-09-01'), status: 'ABSENT' },
    ]);
    txMock.pressIssue.findMany.mockResolvedValue([
      { id: 'p1', type: 'REPORT_CARD', serial: 'RC/2026/0007', issuedAt: new Date('2026-09-02'), voidedAt: null },
      { id: 'p2', type: 'TC', serial: 'TC/2026/0002', issuedAt: new Date('2026-08-01'), voidedAt: new Date('2026-08-02') },
    ]);
    txMock.libraryIssue.findMany.mockResolvedValue([
      { copy: { title: { title: 'Matilda' } }, issuedOn: new Date('2026-08-20'), dueOn: new Date('2026-09-08'), returnedOn: null },
    ]);

    const svc = new StudentReportService(features(['MANAGEMENT']), press);
    const out = await svc.report(SCHOOL, 's1');

    expect(out.student).toMatchObject({ name: 'Aarav Sharma', classLabel: 'VII-B', onRollSince: '2020-04-01' });
    expect(out.attendance).toMatchObject({ present: 91, total: 100, pct: 91 });
    // Strip flows oldest → newest, however the query returned it.
    expect(out.attendance.last20.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02']);
    expect(out.documents).toEqual([
      expect.objectContaining({ serial: 'RC/2026/0007', voided: false }),
      expect.objectContaining({ serial: 'TC/2026/0002', voided: true }),
    ]);
    expect(out.library[0]).toMatchObject({ title: 'Matilda', returnedOn: null });
    expect(out.fees).toBeNull(); // FEES off
    expect(out.academics?.windowName).toBe('Term I');
    expect(out.school.name).toBe('Raffles');
  });

  it('with FEES on, the ledger arrives newest-first with a computed balance', async () => {
    txMock.student.findFirst.mockResolvedValue(studentRow);
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { kind: 'DEBIT', _sum: { amountMinor: 2400000 } },
      { kind: 'CREDIT', _sum: { amountMinor: 1550000 } },
    ]);
    txMock.feeLedgerEntry.findMany.mockResolvedValue([
      { narration: 'Term II bill', occurredAt: new Date('2026-08-15'), kind: 'DEBIT', amountMinor: 850000 },
    ]);

    const svc = new StudentReportService(features(['MANAGEMENT', 'FEES']), press);
    const out = await svc.report(SCHOOL, 's1');

    expect(out.fees).toMatchObject({ billedMinor: 2400000, paidMinor: 1550000, dueMinor: 850000 });
    expect(out.fees!.ledger[0]!.narration).toBe('Term II bill');
  });
});

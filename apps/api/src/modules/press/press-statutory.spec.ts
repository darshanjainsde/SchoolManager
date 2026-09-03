const txMock = {
  student: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  attendance: { groupBy: jest.fn() },
  pressIssue: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
  feeLedgerEntry: { groupBy: jest.fn() },
  school: { findFirst: jest.fn() },
  schoolProfile: { findFirst: jest.fn() },
  mediaAsset: { findFirst: jest.fn() },
  reportWindow: { findMany: jest.fn() },
  classSection: { findMany: jest.fn() },
  printOrder: { findMany: jest.fn(), count: jest.fn() },
  $queryRaw: jest.fn(),
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { CertificateService } from './certificate.service';
import { PressOverviewService } from './press-overview.service';
import { ReportCardService } from './report-card.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const SECTION = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function studentRow(over: Record<string, unknown> = {}) {
  return {
    id: STUDENT, firstName: 'Meera', lastName: 'Rathore', admissionNo: 'ADM-0412', rollNo: '14',
    dob: new Date('2013-06-02'), gender: 'F', guardianName: 'S. Rathore', createdAt: new Date('2021-04-01'),
    fatherName: null, motherName: null, nationality: null, category: null,
    firstAdmissionDate: null, firstAdmissionClass: null, previousSchool: null, penId: null,
    classSection: { name: 'B', grade: { name: 'VII' } },
    ...over,
  };
}

const svc = new CertificateService(new ReportCardService());

beforeEach(() => {
  jest.clearAllMocks();
  withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
  txMock.school.findFirst.mockResolvedValue({ name: 'Rajmata' });
  txMock.schoolProfile.findFirst.mockResolvedValue(null);
  txMock.feeLedgerEntry.groupBy.mockResolvedValue([]);
  txMock.$queryRaw.mockResolvedValue([{ press_next_number: 7 }]);
  txMock.pressIssue.create.mockResolvedValue({ id: 'i1', serial: 'TC/2026/0007', issuedAt: new Date() });
  txMock.academicYear.findFirst.mockResolvedValue(null);
  txMock.attendance.groupBy.mockResolvedValue([]);
});

describe('the asked-once file — save-back on issue', () => {
  it('writes drawer-supplied file facts to the Student row, and only the ones that changed', async () => {
    txMock.student.findFirst.mockResolvedValue(studentRow({ nationality: 'Indian' }));
    txMock.student.update.mockResolvedValue(studentRow({
      nationality: 'Indian', fatherName: 'Ram Rathore', category: 'OBC', firstAdmissionDate: new Date('2019-04-02'),
    }));

    await svc.issue(SCHOOL, {
      studentId: STUDENT, type: 'TC',
      fatherName: ' Ram Rathore ', category: 'OBC',
      nationality: 'Indian', // unchanged — must NOT be in the update
      firstAdmissionDate: '2019-04-02',
    } as never, USER);

    const data = txMock.student.update.mock.calls[0]![0].data;
    expect(data.fatherName).toBe('Ram Rathore'); // trimmed
    expect(data.category).toBe('OBC');
    expect(data.firstAdmissionDate).toEqual(new Date('2019-04-02'));
    expect('nationality' in data).toBe(false);
  });

  it('touches nothing when the drawer adds no file facts', async () => {
    txMock.student.findFirst.mockResolvedValue(studentRow());
    await svc.issue(SCHOOL, { studentId: STUDENT, type: 'BONAFIDE', purpose: 'bank account' } as never, USER);
    expect(txMock.student.update).not.toHaveBeenCalled();
  });

  it('snapshots the statutory answers verbatim — the paper is the record', async () => {
    txMock.student.findFirst.mockResolvedValue(studentRow());
    await svc.issue(SCHOOL, {
      studentId: STUDENT, type: 'TC',
      examLastTaken: 'Term I, School — passed', qualifiedForPromotion: 'Yes', promotedToClass: 'VIII',
      workingDays: '96', presentDays: '88', nccScout: 'Girl Guide',
    } as never, USER);

    const payload = txMock.pressIssue.create.mock.calls[0]![0].data.payload;
    expect(payload.fields).toMatchObject({
      examLastTaken: 'Term I, School — passed', qualifiedForPromotion: 'Yes',
      promotedToClass: 'VIII', workingDays: '96', presentDays: '88', nccScout: 'Girl Guide',
    });
  });
});

describe('prepare — Annexure prefills', () => {
  it('computes working days / present for the current academic year, LATE counted present', async () => {
    txMock.student.findFirst.mockResolvedValue(studentRow());
    txMock.pressIssue.findMany.mockResolvedValue([]);
    txMock.academicYear.findFirst.mockResolvedValue({ startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') });
    txMock.attendance.groupBy.mockResolvedValue([
      { status: 'PRESENT', _count: { _all: 80 } },
      { status: 'LATE', _count: { _all: 8 } },
      { status: 'ABSENT', _count: { _all: 8 } },
    ]);

    const out = await svc.prepare(SCHOOL, STUDENT);
    expect(out.attendance).toEqual({ workingDays: 96, presentDays: 88 });
    expect(out.student.fatherName).toBeNull(); // the drawer shows the blank to fill
  });
});

describe('bulk certificates — one class, one run', () => {
  const dto = { type: 'TC', classSectionId: SECTION } as never;

  it('walks the roster in roll order; dues skip one child, an existing TC skips another, the rest issue', async () => {
    txMock.student.findMany.mockResolvedValue([
      { id: 's3', firstName: 'Kabir', lastName: 'Jain', rollNo: '11' },
      { id: 's1', firstName: 'Aarav', lastName: 'Sharma', rollNo: '3' },
      { id: 's2', firstName: 'Meera', lastName: 'Rathore', rollNo: '7' },
    ]);
    // per-student: s1 clean, s2 owes, s3 already holds a TC
    txMock.pressIssue.findFirst.mockImplementation(({ where }: { where: { studentId: string } }) =>
      Promise.resolve(where.studentId === 's3' ? { serial: 'TC/2026/0002' } : null));
    txMock.student.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(studentRow({ id: where.id })));
    txMock.feeLedgerEntry.groupBy.mockImplementation(({ where }: { where: { studentId: string } }) =>
      Promise.resolve(where.studentId === 's2' ? [{ kind: 'DEBIT', _sum: { amountMinor: 500000 } }] : []));
    txMock.pressIssue.create.mockImplementation(({ data }: { data: { studentId: string } }) =>
      Promise.resolve({ id: `i-${data.studentId}`, serial: 'TC/2026/0007', issuedAt: new Date() }));

    const out = await svc.bulkIssue(SCHOOL, dto, USER);

    // Roll order: 3, 7, 11 — the run reads like the register will.
    expect(out.issued.map((i) => i.studentId)).toEqual(['s1']);
    expect(out.issued[0]!.snapshot.kind).toBe('CERTIFICATE');
    expect(out.skipped).toEqual([
      { studentId: 's2', name: 'Meera Rathore', reason: 'fees outstanding' },
      { studentId: 's3', name: 'Kabir Jain', reason: 'already holds TC/2026/0002 — void it first to reissue' },
    ]);
  });

  it('duesOverride carries into every snapshot of the run', async () => {
    txMock.student.findMany.mockResolvedValue([{ id: 's2', firstName: 'Meera', lastName: 'Rathore', rollNo: '7' }]);
    txMock.pressIssue.findFirst.mockResolvedValue(null);
    txMock.student.findFirst.mockResolvedValue(studentRow({ id: 's2' }));
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([{ kind: 'DEBIT', _sum: { amountMinor: 500000 } }]);

    const out = await svc.bulkIssue(SCHOOL, { ...( dto as object), duesOverride: true } as never, USER);
    expect(out.issued).toHaveLength(1);
    expect(out.issued[0]!.snapshot.duesOverride).toBe(true);
    expect(out.issued[0]!.snapshot.duesMinor).toBe(500000);
  });

  it('bonafides never gate on dues and never skip for an existing one — the season needs many', async () => {
    txMock.student.findMany.mockResolvedValue([{ id: 's2', firstName: 'Meera', lastName: 'Rathore', rollNo: '7' }]);
    txMock.student.findFirst.mockResolvedValue(studentRow({ id: 's2' }));
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([{ kind: 'DEBIT', _sum: { amountMinor: 500000 } }]);

    const out = await svc.bulkIssue(SCHOOL, { type: 'BONAFIDE', classSectionId: SECTION, purpose: 'scholarship' } as never, USER);
    expect(out.issued).toHaveLength(1);
    expect(txMock.pressIssue.findFirst).not.toHaveBeenCalled(); // no TC-uniqueness read
  });
});

describe('PressOverviewService — the scoreboard read', () => {
  const overview = new PressOverviewService();

  it('counts issued per class for the chosen window and carries the live drawer facts', async () => {
    txMock.reportWindow.findMany.mockResolvedValue([{
      id: 'w1', name: 'Term I', academicYearId: 'y1', academicYear: { name: '2026-27' },
      startDate: new Date('2026-06-01'), endDate: new Date('2026-09-30'),
    }]);
    txMock.classSection.findMany.mockResolvedValue([
      { id: 'c1', name: 'B', grade: { name: 'VII', order: 7 } },
      { id: 'c2', name: 'A', grade: { name: 'III', order: 3 } },
    ]);
    txMock.student.groupBy.mockResolvedValue([
      { classSectionId: 'c1', _count: { _all: 22 } },
      { classSectionId: 'c2', _count: { _all: 27 } },
    ]);
    txMock.pressIssue.findMany.mockResolvedValue([
      { student: { classSectionId: 'c1' } }, { student: { classSectionId: 'c1' } },
    ]);
    txMock.pressIssue.findFirst
      .mockResolvedValueOnce({ serial: 'REP/2026/0212' })  // register last
      .mockResolvedValueOnce({ serial: 'TC/2026/0041' });  // certificate last
    txMock.printOrder.findMany.mockResolvedValue([{ quotePriceMinor: 180000 }]);
    txMock.printOrder.count.mockResolvedValue(3);
    txMock.pressIssue.count.mockResolvedValueOnce(9).mockResolvedValueOnce(684);

    const out = await overview.overview(SCHOOL);

    expect(out.windowId).toBe('w1');
    // Grade order: III before VII — the scoreboard reads like the school does.
    expect(out.classes).toEqual([
      { id: 'c2', label: 'III-A', students: 27, issued: 0 },
      { id: 'c1', label: 'VII-B', students: 22, issued: 2 },
    ]);
    expect(out.register).toEqual({ total: 684, lastSerial: 'REP/2026/0212' });
    expect(out.certificates).toEqual({ lastSerial: 'TC/2026/0041', thisYear: 9 });
    expect(out.orders).toEqual({ awaitingConfirm: 1, quotedTotalMinor: 180000, open: 3 });
  });

  it('a fresh school answers an empty scoreboard, not an error', async () => {
    txMock.reportWindow.findMany.mockResolvedValue([]);
    txMock.classSection.findMany.mockResolvedValue([]);
    txMock.student.groupBy.mockResolvedValue([]);
    txMock.pressIssue.findFirst.mockResolvedValue(null);
    txMock.printOrder.findMany.mockResolvedValue([]);
    txMock.printOrder.count.mockResolvedValue(0);
    txMock.pressIssue.count.mockResolvedValue(0);

    const out = await overview.overview(SCHOOL);
    expect(out.windowId).toBeNull();
    expect(out.classes).toEqual([]);
    expect(out.orders.awaitingConfirm).toBe(0);
  });
});

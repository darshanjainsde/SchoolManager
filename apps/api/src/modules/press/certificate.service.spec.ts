const txMock = {
  student: { findFirst: jest.fn() },
  pressIssue: { findMany: jest.fn(), create: jest.fn() },
  feeLedgerEntry: { groupBy: jest.fn() },
  school: { findFirst: jest.fn() },
  schoolProfile: { findFirst: jest.fn() },
  mediaAsset: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
// Spread the real module — isP2002 needs the real Prisma namespace
// (ledger: api-jest-db-mock-nukes-enums).
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { CertificateService } from './certificate.service';
import { ReportCardService, seriesYear } from './report-card.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STUDENT = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const studentRow = {
  id: STUDENT,
  firstName: 'Meera',
  lastName: 'Rathore',
  admissionNo: 'ADM-0412',
  rollNo: '14',
  dob: new Date('2013-02-11'),
  gender: 'F',
  guardianName: 'Vikram Rathore',
  createdAt: new Date('2019-04-04'),
  classSection: { name: 'B', grade: { name: 'VIII' } },
};

describe('CertificateService', () => {
  const svc = new CertificateService(new ReportCardService());

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.student.findFirst.mockResolvedValue(studentRow);
    txMock.pressIssue.findMany.mockResolvedValue([]);
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([]);
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School' });
    txMock.schoolProfile.findFirst.mockResolvedValue({
      logoAssetId: null, addressLine1: '12 MG Road', city: 'Jaipur', region: 'Rajasthan',
      phone: '0141-2222', email: 'office@raffles.in',
    });
    txMock.mediaAsset.findFirst.mockResolvedValue(null);
    txMock.$queryRaw.mockResolvedValue([{ press_next_number: 1 }]);
    txMock.pressIssue.create.mockImplementation(({ data }: { data: { serial: string } }) =>
      Promise.resolve({ id: 'issue-1', serial: data.serial, issuedAt: new Date('2026-09-02T05:00:00Z') }),
    );
  });

  // ── prepare ───────────────────────────────────────────────────────────────

  it('prefills the form from the record, dues from the ledger', async () => {
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { kind: 'DEBIT', _sum: { amountMinor: 850000 } },
      { kind: 'CREDIT', _sum: { amountMinor: 600000 } },
    ]);

    const out = await svc.prepare(SCHOOL, STUDENT);

    expect(out.student).toMatchObject({
      name: 'Meera Rathore', classLabel: 'VIII-B', dob: '2013-02-11', onRollSince: '2019-04-04',
    });
    expect(out.duesMinor).toBe(250000);
  });

  it('reads an empty ledger as zero dues — schools that keep fees elsewhere are never blocked', async () => {
    const out = await svc.prepare(SCHOOL, STUDENT);
    expect(out.duesMinor).toBe(0);
  });

  it('404s on a student the tenant cannot see', async () => {
    txMock.student.findFirst.mockResolvedValue(null);
    await expect(svc.prepare(SCHOOL, STUDENT)).rejects.toMatchObject({ status: 404 });
  });

  // ── the dues gate ─────────────────────────────────────────────────────────

  it('refuses a TC while fees are outstanding', async () => {
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { kind: 'DEBIT', _sum: { amountMinor: 850000 } },
    ]);

    await expect(
      svc.issue(SCHOOL, { studentId: STUDENT, type: 'TC' }, USER),
    ).rejects.toMatchObject({ status: 409, response: { code: 'DUES_OUTSTANDING' } });
    expect(txMock.pressIssue.create).not.toHaveBeenCalled();
  });

  it('issues a TC over dues only on explicit override, and the register remembers both', async () => {
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { kind: 'DEBIT', _sum: { amountMinor: 850000 } },
    ]);

    await svc.issue(SCHOOL, { studentId: STUDENT, type: 'TC', duesOverride: true }, USER);

    const created = txMock.pressIssue.create.mock.calls[0]![0].data;
    expect(created.payload).toMatchObject({ duesMinor: 850000, duesOverride: true });
  });

  it('never gates a bonafide on dues — it certifies enrolment, not accounts', async () => {
    txMock.feeLedgerEntry.groupBy.mockResolvedValue([
      { kind: 'DEBIT', _sum: { amountMinor: 850000 } },
    ]);

    const out = await svc.issue(SCHOOL, { studentId: STUDENT, type: 'BONAFIDE' }, USER);

    expect(out.serial).toBe(`BC/${seriesYear(new Date())}/0001`);
    // The snapshot still records the balance; only the GATE is TC-specific.
    const created = txMock.pressIssue.create.mock.calls[0]![0].data;
    expect(created.payload).toMatchObject({ duesMinor: 850000, duesOverride: false });
  });

  // ── defaults & snapshot ───────────────────────────────────────────────────

  it('fills the wording a clerk would: conduct good, class from the roll, attended-from from the record', async () => {
    await svc.issue(SCHOOL, { studentId: STUDENT, type: 'CHARACTER' }, USER);

    const created = txMock.pressIssue.create.mock.calls[0]![0].data;
    expect(created.type).toBe('CHARACTER');
    expect(created.serial).toBe(`CC/${seriesYear(new Date())}/0001`);
    expect(created.windowId).toBeUndefined(); // certificates carry no window
    expect(created.payload).toMatchObject({
      kind: 'CERTIFICATE',
      type: 'CHARACTER',
      school: { name: 'Raffles Public School', addressLine: '12 MG Road, Jaipur, Rajasthan' },
      fields: { conduct: 'good', classLabel: 'VIII-B', fromDate: '2019-04-04' },
    });
  });

  it('keeps the office’s own wording when given', async () => {
    await svc.issue(
      SCHOOL,
      {
        studentId: STUDENT, type: 'TC',
        conduct: 'excellent', reason: "Parent's transfer", toDate: '2026-03-31', classLabel: 'Class VIII',
      },
      USER,
    );

    const created = txMock.pressIssue.create.mock.calls[0]![0].data;
    expect(created.payload).toMatchObject({
      fields: {
        conduct: 'excellent', reason: "Parent's transfer",
        toDate: '2026-03-31', classLabel: 'Class VIII', fromDate: '2019-04-04',
      },
    });
  });

  it('pads serials to four digits so the register sorts as a book would', async () => {
    txMock.$queryRaw.mockResolvedValue([{ press_next_number: 41 }]);
    const out = await svc.issue(SCHOOL, { studentId: STUDENT, type: 'TC' }, USER);
    expect(out.serial).toBe(`TC/${seriesYear(new Date())}/0041`);
  });
});

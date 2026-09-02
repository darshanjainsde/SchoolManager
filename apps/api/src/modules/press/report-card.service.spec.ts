const txMock = {
  reportWindow: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  reportRemark: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  classSection: { findFirst: jest.fn() },
  student: { findMany: jest.fn(), findFirst: jest.fn() },
  exam: { findMany: jest.fn() },
  result: { findMany: jest.fn(), count: jest.fn() },
  subject: { findMany: jest.fn() },
  attendance: { groupBy: jest.fn() },
  pressIssue: { findMany: jest.fn(), create: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
  school: { findFirst: jest.fn() },
  schoolProfile: { findFirst: jest.fn() },
  mediaAsset: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
// Spread the real module: `isP2002` does `instanceof Prisma.PrismaClientKnownRequestError`,
// and a bare mock nukes the Prisma namespace (see ledger: api-jest-db-mock-nukes-enums).
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { Prisma } from '@skoolos/db';
import { ReportCardService, rollOrder, seriesYear } from './report-card.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WINDOW = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SECTION = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const YEAR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const USER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const windowRow = {
  id: WINDOW,
  academicYearId: YEAR,
  name: 'Term I',
  startDate: new Date('2026-04-01'),
  endDate: new Date('2026-09-30'),
  academicYear: { name: '2026-27' },
  _count: { issues: 0 },
};
const sectionRow = {
  id: SECTION,
  name: 'B',
  grade: { name: 'VII' },
  classTeacher: { firstName: 'Sunita', lastName: 'Joshi' },
};

function student(id: string, first: string, roll: string | null) {
  return {
    id, firstName: first, lastName: 'Sharma', rollNo: roll,
    admissionNo: `ADM-${id.slice(0, 4)}`, dob: null, guardianName: null,
  };
}

describe('ReportCardService', () => {
  const svc = new ReportCardService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.reportWindow.findFirst.mockResolvedValue(windowRow);
    txMock.classSection.findFirst.mockResolvedValue(sectionRow);
    txMock.student.findMany.mockResolvedValue([]);
    txMock.exam.findMany.mockResolvedValue([]);
    txMock.result.findMany.mockResolvedValue([]);
    txMock.result.count.mockResolvedValue(0);
    txMock.subject.findMany.mockResolvedValue([]);
    txMock.attendance.groupBy.mockResolvedValue([]);
    txMock.reportRemark.findMany.mockResolvedValue([]);
    txMock.pressIssue.findMany.mockResolvedValue([]);
    txMock.pressIssue.count.mockResolvedValue(0);
    txMock.pressIssue.groupBy.mockResolvedValue([]);
    txMock.school.findFirst.mockResolvedValue({ name: 'Raffles Public School' });
    txMock.schoolProfile.findFirst.mockResolvedValue(null);
    txMock.mediaAsset.findFirst.mockResolvedValue(null);
  });

  // ── compile ────────────────────────────────────────────────────────────────

  it('sums a subject across every exam in the window and grades the total', async () => {
    txMock.student.findMany.mockResolvedValue([student('s1', 'Aarav', '1')]);
    txMock.exam.findMany.mockResolvedValue([
      { id: 'e1', subjectId: 'maths', maxMarks: 20 },
      { id: 'e2', subjectId: 'maths', maxMarks: 80 },
    ]);
    txMock.subject.findMany.mockResolvedValue([{ id: 'maths', name: 'Mathematics' }]);
    txMock.result.findMany.mockResolvedValue([
      { examId: 'e1', studentId: 's1', marks: 18 },
      { examId: 'e2', studentId: 's1', marks: 73 },
    ]);

    const batch = await svc.compileBatch(SCHOOL, WINDOW, SECTION);
    const line = batch.students[0]!.subjects[0]!;

    expect(line).toMatchObject({
      subjectName: 'Mathematics', examCount: 2, marks: 91, maxMarks: 100, pct: 91, grade: 'A1',
    });
    expect(batch.students[0]!.overall).toMatchObject({ marks: 91, maxMarks: 100, pct: 91, grade: 'A1' });
    expect(batch.classSection.label).toBe('VII-B');
  });

  it('renders "no data" as null, never as a zero or an E', async () => {
    // Meera has NO result rows at all for Maths — she was absent, or the marks
    // were never entered. Either way the card must say "—": grading an absence
    // as 0/E on a printed document a family keeps is the one unforgivable bug
    // in this service.
    txMock.student.findMany.mockResolvedValue([student('s2', 'Meera', '2')]);
    txMock.exam.findMany.mockResolvedValue([{ id: 'e1', subjectId: 'maths', maxMarks: 100 }]);
    txMock.subject.findMany.mockResolvedValue([{ id: 'maths', name: 'Mathematics' }]);
    txMock.result.findMany.mockResolvedValue([]);
    txMock.result.count.mockResolvedValue(0);

    const batch = await svc.compileBatch(SCHOOL, WINDOW, SECTION);
    const line = batch.students[0]!.subjects[0]!;

    expect(line.marks).toBeNull();
    expect(line.grade).toBeNull();
    expect(line.pct).toBeNull();
    expect(line.maxMarks).toBe(100); // still shows what the subject was out of
    expect(batch.students[0]!.overall.grade).toBeNull();
  });

  it('measures a partial attempt against only the papers actually sat', async () => {
    txMock.student.findMany.mockResolvedValue([student('s1', 'Aarav', '1')]);
    txMock.exam.findMany.mockResolvedValue([
      { id: 'e1', subjectId: 'sci', maxMarks: 20 },
      { id: 'e2', subjectId: 'sci', maxMarks: 80 },
    ]);
    txMock.subject.findMany.mockResolvedValue([{ id: 'sci', name: 'Science' }]);
    // Sat the 20-mark test, missed the 80-mark one: 15/20, not 15/100.
    txMock.result.findMany.mockResolvedValue([{ examId: 'e1', studentId: 's1', marks: 15 }]);

    const batch = await svc.compileBatch(SCHOOL, WINDOW, SECTION);
    const line = batch.students[0]!.subjects[0]!;

    expect(line).toMatchObject({ marks: 15, maxMarks: 20, pct: 75, grade: 'B1' });
  });

  it('counts LATE as present and yields null attendance when nothing was marked', async () => {
    txMock.student.findMany.mockResolvedValue([student('s1', 'Aarav', '1'), student('s2', 'Meera', '2')]);
    txMock.attendance.groupBy.mockResolvedValue([
      { studentId: 's1', status: 'PRESENT', _count: { _all: 80 } },
      { studentId: 's1', status: 'LATE', _count: { _all: 10 } },
      { studentId: 's1', status: 'ABSENT', _count: { _all: 10 } },
      // s2 has no attendance rows at all.
    ]);

    const batch = await svc.compileBatch(SCHOOL, WINDOW, SECTION);

    expect(batch.students[0]!.attendance).toEqual({ present: 90, total: 100, pct: 90 });
    // Zero marked days is "no data", not 0% — NaN here once printed would be
    // a card saying the child never came to school.
    expect(batch.students[1]!.attendance).toEqual({ present: 0, total: 0, pct: null });
  });

  it('sorts roll 8 before roll 10 — rolls are numbers to people', async () => {
    txMock.student.findMany.mockResolvedValue([
      student('s10', 'Kavya', '10'), student('s8', 'Rohan', '8'), student('sx', 'Zara', null),
    ]);

    const batch = await svc.compileBatch(SCHOOL, WINDOW, SECTION);

    expect(batch.students.map((s) => s.rollNo)).toEqual(['8', '10', null]);
  });

  it('compiles from PUBLISHED results only, and tells the office how many are held back', async () => {
    // The portal's invariant: draft marks never reach a family. The compile
    // must carry the same filter, and the batch must SAY how many marks are
    // sitting unpublished — a dash from a draft looks identical to a dash
    // from absence, and the office deserves to know which it is.
    txMock.student.findMany.mockResolvedValue([student('s1', 'Aarav', '1')]);
    txMock.exam.findMany.mockResolvedValue([{ id: 'e1', subjectId: 'maths', maxMarks: 100 }]);
    txMock.subject.findMany.mockResolvedValue([{ id: 'maths', name: 'Mathematics' }]);
    txMock.result.count.mockResolvedValue(3);

    const batch = await svc.compileBatch(SCHOOL, WINDOW, SECTION);

    expect(batch.unpublishedCount).toBe(3);
    const where = txMock.result.findMany.mock.calls[0]![0].where;
    expect(where.publishedAt).toEqual({ not: null });
    const countWhere = txMock.result.count.mock.calls[0]![0].where;
    expect(countWhere.publishedAt).toBeNull();
  });

  it('bounds the window in IST, not UTC — a 2 AM exam belongs to ITS day', async () => {
    txMock.student.findMany.mockResolvedValue([student('s1', 'Aarav', '1')]);
    await svc.compileBatch(SCHOOL, WINDOW, SECTION);

    const where = txMock.exam.findMany.mock.calls[0]![0].where;
    // Window 2026-04-01 → 2026-09-30 (DATE columns land as UTC midnight).
    // IST day 1 Apr starts 31 Mar 18:30 UTC; the day AFTER 30 Sep starts
    // 30 Sep 18:30 UTC — the exclusive bound.
    expect(where.scheduledAt.gte.toISOString()).toBe('2026-03-31T18:30:00.000Z');
    expect(where.scheduledAt.lt.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('rounds float mark sums to one decimal at compile time', async () => {
    txMock.student.findMany.mockResolvedValue([student('s1', 'Aarav', '1')]);
    txMock.exam.findMany.mockResolvedValue([
      { id: 'e1', subjectId: 'sci', maxMarks: 50 },
      { id: 'e2', subjectId: 'sci', maxMarks: 50 },
    ]);
    txMock.subject.findMany.mockResolvedValue([{ id: 'sci', name: 'Science' }]);
    // 36.7 + 42.1 = 78.80000000000001 in floats — the artifact must never
    // leave the compile.
    txMock.result.findMany.mockResolvedValue([
      { examId: 'e1', studentId: 's1', marks: 36.7 },
      { examId: 'e2', studentId: 's1', marks: 42.1 },
    ]);

    const batch = await svc.compileBatch(SCHOOL, WINDOW, SECTION);

    expect(batch.students[0]!.subjects[0]!.marks).toBe(78.8);
    expect(batch.students[0]!.overall.marks).toBe(78.8);
  });

  it('404s on a window that is not this school’s', async () => {
    txMock.reportWindow.findFirst.mockResolvedValue(null);
    await expect(svc.compileBatch(SCHOOL, WINDOW, SECTION)).rejects.toMatchObject({ status: 404 });
  });

  // ── windows ───────────────────────────────────────────────────────────────

  it('refuses a window that ends before it starts', async () => {
    await expect(
      svc.saveWindow(SCHOOL, { academicYearId: YEAR, name: 'Term I', startDate: '2026-09-30', endDate: '2026-04-01' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('404s an update to a window the tenant cannot see — never a 500', async () => {
    txMock.academicYear.findFirst.mockResolvedValue({ id: YEAR, name: '2026-27' });
    txMock.reportWindow.findFirst.mockResolvedValue(null); // RLS hid it
    await expect(
      svc.saveWindow(SCHOOL, { id: WINDOW, academicYearId: YEAR, name: 'Term I', startDate: '2026-04-01', endDate: '2026-09-30' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(txMock.reportWindow.update).not.toHaveBeenCalled();
  });

  it('refuses an academic year the tenant cannot see', async () => {
    txMock.academicYear.findFirst.mockResolvedValue(null);
    await expect(
      svc.saveWindow(SCHOOL, { academicYearId: YEAR, name: 'Term I', startDate: '2026-04-01', endDate: '2026-09-30' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  // ── remarks ───────────────────────────────────────────────────────────────

  it('clears a remark when the text is emptied, rather than storing a blank sentence', async () => {
    txMock.reportWindow.findFirst.mockResolvedValue({ id: WINDOW });
    txMock.student.findFirst.mockResolvedValue({ id: 's1' });

    await svc.saveRemark(SCHOOL, { windowId: WINDOW, studentId: 's1', text: '   ' }, USER);

    expect(txMock.reportRemark.deleteMany).toHaveBeenCalledWith({ where: { windowId: WINDOW, studentId: 's1' } });
    expect(txMock.reportRemark.upsert).not.toHaveBeenCalled();
  });

  it('refuses a remark for a student the tenant cannot see', async () => {
    txMock.reportWindow.findFirst.mockResolvedValue({ id: WINDOW });
    txMock.student.findFirst.mockResolvedValue(null);
    await expect(
      svc.saveRemark(SCHOOL, { windowId: WINDOW, studentId: 's1', text: 'Good' }, USER),
    ).rejects.toMatchObject({ status: 404 });
  });

  // ── issue ─────────────────────────────────────────────────────────────────

  function primeIssuableClass() {
    txMock.student.findMany
      .mockResolvedValueOnce([student('s1', 'Aarav', '1'), student('s2', 'Meera', '2')]) // compile
      .mockResolvedValueOnce([ // snapshot extras
        { id: 's1', dob: new Date('2014-06-01'), guardianName: 'Vikram Sharma' },
        { id: 's2', dob: null, guardianName: null },
      ]);
    txMock.exam.findMany.mockResolvedValue([{ id: 'e1', subjectId: 'maths', maxMarks: 100 }]);
    txMock.subject.findMany.mockResolvedValue([{ id: 'maths', name: 'Mathematics' }]);
    txMock.result.findMany.mockResolvedValue([
      { examId: 'e1', studentId: 's1', marks: 91 },
      { examId: 'e1', studentId: 's2', marks: 62 },
    ]);
    txMock.$queryRaw.mockResolvedValueOnce([{ press_next_number: 1 }]).mockResolvedValueOnce([{ press_next_number: 2 }]);
    txMock.pressIssue.create.mockResolvedValue({});
  }

  it('issues one serial + one snapshot per student and reports both lists', async () => {
    primeIssuableClass();

    const out = await svc.issueBatch(SCHOOL, { windowId: WINDOW, classSectionId: SECTION }, USER);

    const year = seriesYear(new Date());
    expect(out.issued).toEqual([
      { studentId: 's1', serial: `RC/${year}/0001` },
      { studentId: 's2', serial: `RC/${year}/0002` },
    ]);
    expect(out.skipped).toEqual([]);

    // The snapshot is the whole printed card — grades computed, remark carried,
    // window linked for idempotency.
    const created = txMock.pressIssue.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ type: 'REPORT_CARD', windowId: WINDOW, studentId: 's1', issuedById: USER });
    expect(created.payload).toMatchObject({
      kind: 'REPORT_CARD',
      classLabel: 'VII-B',
      windowName: 'Term I',
      student: { name: 'Aarav Sharma', guardianName: 'Vikram Sharma', dob: '2014-06-01' },
      overall: { grade: 'A1' },
    });
  });

  it('skips an already-issued card instead of minting a second serial', async () => {
    primeIssuableClass();
    txMock.pressIssue.findMany.mockResolvedValue([
      { studentId: 's1', serial: 'RC/2026/0001', issuedAt: new Date('2026-09-01') },
    ]);

    const out = await svc.issueBatch(SCHOOL, { windowId: WINDOW, classSectionId: SECTION }, USER);

    expect(out.issued.map((i) => i.studentId)).toEqual(['s2']);
    expect(out.skipped).toEqual([{ studentId: 's1', reason: 'Already issued (RC/2026/0001).' }]);
  });

  it('turns a concurrent duplicate (P2002) into a skip, not a crash', async () => {
    primeIssuableClass();
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['schoolId', 'type', 'windowId', 'studentId'] },
    });
    txMock.pressIssue.create.mockRejectedValueOnce(p2002).mockResolvedValueOnce({});

    const out = await svc.issueBatch(SCHOOL, { windowId: WINDOW, classSectionId: SECTION }, USER);

    expect(out.skipped).toEqual([
      { studentId: 's1', reason: 'Already issued by someone else just now.' },
    ]);
    expect(out.issued.map((i) => i.studentId)).toEqual(['s2']);
  });

  it('reports a SERIAL clash as a failure, never as "already issued"', async () => {
    primeIssuableClass();
    const serialClash = new Prisma.PrismaClientKnownRequestError('unique constraint', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['schoolId', 'type', 'serial'] },
    });
    txMock.pressIssue.create.mockRejectedValueOnce(serialClash).mockResolvedValueOnce({});

    const out = await svc.issueBatch(SCHOOL, { windowId: WINDOW, classSectionId: SECTION }, USER);

    // s1 got NO card — the response must not claim idempotent success.
    expect(out.skipped[0]!.reason).toMatch(/Serial clash/);
    expect(out.issued.map((i) => i.studentId)).toEqual(['s2']);
  });

  it('deduplicates requested studentIds instead of inventing an intruder', async () => {
    primeIssuableClass();
    const out = await svc.issueBatch(
      SCHOOL,
      { windowId: WINDOW, classSectionId: SECTION, studentIds: ['s1', 's1', 's2'] },
      USER,
    );
    expect(out.issued.map((i) => i.studentId)).toEqual(['s1', 's2']);
  });

  it('404s when a requested student is not in the class', async () => {
    txMock.student.findMany.mockResolvedValue([student('s1', 'Aarav', '1')]);
    await expect(
      svc.issueBatch(SCHOOL, { windowId: WINDOW, classSectionId: SECTION, studentIds: ['s1', 'intruder'] }, USER),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('rollOrder', () => {
  it('orders numerically, letters last, and never crashes on nulls', () => {
    const rows = [
      { rollNo: '10', name: 'K' }, { rollNo: '8', name: 'R' },
      { rollNo: null, name: 'Z' }, { rollNo: 'A-2', name: 'B' },
    ];
    // Non-numeric rolls (letters, none) sort together AFTER numbers, by name.
    expect(rows.sort(rollOrder).map((r) => r.rollNo)).toEqual(['8', '10', 'A-2', null]);
  });

  it("an empty-string roll is no roll — it must not coerce to 0 and jump the queue", () => {
    const rows = [
      { rollNo: '', name: 'Blank' }, { rollNo: '3', name: 'Three' },
    ];
    expect(rows.sort(rollOrder).map((r) => r.name)).toEqual(['Three', 'Blank']);
  });
});

describe('seriesYear', () => {
  it('uses the IST calendar, not the server’s', () => {
    // 20:00 UTC on 31 Dec is 01:30 on 1 Jan in India.
    expect(seriesYear(new Date('2026-12-31T20:00:00Z'))).toBe(2027);
    expect(seriesYear(new Date('2026-06-15T12:00:00Z'))).toBe(2026);
  });
});

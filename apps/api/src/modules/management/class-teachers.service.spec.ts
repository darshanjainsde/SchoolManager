import 'reflect-metadata';

/**
 * The class-teacher desk. The interesting behaviour is all at the edges: a
 * teacher who has left, a teacher holding two sections, and the year-start
 * copy that must not carry a ghost into the new session.
 */
const txMock = {
  academicYear: { findFirst: jest.fn() },
  classSection: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
  teacher: { findMany: jest.fn(), findFirst: jest.fn() },
  classTeacherAssignment: { updateMany: jest.fn(), create: jest.fn() },
  // Roll sizes come from a tenant-scoped groupBy now, not a relation _count.
  student: { groupBy: jest.fn(), count: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { ClassTeachersService } from './class-teachers.service';
import { ApiError } from '../../common/errors/api-error';

/** ApiError is an HttpException: the code lives in the RESPONSE BODY, not on the instance. */
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try { await p; } catch (e) { return (((e as ApiError).getResponse?.() ?? {}) as { code?: string }).code ?? ''; }
  throw new Error('expected that to be refused');
};

const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const YEAR = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: '2026-27' };
const PRIYA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const IRFAN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const section = (id: string, grade: string, name: string, order: number, classTeacherId: string | null) => ({
  id, name, classTeacherId, grade: { name: grade, order },
});

/**
 * `classSection.findFirst` is called twice on the write path with two
 * different selects — the guard reads the academic year, the read-back reads
 * the grade — and ONE mock serves both. So the fixture carries the widest
 * shape, not the narrower of the two: a fixture shaped to the first caller
 * makes the second crash on a field the real row has.
 */
const oneSection = (classTeacherId: string | null) => ({
  ...section('s1', 'LKG', 'A', 1, classTeacherId),
  academicYearId: YEAR.id,
});

let svc: ClassTeachersService;
beforeEach(() => {
  jest.clearAllMocks();
  svc = new ClassTeachersService();
  txMock.academicYear.findFirst.mockImplementation(({ where }: { where: { isCurrent?: boolean } }) =>
    Promise.resolve(where.isCurrent ? YEAR : null));
  txMock.teacher.findMany.mockResolvedValue([
    { id: PRIYA, firstName: 'Priya', lastName: 'Nair' },
    { id: IRFAN, firstName: 'Mohammed Irfan', lastName: 'Qureshi' },
  ]);
  txMock.classSection.count.mockResolvedValue(0);
  txMock.student.groupBy.mockResolvedValue([
    { classSectionId: 's1', _count: { _all: 28 } },
    { classSectionId: 's2', _count: { _all: 30 } },
  ]);
});

describe('the desk', () => {
  it('counts what is assigned, what is not, and who holds more than one', async () => {
    txMock.classSection.findMany.mockResolvedValue([
      section('s1', 'LKG', 'A', 1, PRIYA),
      section('s2', 'LKG', 'B', 1, PRIYA),
      section('s3', '7', 'B', 7, IRFAN),
      section('s4', 'Nursery', 'A', 0, null),
    ]);
    const desk = await svc.desk(SCHOOL);
    expect(desk.counts).toEqual({ sections: 4, assigned: 3, unassigned: 1, holdingMoreThanOne: 1 });
    // A section with no groupBy row means zero children, not a missing number.
    expect(desk.rows.find((r) => r.classSectionId === 's1')!.students).toBe(28);
    expect(desk.rows.find((r) => r.classSectionId === 's4')!.students).toBe(0);
    // The doubling is SAID, on the row, rather than refused.
    expect(desk.rows.find((r) => r.classSectionId === 's1')!.alsoHolds).toEqual(['LKG B']);
    expect(desk.rows.find((r) => r.classSectionId === 's3')!.alsoHolds).toEqual([]);
    expect(desk.rows.find((r) => r.classSectionId === 's4')!.teacher).toBeNull();
  });

  it('shows a section whose teacher has LEFT as unassigned, because that is what it is', async () => {
    // The teacher list is ACTIVE only; a stale id therefore resolves to nobody.
    txMock.classSection.findMany.mockResolvedValue([section('s1', '9', 'A', 9, 'a-teacher-who-left')]);
    const desk = await svc.desk(SCHOOL);
    expect(desk.rows[0].teacher).toBeNull();
    expect(desk.counts.unassigned).toBe(1);
  });

  it('says nothing about a session that does not exist, instead of inventing one', async () => {
    txMock.academicYear.findFirst.mockResolvedValue(null);
    const desk = await svc.desk(SCHOOL);
    expect(desk).toMatchObject({ academicYear: null, rows: [], counts: { sections: 0 } });
  });
});

describe('assigning', () => {
  beforeEach(() => {
    // The section is read TWICE inside one transaction: once to guard the
    // write, once to read the result back. A fixed fixture would answer the
    // second read with the state from before the write, so the mock holds the
    // value and `update` moves it — which is what the transaction does.
    let held: string | null = null;
    txMock.classSection.findFirst.mockImplementation(() => Promise.resolve(oneSection(held)));
    txMock.classSection.update.mockImplementation(({ data }: { data: { classTeacherId: string | null } }) => {
      held = data.classTeacherId;
      return Promise.resolve({});
    });
    // Also serves the read-back, which asks for the teacher's NAME.
    txMock.teacher.findFirst.mockResolvedValue({ id: PRIYA, status: 'ACTIVE', firstName: 'Priya', lastName: 'Nair' });
    txMock.student.count.mockResolvedValue(28);
    txMock.classSection.findMany.mockResolvedValue([section('s1', 'LKG', 'A', 1, PRIYA)]);
  });

  it('closes the standing record before opening the next, so the history is a sequence', async () => {
    await svc.assign(SCHOOL, 's1', PRIYA, ADMIN);
    expect(txMock.classTeacherAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ classSectionId: 's1', untilAt: null }) }),
    );
    expect(txMock.classTeacherAssignment.create.mock.calls[0][0].data).toMatchObject({ classSectionId: 's1', teacherId: PRIYA, changedById: ADMIN });
    expect(txMock.classSection.update.mock.calls[0][0].data).toEqual({ classTeacherId: PRIYA });
  });

  it('clearing one closes the record and opens none', async () => {
    let cleared = false;
    txMock.classSection.findFirst.mockImplementation(() => Promise.resolve(oneSection(cleared ? null : PRIYA)));
    txMock.classSection.update.mockImplementation(() => { cleared = true; return Promise.resolve({}); });
    txMock.classSection.findMany.mockResolvedValue([section('s1', 'LKG', 'A', 1, null)]);
    await svc.assign(SCHOOL, 's1', null, ADMIN);
    expect(txMock.classTeacherAssignment.updateMany).toHaveBeenCalled();
    expect(txMock.classTeacherAssignment.create).not.toHaveBeenCalled();
    expect(txMock.classSection.update.mock.calls[0][0].data).toEqual({ classTeacherId: null });
  });

  it('refuses a teacher who has left, and says why', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: PRIYA, status: 'LEFT' });
    await expect(codeOf(svc.assign(SCHOOL, 's1', PRIYA, ADMIN))).resolves.toBe('VALIDATION');
  });

  it('refuses a section from another school', async () => {
    txMock.classSection.findFirst.mockResolvedValue(null);
    await expect(svc.assign(SCHOOL, 's1', PRIYA, ADMIN)).rejects.toBeInstanceOf(ApiError);
  });

  it('reads back only the row it changed — never the whole desk again', async () => {
    await svc.assign(SCHOOL, 's1', PRIYA, ADMIN);
    // The desk read every section, every teacher, the previous session and the
    // whole roll, in a SECOND transaction, to return one row the screen throws
    // away. These three are the desk's fingerprint and nothing else uses them:
    // the roll of active teachers, the roll counts, and the session lookup. If
    // any of them runs here, the write is doing the desk's work twice on every
    // dropdown change. (`classSection.findMany` is NOT on this list — the
    // read-back uses it, scoped to the one teacher, to say what else they hold.)
    expect(txMock.teacher.findMany).not.toHaveBeenCalled();
    expect(txMock.student.groupBy).not.toHaveBeenCalled();
    expect(txMock.academicYear.findFirst).not.toHaveBeenCalled();
    const sectionScans = txMock.classSection.findMany.mock.calls;
    expect(sectionScans).toHaveLength(1);
    expect(sectionScans[0][0].where).toMatchObject({ classTeacherId: PRIYA });
  });

  it('returns the changed row, named and counted', async () => {
    const row = await svc.assign(SCHOOL, 's1', PRIYA, ADMIN);
    expect(row).toMatchObject({ classSectionId: 's1', label: 'LKG A', students: 28 });
    expect(row.teacher).toEqual({ id: PRIYA, name: 'Priya Nair' });
  });

  it('writes nothing when the teacher is already the one on the section', async () => {
    txMock.classSection.findFirst.mockResolvedValue(oneSection(PRIYA));
    await svc.assign(SCHOOL, 's1', PRIYA, ADMIN);
    expect(txMock.classSection.update).not.toHaveBeenCalled();
    expect(txMock.classTeacherAssignment.create).not.toHaveBeenCalled();
  });
});

describe('carrying last session forward', () => {
  it('matches by grade+section NAME, and drops a teacher who has left', async () => {
    txMock.classSection.findMany
      // last year, where somebody was assigned
      .mockResolvedValueOnce([
        { name: 'A', classTeacherId: PRIYA, grade: { name: '6' }, classTeacher: { id: PRIYA, status: 'ACTIVE' } },
        { name: 'B', classTeacherId: IRFAN, grade: { name: '6' }, classTeacher: { id: IRFAN, status: 'LEFT' } },
      ])
      // this year, the ones with nobody
      .mockResolvedValueOnce([
        { id: 'n1', name: 'A', grade: { name: '6' } },
        { id: 'n2', name: 'B', grade: { name: '6' } },
        { id: 'n3', name: 'C', grade: { name: '6' } },
      ]);
    const out = await svc.copyFrom(SCHOOL, 'last-year', ADMIN);
    expect(out).toEqual({ copied: 1, skippedLeft: 1, skippedNoMatch: 1 });
    expect(txMock.classSection.update).toHaveBeenCalledTimes(1);
    expect(txMock.classSection.update.mock.calls[0][0]).toMatchObject({ where: { id: 'n1' }, data: { classTeacherId: PRIYA } });
  });

  it('refuses to copy a session into itself', async () => {
    await expect(codeOf(svc.copyFrom(SCHOOL, YEAR.id, ADMIN))).resolves.toBe('VALIDATION');
  });
});

describe('the Bell number', () => {
  it('counts the sections of the CURRENT session with nobody', async () => {
    txMock.classSection.count.mockResolvedValue(6);
    await expect(svc.unassignedCount(SCHOOL)).resolves.toBe(6);
    expect(txMock.classSection.count.mock.calls[0][0].where).toMatchObject({ academicYearId: YEAR.id, classTeacherId: null });
  });

  it('is zero when no session is current, rather than counting every year at once', async () => {
    txMock.academicYear.findFirst.mockResolvedValue(null);
    await expect(svc.unassignedCount(SCHOOL)).resolves.toBe(0);
  });
});

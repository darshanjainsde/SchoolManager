import 'reflect-metadata';

const txMock = {
  classSection: { findUnique: jest.fn() },
  period: { findUnique: jest.fn(), findMany: jest.fn() },
  subject: { findUnique: jest.fn() },
  teacher: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  academicYear: { findUnique: jest.fn(), findFirst: jest.fn() },
  timetableSlot: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

// Keep the real `Prisma` export (prisma-errors.ts's isP2002 relies on
// `instanceof Prisma.PrismaClientKnownRequestError`); only `withTenant`
// itself is stubbed so no real DB connection is ever attempted.
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { TimetableService } from './timetable.service';
import { startOfIstDay } from './internal/timetable-date';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLASS_SECTION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PERIOD = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SUBJECT_OLD = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SUBJECT_NEW = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const TEACHER_OLD = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const TEACHER_NEW = '11111111-1111-1111-1111-111111111111';
const YEAR = '22222222-2222-2222-2222-222222222222';
const ACTIVE_SLOT_ID = '33333333-3333-3333-3333-333333333333';


/** Every ref lookup used by `assign`'s validation step resolves to "found". */
function mockValidRefs() {
  txMock.classSection.findUnique.mockResolvedValue({ id: CLASS_SECTION });
  txMock.period.findUnique.mockResolvedValue({ id: PERIOD });
  txMock.subject.findUnique.mockResolvedValue({ id: SUBJECT_NEW });
  txMock.teacher.findUnique.mockResolvedValue({ id: TEACHER_NEW });
  txMock.academicYear.findUnique.mockResolvedValue({ id: YEAR });
}

describe('TimetableService — versioned assign/unassign/read', () => {
  const svc = new TimetableService();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) =>
      fn(txMock),
    );
    mockValidRefs();
    txMock.timetableSlot.update.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // assign / unassign are a splice of dated versions now: every date case is
  // in internal/timetable-splice.spec.ts (pure), and the writes against a real
  // database — history kept, past weeks refused, clashes, this-week-only —
  // are in test/timetable-swap.e2e-spec.ts. Mocking their call sequence here
  // would only pin the implementation.

  describe('listForClass — as-of reads prove the past is immutable', () => {
    it('reading as of a date before the reassignment returns the OLD version', async () => {
      const oldVersionRow = { id: 'old-row', subjectId: SUBJECT_OLD, teacherId: TEACHER_OLD };
      txMock.timetableSlot.findMany.mockResolvedValue([oldVersionRow]);

      const result = await svc.listForClass(SCHOOL, CLASS_SECTION, '2026-07-01');

      const asOf = new Date('2026-07-01T00:00:00+05:30'); // midnight IST on the requested day
      expect(txMock.timetableSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            schoolId: SCHOOL,
            classSectionId: CLASS_SECTION,
            effectiveFrom: { lte: asOf },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
          }),
        }),
      );
      expect(result).toEqual([oldVersionRow]);
    });

    it('reading with no date param (defaults to today) returns the NEW version', async () => {
      const now = new Date('2026-07-22T11:00:00.000Z');
      jest.setSystemTime(now);
      const newVersionRow = { id: 'new-row', subjectId: SUBJECT_NEW, teacherId: TEACHER_NEW };
      txMock.timetableSlot.findMany.mockResolvedValue([newVersionRow]);

      const result = await svc.listForClass(SCHOOL, CLASS_SECTION);

      const today = startOfIstDay(now);
      expect(txMock.timetableSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            effectiveFrom: { lte: today },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: today } }],
          }),
        }),
      );
      expect(result).toEqual([newVersionRow]);
    });
  });

  describe('SLOT_INCLUDE carries grade on classSection', () => {
    // A section's bare `name` ("B") is ambiguous across grades; the caller
    // needs `grade.name` to compose "7-B" the same way TeacherDayService
    // does for the Today screen. Pinning the shape of `include` here means a
    // future edit that drops `grade` fails this test instead of silently
    // shipping two different class names on two screens.
    it('listForClass includes classSection.grade.name', async () => {
      txMock.timetableSlot.findMany.mockResolvedValue([]);

      await svc.listForClass(SCHOOL, CLASS_SECTION);

      expect(txMock.timetableSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            classSection: { select: { id: true, name: true, grade: { select: { name: true } } } },
          }),
        }),
      );
    });

    it('listForTeacher includes classSection.grade.name', async () => {
      txMock.teacher.findFirst = jest.fn().mockResolvedValue({ id: 'teacher-1' });
      txMock.timetableSlot.findMany.mockResolvedValue([]);

      await svc.listForTeacher(SCHOOL, 'user-1');

      expect(txMock.timetableSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            classSection: { select: { id: true, name: true, grade: { select: { name: true } } } },
          }),
        }),
      );
    });
  });

  describe('unassign', () => {
    it('throws NotFoundException when there is no active version for that id', async () => {
      txMock.timetableSlot.findFirst.mockResolvedValue(null);

      await expect(svc.unassign(SCHOOL, ACTIVE_SLOT_ID)).rejects.toThrow('Timetable slot not found');
      expect(txMock.timetableSlot.update).not.toHaveBeenCalled();
    });
  });

describe('availability', () => {
  const svc = new TimetableService();

  beforeEach(() => {
    txMock.academicYear.findFirst.mockResolvedValue({ id: YEAR });
    txMock.teacher.findMany.mockResolvedValue([]);
    txMock.period.findMany.mockResolvedValue([]);
    txMock.timetableSlot.findMany.mockResolvedValue([]);
  });

  // The availability grid cannot be drawn from id/order/label alone, and both
  // of the facts it is missing produce a WRONG page rather than a broken one:
  // without `kind` a break renders as the hour when the entire staff is free
  // (the biggest number on the page, against the one time nobody can teach),
  // and without the clock times the page cannot open on the period actually
  // running, which is the hour cover is nearly always needed for.
  it('selects kind and the clock times, not just id/order/label', async () => {
    await svc.availability(SCHOOL, {});
    const select = txMock.period.findMany.mock.calls.at(-1)?.[0]?.select;
    expect(select).toMatchObject({
      id: true,
      order: true,
      label: true,
      kind: true,
      startTime: true,
      endTime: true,
    });
  });

  it('selects the same period fields when there is no current academic year', async () => {
    // This branch returns early with an empty busy list; it used to carry its
    // own hand-written select, which is exactly how the two drift apart and a
    // school with no current year silently loses breaks on the grid.
    txMock.academicYear.findFirst.mockResolvedValue(null);
    await svc.availability(SCHOOL, {});
    const select = txMock.period.findMany.mock.calls.at(-1)?.[0]?.select;
    expect(select).toMatchObject({ kind: true, startTime: true, endTime: true });
  });

  it('returns every weekday the timetable holds, including Saturday', async () => {
    // The client derives its columns from these rows. Filtering the week here
    // would recreate, on the server, the exact bug the page just lost.
    txMock.timetableSlot.findMany.mockResolvedValue([
      { teacherId: TEACHER_OLD, dayOfWeek: 1, periodId: PERIOD },
      { teacherId: TEACHER_OLD, dayOfWeek: 6, periodId: PERIOD },
    ]);
    const out = await svc.availability(SCHOOL, {});
    expect(out.busy.map((b: { dayOfWeek: number }) => b.dayOfWeek)).toEqual([1, 6]);
  });
});

});

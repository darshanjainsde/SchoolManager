const txMock = {
  staffAttendance: { findMany: jest.fn() },
  attendance: { groupBy: jest.fn() },
  holiday: { findFirst: jest.fn() },
  event: { findMany: jest.fn() },
  leaveApplication: { count: jest.fn() },
  registerChangeRequest: { count: jest.fn() },
  enquiry: { count: jest.fn() },
  teacher: { findMany: jest.fn() },
  staff: { findMany: jest.fn() },
  classSection: { findFirst: jest.fn() },
  feePayment: { aggregate: jest.fn(), count: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { BellService, istToday } from './bell.service';
import type { LeaveService } from './leave.service';
import type { FeatureResolverService } from '../features';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
/** 03:30 UTC = 09:00 IST on 2 Sept — a school morning. */
const MORNING = new Date('2026-09-02T03:30:00Z');

function makeSvc(opts: { fees?: boolean; coverage?: unknown[] } = {}) {
  const leave = {
    coverage: jest.fn().mockResolvedValue(opts.coverage ?? []),
  } as unknown as LeaveService;
  const features = {
    getFeatures: jest.fn().mockResolvedValue(new Set(opts.fees ? ['MANAGEMENT', 'FEES'] : ['MANAGEMENT'])),
  } as unknown as FeatureResolverService;
  return { svc: new BellService(leave, features), leave, features };
}

describe('BellService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.staffAttendance.findMany.mockResolvedValue([]);
    txMock.attendance.groupBy.mockResolvedValue([]);
    txMock.holiday.findFirst.mockResolvedValue(null);
    txMock.event.findMany.mockResolvedValue([]);
    txMock.leaveApplication.count.mockResolvedValue(0);
    txMock.registerChangeRequest.count.mockResolvedValue(0);
    txMock.enquiry.count.mockResolvedValue(0);
    txMock.teacher.findMany.mockResolvedValue([]);
    txMock.staff.findMany.mockResolvedValue([]);
    txMock.classSection.findFirst.mockResolvedValue(null);
    txMock.feePayment.aggregate.mockResolvedValue({ _sum: { amountMinor: 0 } });
    txMock.feePayment.count.mockResolvedValue(0);
  });

  it('rings quiet on an empty school — zeros everywhere, nothing crashes', async () => {
    const { svc } = makeSvc();
    const bell = await svc.compose(SCHOOL, MORNING);

    expect(bell.staffAbsent).toEqual([]);
    expect(bell.uncovered).toEqual([]);
    expect(bell.students).toEqual({ absent: 0, marked: 0, worst: null });
    expect(bell.fees).toBeNull();
    expect(bell.waiting).toEqual({ leave: 0, registerChanges: 0, enquiries: 0 });
    expect(bell.dateLabel).toContain('September');
  });

  it('names who is not in, teachers and staff alike, alphabetically', async () => {
    txMock.staffAttendance.findMany.mockResolvedValue([
      { teacherId: 't1', staffId: null, status: 'ABSENT' },
      { teacherId: null, staffId: 's1', status: 'ON_LEAVE' },
    ]);
    txMock.teacher.findMany.mockResolvedValue([{ id: 't1', firstName: 'Sunita', lastName: 'Joshi' }]);
    txMock.staff.findMany.mockResolvedValue([{ id: 's1', firstName: 'Ram', lastName: 'Meghwal' }]);

    const { svc } = makeSvc();
    const bell = await svc.compose(SCHOOL, MORNING);

    expect(bell.staffAbsent).toEqual([
      { name: 'Ram Meghwal', kind: 'STAFF', status: 'ON_LEAVE' },
      { name: 'Sunita Joshi', kind: 'TEACHER', status: 'ABSENT' },
    ]);
  });

  it('splits coverage gaps: today rings loudly, the month ahead is the early warning', async () => {
    const { svc, leave } = makeSvc({
      coverage: [
        { date: new Date('2026-09-02'), classSectionName: 'VII — B', periodLabel: 'P1', originalTeacherName: 'Sunita Joshi', substituteTeacherId: null },
        { date: new Date('2026-09-02'), classSectionName: 'VII — B', periodLabel: 'P3', originalTeacherName: 'Sunita Joshi', substituteTeacherId: 'covered' },
        { date: new Date('2026-09-10'), classSectionName: 'VI — A', periodLabel: 'P2', originalTeacherName: 'R. Meghwal', substituteTeacherId: null },
        { date: new Date('2026-09-15'), classSectionName: 'VI — A', periodLabel: 'P4', originalTeacherName: 'R. Meghwal', substituteTeacherId: null },
      ],
    });
    const bell = await svc.compose(SCHOOL, MORNING);

    expect(bell.uncovered).toEqual([
      { className: 'VII — B', periodLabel: 'P1', teacherName: 'Sunita Joshi' },
    ]);
    // The old dashboard alert looked 30 days out — the Bell must not lose
    // that early warning when it replaces it.
    expect(bell.upcomingUncovered).toBe(2);
    expect((leave.coverage as jest.Mock).mock.calls[0]).toEqual([SCHOOL, '2026-09-02', '2026-10-02']);
  });

  it('counts ABSENT students only — LATE children arrived', async () => {
    txMock.attendance.groupBy.mockResolvedValue([
      { classSectionId: 'c1', status: 'PRESENT', _count: { _all: 60 } },
      { classSectionId: 'c1', status: 'LATE', _count: { _all: 5 } },
      { classSectionId: 'c1', status: 'ABSENT', _count: { _all: 6 } },
      { classSectionId: 'c2', status: 'ABSENT', _count: { _all: 2 } },
    ]);
    txMock.classSection.findFirst.mockResolvedValue({ name: 'A', grade: { name: 'VI' } });

    const { svc } = makeSvc();
    const bell = await svc.compose(SCHOOL, MORNING);

    expect(bell.students.absent).toBe(8);
    expect(bell.students.marked).toBe(73);
    expect(bell.students.worst).toEqual({ className: 'VI-A', absent: 6 });
  });

  it('omits the fees row entirely for a school without the FEES feature', async () => {
    const { svc } = makeSvc({ fees: false });
    const bell = await svc.compose(SCHOOL, MORNING);
    expect(bell.fees).toBeNull();
    expect(txMock.feePayment.aggregate).not.toHaveBeenCalled();
  });

  it('windows fees by the IST calendar: yesterday is yesterday in Jaipur, not UTC', async () => {
    txMock.feePayment.aggregate
      .mockResolvedValueOnce({ _sum: { amountMinor: 423000 } }) // yesterday
      .mockResolvedValueOnce({ _sum: { amountMinor: 3100000 } }); // month
    txMock.feePayment.count.mockResolvedValue(3);

    const { svc } = makeSvc({ fees: true });
    const bell = await svc.compose(SCHOOL, MORNING);

    expect(bell.fees).toEqual({ yesterdayMinor: 423000, monthMinor: 3100000, awaitingReview: 3 });
    const yesterdayWhere = txMock.feePayment.aggregate.mock.calls[0]![0].where;
    // IST 1 Sept runs 31 Aug 18:30 UTC → 1 Sept 18:30 UTC.
    expect(yesterdayWhere.verifiedAt.gte.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(yesterdayWhere.verifiedAt.lt.toISOString()).toBe('2026-09-01T18:30:00.000Z');
  });

  it('carries the day: holiday name, events with IST clock times, queue counts', async () => {
    txMock.holiday.findFirst.mockResolvedValue({ name: 'Teachers’ Day' });
    txMock.event.findMany.mockResolvedValue([
      { title: 'Vigyan Pradarshani', startAt: new Date('2026-09-02T08:30:00Z') }, // 2:00 pm IST
    ]);
    txMock.leaveApplication.count.mockResolvedValue(2);
    txMock.registerChangeRequest.count.mockResolvedValue(1);
    txMock.enquiry.count.mockResolvedValue(4);

    const { svc } = makeSvc();
    const bell = await svc.compose(SCHOOL, MORNING);

    expect(bell.today.holiday).toBe('Teachers’ Day');
    expect(bell.today.events).toEqual([{ title: 'Vigyan Pradarshani', time: '2:00 pm' }]);
    expect(bell.waiting).toEqual({ leave: 2, registerChanges: 1, enquiries: 4 });
  });
});

describe('istToday', () => {
  it('rolls to the next day at IST midnight, not UTC midnight', () => {
    // 20:00 UTC on 1 Sept is already 01:30 on 2 Sept in Jaipur.
    const { dateOnly, label } = istToday(new Date('2026-09-01T20:00:00Z'));
    expect(dateOnly.toISOString().slice(0, 10)).toBe('2026-09-02');
    expect(label).toContain('2 September');
  });
});

import 'reflect-metadata';

const txMock = {
  school: { findFirst: jest.fn() },
  holiday: { findMany: jest.fn() },
  leaveTypeDef: { findMany: jest.fn() },
  leaveApplication: { findMany: jest.fn() },
  leaveAllocation: { findMany: jest.fn() },
  payRun: { findFirst: jest.fn() },
  payAdjustment: { findMany: jest.fn(), createMany: jest.fn() },
  employeePay: { findMany: jest.fn() },
  teacher: { findMany: jest.fn() },
  staff: { findMany: jest.fn() },
};
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { PayLeaveService } from './pay-leave.service';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = '11111111-1111-1111-1111-111111111111';
const T1 = '22222222-2222-2222-2222-222222222222';
const S1 = '33333333-3333-3333-3333-333333333333';

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const service = () => new PayLeaveService();

/** Casual: 12 for teachers, 8 for staff. Unpaid always costs. Maternity never. */
const TYPES = [
  { id: 'casual', name: 'Casual', isPaid: true, neverDeduct: false, defaultAnnual: 12, defaultAnnualStaff: 8 },
  { id: 'unpaid', name: 'Unpaid leave', isPaid: false, neverDeduct: false, defaultAnnual: 0, defaultAnnualStaff: 0 },
  { id: 'maternity', name: 'Maternity', isPaid: true, neverDeduct: true, defaultAnnual: 182, defaultAnnualStaff: 182 },
];

const leave = (o: Partial<Record<string, unknown>>) => ({
  id: 'l1', teacherId: T1, staffId: null, typeDefId: 'casual', type: 'CASUAL',
  startDate: D('2026-10-05'), endDate: D('2026-10-06'), halfDay: false, status: 'APPROVED', ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  txMock.school.findFirst.mockResolvedValue({ lopBasis: 'CALENDAR_DAY', lopCountsHalfDays: true, workingDays: [1, 2, 3, 4, 5, 6] });
  txMock.holiday.findMany.mockResolvedValue([]);
  txMock.leaveTypeDef.findMany.mockResolvedValue(TYPES);
  txMock.leaveApplication.findMany.mockResolvedValue([]);
  txMock.leaveAllocation.findMany.mockResolvedValue([]);
  txMock.payRun.findFirst.mockResolvedValue(null);
  txMock.payAdjustment.findMany.mockResolvedValue([]);
  txMock.payAdjustment.createMany.mockResolvedValue({ count: 1 });
  txMock.employeePay.findMany.mockResolvedValue([]);
  txMock.teacher.findMany.mockResolvedValue([{ id: T1, firstName: 'Priya', lastName: 'Nair' }]);
  txMock.staff.findMany.mockResolvedValue([{ id: S1, firstName: 'Sam', lastName: 'Kumar' }]);
});

describe('what a month proposes', () => {
  it('proposes nothing when nobody took leave', async () => {
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals).toEqual([]);
    expect(m.daysInMonth).toBe(31);
  });

  it('leaves a teacher inside their quota alone', async () => {
    txMock.leaveApplication.findMany.mockResolvedValue([leave({})]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals).toEqual([]);
  });

  it('charges the days past the quota, and says the arithmetic', async () => {
    txMock.leaveApplication.findMany
      // the month's overlapping applications
      .mockResolvedValueOnce([leave({ startDate: D('2026-10-05'), endDate: D('2026-10-07') })])
      // what was used earlier in the year
      .mockResolvedValueOnce([leave({ id: 'l0', startDate: D('2026-05-01'), endDate: D('2026-05-11') })]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals).toHaveLength(1);
    expect(m.proposals[0]).toMatchObject({ name: 'Priya Nair', lopDays: 2, lopWholeDays: 2, lopHalfDays: 0 });
    expect(m.proposals[0].reasons[0]).toBe('Casual 14 of 12 used → 2 days over');
  });

  it('gives staff their own quota, not the teachers’ one', async () => {
    // 8 for staff, 12 for teachers. Nine days must overrun for a driver and
    // not for a teacher — one column would have forced the larger on everyone.
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ teacherId: null, staffId: S1, startDate: D('2026-10-01'), endDate: D('2026-10-09') })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals[0]).toMatchObject({ personKind: 'STAFF', name: 'Sam Kumar', lopDays: 1 });
  });

  it('never charges a type marked never-deduct', async () => {
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ typeDefId: 'maternity', startDate: D('2026-10-01'), endDate: D('2026-10-31') })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals).toEqual([]);
  });

  it('always charges unpaid leave', async () => {
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ typeDefId: 'unpaid', startDate: D('2026-10-05'), endDate: D('2026-10-07') })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals[0].lopDays).toBe(3);
  });

  it('leaves PENDING leave out, and says it is waiting', async () => {
    // The office may still reject it. Deducting for a maybe is the one thing
    // a payroll must not do.
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ typeDefId: 'unpaid', status: 'PENDING' })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals).toEqual([]);
    expect(m.warnings[0]).toMatch(/still waiting on a decision/);
  });

  it('takes only this month’s slice of a leave that crosses the boundary', async () => {
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ typeDefId: 'unpaid', startDate: D('2026-09-28'), endDate: D('2026-10-03') })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals[0].lopDays).toBe(3);
  });

  it('says when a deduction would take the whole month', async () => {
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ typeDefId: 'unpaid', startDate: D('2026-10-01'), endDate: D('2026-10-31') })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals[0]).toMatchObject({ lopDays: 31, clamped: true });
  });

  it('skips a Sunday when the school counts working days', async () => {
    txMock.school.findFirst.mockResolvedValue({ lopBasis: 'WORKING_DAY', lopCountsHalfDays: true, workingDays: [1, 2, 3, 4, 5, 6] });
    txMock.leaveApplication.findMany
      // 3–5 Oct 2026 = Sat, Sun, Mon
      .mockResolvedValueOnce([leave({ typeDefId: 'unpaid', startDate: D('2026-10-03'), endDate: D('2026-10-05') })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals[0].lopDays).toBe(2);
  });

  it('deducts nothing under warn-only, but still reports it', async () => {
    txMock.school.findFirst.mockResolvedValue({ lopBasis: 'WARN_ONLY', lopCountsHalfDays: true, workingDays: [1, 2, 3, 4, 5, 6] });
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ typeDefId: 'unpaid', startDate: D('2026-10-05'), endDate: D('2026-10-07') })])
      .mockResolvedValueOnce([]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals).toEqual([]);
    expect(m.warnings.join(' ')).toMatch(/deducts nothing automatically/);
  });
});

describe('applying the proposals', () => {
  beforeEach(() => {
    txMock.leaveApplication.findMany
      .mockResolvedValueOnce([leave({ typeDefId: 'unpaid', startDate: D('2026-10-05'), endDate: D('2026-10-07') })])
      .mockResolvedValueOnce([]);
  });

  it('writes an ordinary adjustment, so nothing downstream learns a new shape', async () => {
    await service().apply(SCHOOL, 'actor', 2026, 10, [T1]);
    const [call] = txMock.payAdjustment.createMany.mock.calls;
    expect(call[0].data[0]).toMatchObject({
      schoolId: SCHOOL, personKind: 'TEACHER', teacherId: T1, staffId: null,
      periodYear: 2026, periodMonth: 10, kind: 'DEDUCTION',
      label: 'Leave without pay', amountMinor: 0, lopDays: 3, lopHalfDays: 0,
    });
  });

  it('anchors the line to a real application, so it can never be applied twice', async () => {
    // THE BUG THIS PINS. `applied` is detected by leaveApplicationId being
    // NOT NULL. Writing null there would leave `applied` false forever and let
    // the same days be deducted from somebody's pay a second time.
    await service().apply(SCHOOL, 'actor', 2026, 10, [T1]);
    const row = txMock.payAdjustment.createMany.mock.calls[0][0].data[0];
    expect(row.leaveApplicationId).toBe('l1');
    expect(row.leaveApplicationId).not.toBeNull();
  });

  it('offers nothing for somebody already charged this month', async () => {
    txMock.payAdjustment.findMany.mockResolvedValue([{ teacherId: T1, staffId: null }]);
    const m = await service().month(SCHOOL, 2026, 10);
    expect(m.proposals[0].applied).toBe(true);
    const r = await service().apply(SCHOOL, 'actor', 2026, 10, [T1]);
    expect(r).toEqual({ applied: 0 });
    expect(txMock.payAdjustment.createMany).not.toHaveBeenCalled();
  });

  it('refuses a locked month and says where the correction belongs', async () => {
    txMock.payRun.findFirst.mockResolvedValue({ status: 'LOCKED' });
    await expect(service().apply(SCHOOL, 'actor', 2026, 10, [T1]))
      .rejects.toThrow(/belongs in the next month/);
    expect(txMock.payAdjustment.createMany).not.toHaveBeenCalled();
  });

  it('refuses an empty choice rather than applying everything', async () => {
    await expect(service().apply(SCHOOL, 'actor', 2026, 10, [])).rejects.toThrow(ApiError);
  });

  it('applies nothing for a person who was not chosen', async () => {
    const r = await service().apply(SCHOOL, 'actor', 2026, 10, [S1]);
    expect(r).toEqual({ applied: 0 });
  });
});

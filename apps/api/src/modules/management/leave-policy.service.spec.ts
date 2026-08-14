import 'reflect-metadata';

const txMock = {
  leaveTypeDef: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), createMany: jest.fn(), update: jest.fn() },
  leaveAllocation: { findMany: jest.fn(), upsert: jest.fn(), createMany: jest.fn() },
  leaveApplication: { findMany: jest.fn() },
  academicYear: { findFirst: jest.fn() },
  teacher: { findMany: jest.fn(), findFirst: jest.fn() },
  school: { findUnique: jest.fn() },
  holiday: { findMany: jest.fn() },
};

const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (schoolId: string, fn: (tx: unknown) => unknown) => withTenantMock(schoolId, fn),
}));

import { LeavePolicyService } from './leave-policy.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TEACHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TEACHER_2 = 'b2b2b2b2-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const YEAR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const YEAR_NEXT = 'c2c2c2c2-cccc-cccc-cccc-cccccccccccc';
const SICK = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const CASUAL = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A working week of Mon–Sat, the schema default. */
const SCHOOL_ROW = { workingDays: [1, 2, 3, 4, 5, 6] };

const sickDef = { id: SICK, schoolId: SCHOOL, name: 'Sick leave', builtin: 'SICK', isPaid: true, defaultAnnual: 12, carryForwardCap: 0, isActive: true };
const casualDef = { id: CASUAL, schoolId: SCHOOL, name: 'Casual leave', builtin: 'CASUAL', isPaid: true, defaultAnnual: 8, carryForwardCap: 4, isActive: true };

const currentYear = { id: YEAR, schoolId: SCHOOL, name: '2026-27', startDate: day('2026-04-01'), endDate: day('2027-03-31'), isCurrent: true };

describe('LeavePolicyService', () => {
  const svc = new LeavePolicyService();

  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));
    txMock.school.findUnique.mockResolvedValue(SCHOOL_ROW);
    txMock.holiday.findMany.mockResolvedValue([]);
    txMock.academicYear.findFirst.mockResolvedValue(currentYear);
    txMock.leaveApplication.findMany.mockResolvedValue([]);
    txMock.leaveAllocation.findMany.mockResolvedValue([]);
  });

  // ── types() seeding ───────────────────────────────────────────────────────

  it('seeds the five built-in types on a school\'s first look, then returns them', async () => {
    txMock.leaveTypeDef.findMany
      .mockResolvedValueOnce([]) // nothing yet
      .mockResolvedValueOnce([sickDef, casualDef]); // post-seed re-read
    txMock.leaveTypeDef.createMany.mockResolvedValue({ count: 5 });

    const out = await svc.types(SCHOOL);

    expect(txMock.leaveTypeDef.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ schoolId: SCHOOL, builtin: 'SICK' }),
        expect.objectContaining({ schoolId: SCHOOL, builtin: 'UNPAID', isPaid: false }),
      ]),
      skipDuplicates: true,
    });
    expect(out).toHaveLength(2);
  });

  it('does NOT reseed once any def exists', async () => {
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef]);

    await svc.types(SCHOOL);

    expect(txMock.leaveTypeDef.createMany).not.toHaveBeenCalled();
  });

  // ── used-day derivation (the heart of the feature) ───────────────────────

  it('counts only working days inside the year window against the balance', async () => {
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef]);
    txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao' }]);
    txMock.leaveAllocation.findMany.mockResolvedValue([
      { id: 'al1', schoolId: SCHOOL, teacherId: TEACHER, typeDefId: SICK, academicYearId: YEAR, allotted: 12, carriedIn: 0 },
    ]);
    // Mon 3 Aug → Sun 9 Aug 2026: Mon–Sat working (6 days), Sunday excluded.
    txMock.leaveApplication.findMany.mockResolvedValue([
      { teacherId: TEACHER, type: 'SICK', typeDefId: SICK, startDate: day('2026-08-03'), endDate: day('2026-08-09') },
    ]);

    const grid = await svc.grid(SCHOOL);

    expect(grid.teachers[0].cells[0]).toEqual({
      typeDefId: SICK,
      allotted: 12,
      carriedIn: 0,
      used: 6,
      remaining: 6,
    });
  });

  it('excludes holidays from the used count', async () => {
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef]);
    txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao' }]);
    txMock.leaveAllocation.findMany.mockResolvedValue([
      { id: 'al1', schoolId: SCHOOL, teacherId: TEACHER, typeDefId: SICK, academicYearId: YEAR, allotted: 12, carriedIn: 0 },
    ]);
    txMock.holiday.findMany.mockResolvedValue([{ startDate: day('2026-08-04'), endDate: null }]);
    // Mon–Wed, with Tuesday a holiday → 2 days, not 3.
    txMock.leaveApplication.findMany.mockResolvedValue([
      { teacherId: TEACHER, type: 'SICK', typeDefId: SICK, startDate: day('2026-08-03'), endDate: day('2026-08-05') },
    ]);

    const grid = await svc.grid(SCHOOL);

    expect(grid.teachers[0].cells[0].used).toBe(2);
  });

  it('resolves a pre-policy application (no typeDefId) through its built-in enum', async () => {
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef]);
    txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao' }]);
    txMock.leaveAllocation.findMany.mockResolvedValue([
      { id: 'al1', schoolId: SCHOOL, teacherId: TEACHER, typeDefId: SICK, academicYearId: YEAR, allotted: 12, carriedIn: 0 },
    ]);
    txMock.leaveApplication.findMany.mockResolvedValue([
      { teacherId: TEACHER, type: 'SICK', typeDefId: null, startDate: day('2026-08-03'), endDate: day('2026-08-03') },
    ]);

    const grid = await svc.grid(SCHOOL);

    expect(grid.teachers[0].cells[0].used).toBe(1);
  });

  it('a teacher with no allocation shows used but a null remaining — untracked, not zero', async () => {
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef]);
    txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER, firstName: 'Asha', lastName: 'Rao' }]);
    txMock.leaveApplication.findMany.mockResolvedValue([
      { teacherId: TEACHER, type: 'SICK', typeDefId: SICK, startDate: day('2026-08-03'), endDate: day('2026-08-03') },
    ]);

    const grid = await svc.grid(SCHOOL);

    expect(grid.teachers[0].cells[0]).toMatchObject({ allotted: null, used: 1, remaining: null });
  });

  // ── applyDefaults ────────────────────────────────────────────────────────

  it('applyDefaults creates only the missing cells and never clobbers an existing grant', async () => {
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef, casualDef]);
    txMock.teacher.findMany.mockResolvedValue([{ id: TEACHER }, { id: TEACHER_2 }]);
    // TEACHER already has a hand-edited SICK grant.
    txMock.leaveAllocation.findMany.mockResolvedValue([{ teacherId: TEACHER, typeDefId: SICK }]);
    txMock.leaveAllocation.createMany.mockResolvedValue({ count: 3 });

    const out = await svc.applyDefaults(SCHOOL);

    const created = txMock.leaveAllocation.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(3); // 2 teachers × 2 types − 1 existing
    expect(created).not.toContainEqual(expect.objectContaining({ teacherId: TEACHER, typeDefId: SICK }));
    expect(created).toContainEqual(
      expect.objectContaining({ teacherId: TEACHER, typeDefId: CASUAL, allotted: 8 }),
    );
    expect(out).toEqual({ created: 3 });
  });

  // ── closeYear / carry-forward ────────────────────────────────────────────

  it('carries min(remaining, cap) into the next year and lets the rest lapse', async () => {
    txMock.academicYear.findFirst
      .mockResolvedValueOnce(currentYear) // from
      .mockResolvedValueOnce({ ...currentYear, id: YEAR_NEXT, name: '2027-28', isCurrent: false }); // to
    // Only CASUAL carries (cap 4). Teacher used 2 of 8+0 → remaining 6 → carry 4.
    txMock.leaveTypeDef.findMany.mockResolvedValue([casualDef]);
    txMock.leaveAllocation.findMany.mockResolvedValue([
      { id: 'al1', schoolId: SCHOOL, teacherId: TEACHER, typeDefId: CASUAL, academicYearId: YEAR, allotted: 8, carriedIn: 0 },
    ]);
    txMock.leaveApplication.findMany.mockResolvedValue([
      { teacherId: TEACHER, type: 'CASUAL', typeDefId: CASUAL, startDate: day('2026-08-03'), endDate: day('2026-08-04') },
    ]);
    txMock.leaveAllocation.upsert.mockResolvedValue({});

    const out = await svc.closeYear(SCHOOL, YEAR, YEAR_NEXT);

    expect(txMock.leaveAllocation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          teacherId: TEACHER,
          typeDefId: CASUAL,
          academicYearId: YEAR_NEXT,
          allotted: 8, // next year's default
          carriedIn: 4, // min(6 remaining, cap 4)
        }),
        update: { carriedIn: 4 },
      }),
    );
    expect(out).toEqual({ carried: 1 });
  });

  it('refuses to close a year into itself', async () => {
    await expect(svc.closeYear(SCHOOL, YEAR, YEAR)).rejects.toMatchObject({
      response: { code: 'VALIDATION' },
    });
  });

  // ── balances + pending context ───────────────────────────────────────────

  it('balanceForUser keys every query on the caller\'s own teacher row', async () => {
    txMock.teacher.findFirst.mockResolvedValue({ id: TEACHER });
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef]);
    txMock.leaveAllocation.findMany.mockResolvedValue([
      { id: 'al1', schoolId: SCHOOL, teacherId: TEACHER, typeDefId: SICK, academicYearId: YEAR, allotted: 12, carriedIn: 2 },
    ]);
    txMock.leaveApplication.findMany.mockResolvedValue([
      { teacherId: TEACHER, type: 'SICK', typeDefId: SICK, startDate: day('2026-08-03'), endDate: day('2026-08-03') },
    ]);

    const out = await svc.balanceForUser(SCHOOL, 'user-1');

    expect(txMock.leaveApplication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ teacherId: TEACHER, schoolId: SCHOOL }) }),
    );
    expect(out.balances).toEqual([
      expect.objectContaining({ typeDefId: SICK, allotted: 12, carriedIn: 2, used: 1, remaining: 13 }),
    ]);
  });

  it('pendingApprovalContext reports the overshoot the admin is about to approve', async () => {
    txMock.leaveApplication.findMany
      // pending list
      .mockResolvedValueOnce([
        { id: 'app-1', teacherId: TEACHER, type: 'SICK', typeDefId: SICK, startDate: day('2026-08-03'), endDate: day('2026-08-08') },
      ])
      // usedDays' APPROVED query
      .mockResolvedValueOnce([]);
    txMock.leaveTypeDef.findMany.mockResolvedValue([sickDef]);
    txMock.leaveAllocation.findMany.mockResolvedValue([
      { id: 'al1', schoolId: SCHOOL, teacherId: TEACHER, typeDefId: SICK, academicYearId: YEAR, allotted: 4, carriedIn: 0 },
    ]);

    const out = await svc.pendingApprovalContext(SCHOOL);

    // Mon–Sat = 6 working days requested against 4 remaining.
    expect(out['app-1']).toEqual({ requestedDays: 6, remaining: 4, typeName: 'Sick leave' });
  });
});

import 'reflect-metadata';

const txMock = { staff: { findFirst: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { LeaveDeskGuard, isLeaveDesk } from './leave-desk.guard';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ctxFor = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
const guard = () => new LeaveDeskGuard({ requireTenant: () => ({ schoolId: SCHOOL }) } as never);

beforeEach(() => jest.clearAllMocks());

/**
 * THE DOOR, not the right. Deciding leave is a job, and this guard asks only
 * whether the caller holds it. `canSeeSalary` guards the pay FIGURES, which a
 * leave register does not contain — see the guard's own comment.
 */
describe('who may decide leave', () => {
  it('lets a school admin through without a lookup', async () => {
    expect(await guard().canActivate(ctxFor({ role: 'SCHOOL_ADMIN', sub: 'u1', schoolId: SCHOOL }))).toBe(true);
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });

  it('lets an active accounts officer through', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
    expect(await guard().canActivate(ctxFor({ role: 'STAFF', sub: 'u2', schoolId: SCHOOL }))).toBe(true);
    expect(txMock.staff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: 'ACCOUNTS', isActive: true, schoolId: SCHOOL }) }),
    );
  });

  it('refuses a driver — the job is what opens this door', async () => {
    txMock.staff.findFirst.mockResolvedValue(null);
    await expect(guard().canActivate(ctxFor({ role: 'STAFF', sub: 'u3', schoolId: SCHOOL })))
      .rejects.toThrow(ApiError);
  });

  it('refuses an officer who has been made inactive', async () => {
    // The query itself carries `isActive`, so a resigned officer is refused
    // on the next request rather than at the end of a cache window.
    txMock.staff.findFirst.mockResolvedValue(null);
    await expect(guard().canActivate(ctxFor({ role: 'STAFF', sub: 'u4', schoolId: SCHOOL })))
      .rejects.toThrow(/accounts officer/);
  });

  it('refuses a request with no signed-in user at all', async () => {
    expect(await guard().canActivate(ctxFor(undefined))).toBe(false);
  });
});

describe('isLeaveDesk — the same rule for the console and for WhatsApp', () => {
  const db = { staff: { findFirst: jest.fn() } };
  beforeEach(() => db.staff.findFirst.mockReset());

  it('an admin is the desk without a lookup', async () => {
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u1', role: 'SCHOOL_ADMIN' })).toBe(true);
    expect(db.staff.findFirst).not.toHaveBeenCalled();
  });

  it('a staff login is the desk only as an active accounts officer of THIS school', async () => {
    db.staff.findFirst.mockResolvedValue({ id: 's1' });
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u2', role: 'STAFF' })).toBe(true);
    expect(db.staff.findFirst).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, role: 'ACCOUNTS', isActive: true, userId: 'u2' }, select: { id: true } });
  });

  it('a teacher or a family never is', async () => {
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u3', role: 'TEACHER' })).toBe(false);
    expect(await isLeaveDesk(db as never, SCHOOL, { userId: 'u4', role: 'STUDENT' })).toBe(false);
    expect(db.staff.findFirst).not.toHaveBeenCalled();
  });
});

/**
 * THE TABLE. A real in-memory Staff table answers the query, so the rule is
 * proved by what `where` actually selects, not by what a mock was told to
 * return. The guard and `isLeaveDesk` must admit exactly the same people.
 */
describe('isLeaveDesk and LeaveDeskGuard admit exactly the same people', () => {
  const OTHER_SCHOOL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const rows = [
    { id: 's-acc', schoolId: SCHOOL, userId: 'u-acc', role: 'ACCOUNTS', isActive: true },
    { id: 's-gone', schoolId: SCHOOL, userId: 'u-gone', role: 'ACCOUNTS', isActive: false },
    { id: 's-driver', schoolId: SCHOOL, userId: 'u-driver', role: 'DRIVER', isActive: true },
    { id: 's-away', schoolId: OTHER_SCHOOL, userId: 'u-away', role: 'ACCOUNTS', isActive: true },
  ];
  const fakeStaff = {
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)) ?? null),
  };
  const cases: [string, { sub: string; role: string }, boolean][] = [
    ['an admin', { sub: 'u-admin', role: 'SCHOOL_ADMIN' }, true],
    ['an active accounts officer', { sub: 'u-acc', role: 'STAFF' }, true],
    ['an inactive accounts officer', { sub: 'u-gone', role: 'STAFF' }, false],
    ['a staff member with another job', { sub: 'u-driver', role: 'STAFF' }, false],
    ['a teacher', { sub: 'u-teacher', role: 'TEACHER' }, false],
    ['a staff login whose Staff row belongs to another school', { sub: 'u-away', role: 'STAFF' }, false],
  ];

  it.each(cases)('%s', async (_name, who, expected) => {
    txMock.staff.findFirst.mockImplementation(fakeStaff.findFirst as never);
    expect(await isLeaveDesk({ staff: fakeStaff } as never, SCHOOL, { userId: who.sub, role: who.role })).toBe(expected);
    const viaGuard = await guard()
      .canActivate(ctxFor({ ...who, schoolId: SCHOOL }))
      .then(() => true, (e: unknown) => (e instanceof ApiError ? false : Promise.reject(e)));
    expect(viaGuard).toBe(expected);
  });
});

import 'reflect-metadata';

const txMock = { staff: { findFirst: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { LeaveDeskGuard } from './leave-desk.guard';
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

import 'reflect-metadata';

const txMock = { staff: { findFirst: jest.fn() }, user: { findFirst: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { AdmissionsDeskGuard, isAdmissionsDesk } from './admissions-desk.guard';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ctxFor = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
const guard = () => new AdmissionsDeskGuard({ requireTenant: () => ({ schoolId: SCHOOL }) } as never);

beforeEach(() => {
  jest.clearAllMocks();
  txMock.staff.findFirst.mockResolvedValue(null);
  txMock.user.findFirst.mockResolvedValue(null);
});

/** THE DOOR, not the right — the same shape as LeaveDeskGuard and SportsDeskGuard. */
describe('who may open the admissions desk', () => {
  it('lets a school admin through without a lookup', async () => {
    expect(await guard().canActivate(ctxFor({ role: 'SCHOOL_ADMIN', sub: 'u1', schoolId: SCHOOL }))).toBe(true);
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });

  it('lets an active admissions officer through', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
    expect(await guard().canActivate(ctxFor({ role: 'STAFF', sub: 'u2', schoolId: SCHOOL }))).toBe(true);
    expect(txMock.staff.findFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, userId: 'u2', role: 'ADMISSIONS', isActive: true },
      select: { id: true },
    });
  });

  it("refuses an accounts officer — another desk's job does not open this one", async () => {
    let caught: unknown;
    try {
      await guard().canActivate(ctxFor({ role: 'STAFF', sub: 'u3', schoolId: SCHOOL }));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getStatus()).toBe(403);
    expect(((caught as ApiError).getResponse() as { code: string }).code).toBe('NOT_ADMISSIONS_DESK');
  });

  it('refuses a request with no signed-in user at all', async () => {
    expect(await guard().canActivate(ctxFor(undefined))).toBe(false);
  });
});

describe('isAdmissionsDesk — one rule for the door, the owner picker and (Tier B) WhatsApp', () => {
  it('is true for an active admissions officer of this school', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 'staff-1' });
    expect(await isAdmissionsDesk(txMock as never, SCHOOL, 'u2')).toBe(true);
    expect(txMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('is true for an active admin login of this school', async () => {
    txMock.user.findFirst.mockResolvedValue({ id: 'u1' });
    expect(await isAdmissionsDesk(txMock as never, SCHOOL, 'u1')).toBe(true);
    expect(txMock.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', schoolId: SCHOOL, role: 'SCHOOL_ADMIN', isActive: true },
      select: { id: true },
    });
  });

  it('is false for anybody else — a driver, a teacher, an officer made inactive', async () => {
    expect(await isAdmissionsDesk(txMock as never, SCHOOL, 'u9')).toBe(false);
  });
});

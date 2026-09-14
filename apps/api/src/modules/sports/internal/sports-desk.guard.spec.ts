import 'reflect-metadata';

const txMock = { staff: { findFirst: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { SportsDeskGuard } from './sports-desk.guard';
import { SPORTS_PERM_KEY } from './sports-perm.decorator';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tenant = { requireTenant: () => ({ schoolId: SCHOOL }) };
const ctxFor = (user: { sub: string; role: string } | undefined, need?: string) => {
  const req: Record<string, unknown> = { user };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(need) };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) };
  return { ctx, req, reflector };
};

beforeEach(() => jest.clearAllMocks());

describe('SportsDeskGuard', () => {
  it('no user → false; an admin passes with every permission and no DB read', async () => {
    const { ctx, reflector } = ctxFor(undefined);
    expect(await new SportsDeskGuard(tenant as never, reflector as never).canActivate(ctx as never)).toBe(false);
    const admin = ctxFor({ sub: 'u1', role: 'SCHOOL_ADMIN' }, 'SETTINGS');
    expect(await new SportsDeskGuard(tenant as never, admin.reflector as never).canActivate(admin.ctx as never)).toBe(true);
    expect(admin.req.sportsPerms).toEqual(['ENTER', 'VERIFY', 'CREATE', 'PUBLISH', 'HOUSES', 'SETTINGS']);
    expect(txMock.staff.findFirst).not.toHaveBeenCalled();
  });

  it('office staff bounce with NOT_SPORTS_DESK; the lookup is scoped to the school, the SPORTS job and active rows', async () => {
    txMock.staff.findFirst.mockResolvedValue(null);
    const { ctx, reflector } = ctxFor({ sub: 'u2', role: 'STAFF' });
    await expect(new SportsDeskGuard(tenant as never, reflector as never).canActivate(ctx as never)).rejects.toMatchObject({ response: { code: 'NOT_SPORTS_DESK' } });
    expect(txMock.staff.findFirst.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, userId: 'u2', role: 'SPORTS', isActive: true });
  });

  it('a sports teacher with no stored list gets the defaults; a route needing PUBLISH is refused with SPORTS_PERM', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 's1', sportsPerms: [] });
    const open = ctxFor({ sub: 'u3', role: 'STAFF' });
    expect(await new SportsDeskGuard(tenant as never, open.reflector as never).canActivate(open.ctx as never)).toBe(true);
    expect(open.req.sportsPerms).toEqual(['ENTER', 'VERIFY', 'CREATE', 'HOUSES']);
    const publish = ctxFor({ sub: 'u3', role: 'STAFF' }, 'PUBLISH');
    await expect(new SportsDeskGuard(tenant as never, publish.reflector as never).canActivate(publish.ctx as never)).rejects.toMatchObject({ response: { code: 'SPORTS_PERM' } });
    expect(publish.reflector.getAllAndOverride).toHaveBeenCalledWith(SPORTS_PERM_KEY, expect.any(Array));
  });

  it('a stored list is honoured exactly', async () => {
    txMock.staff.findFirst.mockResolvedValue({ id: 's1', sportsPerms: ['ENTER', 'PUBLISH'] });
    const { ctx, req, reflector } = ctxFor({ sub: 'u3', role: 'STAFF' }, 'PUBLISH');
    expect(await new SportsDeskGuard(tenant as never, reflector as never).canActivate(ctx as never)).toBe(true);
    expect(req.sportsPerms).toEqual(['ENTER', 'PUBLISH']);
  });
});

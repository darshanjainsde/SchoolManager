import 'reflect-metadata';

const txMock = { staff: { findMany: jest.fn(), updateMany: jest.fn() } };
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));

import { SportsCoachesService } from './sports-coaches.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
beforeEach(() => jest.resetAllMocks());

describe('SportsCoachesService', () => {
  it('lists sports-job staff with their effective permissions and whether a list was ever stored', async () => {
    txMock.staff.findMany.mockResolvedValue([
      { id: 's1', firstName: 'Ravi', lastName: 'K', email: null, isActive: true, userId: 'u1', sportsPerms: [] },
      { id: 's2', firstName: 'Mina', lastName: 'D', email: 'm@x.in', isActive: false, userId: null, sportsPerms: ['ENTER', 'OLD'] },
    ]);
    const rows = await new SportsCoachesService().list(SCHOOL);
    expect(rows).toEqual([
      { id: 's1', name: 'Ravi K', email: null, isActive: true, hasLogin: true, perms: ['ENTER', 'VERIFY', 'CREATE', 'HOUSES'], stored: false },
      { id: 's2', name: 'Mina D', email: 'm@x.in', isActive: false, hasLogin: false, perms: ['ENTER'], stored: true },
    ]);
    expect(txMock.staff.findMany.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, role: 'SPORTS' });
  });

  it('setPerms drops unknown names, refuses an empty list, and 404s a non-coach', async () => {
    const svc = new SportsCoachesService();
    await expect(svc.setPerms(SCHOOL, 's1', ['NOPE'])).rejects.toMatchObject({ response: { field: 'sportsPerms' } });
    txMock.staff.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc.setPerms(SCHOOL, 's1', ['PUBLISH', 'ENTER', 'ENTER', 'x'])).toEqual({ perms: ['PUBLISH', 'ENTER'] });
    expect(txMock.staff.updateMany).toHaveBeenCalledWith({ where: { id: 's1', schoolId: SCHOOL, role: 'SPORTS' }, data: { sportsPerms: ['PUBLISH', 'ENTER'] } });
    txMock.staff.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.setPerms(SCHOOL, 's9', ['ENTER'])).rejects.toMatchObject({ response: { code: 'COACH_NOT_FOUND' } });
  });
});

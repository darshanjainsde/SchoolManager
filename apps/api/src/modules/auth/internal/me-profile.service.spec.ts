const user = { findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => ({ user }) }));

import { MeProfileService, effectivePrefs } from './me-profile.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('MeProfileService', () => {
  const svc = () => new MeProfileService();
  beforeEach(() => { jest.clearAllMocks(); user.updateMany.mockResolvedValue({ count: 1 }); });

  it('missing switches read as ON, an explicit false as OFF', () => {
    expect(effectivePrefs(null)).toEqual({ leave: true, register: true, fees: true, enquiry: true, summary: true });
    expect(effectivePrefs({ fees: false, junk: 1 })).toMatchObject({ fees: false, leave: true });
  });

  it('get: the login\'s own row, scoped to the token\'s school', async () => {
    user.findFirst.mockResolvedValue({ id: 'u1', role: 'SCHOOL_ADMIN', email: 'admin@raffles.test', name: null, notifyPrefs: { leave: false } });
    const r = await svc().get(SCHOOL, 'u1');
    expect(user.findFirst.mock.calls[0][0].where).toEqual({ id: 'u1', schoolId: SCHOOL });
    expect(r).toEqual({ userId: 'u1', role: 'SCHOOL_ADMIN', email: 'admin@raffles.test', name: null, notifyPrefs: { leave: false, register: true, fees: true, enquiry: true, summary: true } });
  });

  it('update: trims the name (blank → null), merges switches onto the stored ones, refuses an 80+ name', async () => {
    user.findFirst.mockResolvedValueOnce({ notifyPrefs: { fees: false } }).mockResolvedValueOnce({ id: 'u1', role: 'SCHOOL_ADMIN', email: 'a@b', name: 'Darshan Jain', notifyPrefs: { fees: false, leave: false } });
    await svc().update(SCHOOL, 'u1', { name: '  Darshan   Jain ', notifyPrefs: { leave: false } });
    expect(user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', schoolId: SCHOOL }, data: { name: 'Darshan Jain', notifyPrefs: { leave: false, register: true, fees: false, enquiry: true, summary: true } } });
    user.findFirst.mockResolvedValueOnce({ id: 'u1', role: 'SCHOOL_ADMIN', email: 'a@b', name: null, notifyPrefs: null });
    await svc().update(SCHOOL, 'u1', { name: '   ' });
    expect(user.updateMany).toHaveBeenLastCalledWith({ where: { id: 'u1', schoolId: SCHOOL }, data: { name: null } });
    await expect(svc().update(SCHOOL, 'u1', { name: 'x'.repeat(81) })).rejects.toMatchObject({ status: 400 });
    user.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc().update(SCHOOL, 'u-other', { name: 'X' })).rejects.toMatchObject({ status: 404 });
  });
});

const mockDb = {
  user: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};
jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => mockDb,
  UserRole: { OWNER: 'OWNER', SCHOOL_ADMIN: 'SCHOOL_ADMIN', TEACHER: 'TEACHER', STUDENT: 'STUDENT' },
}));

import { AdminCredentialsService } from './admin-credentials.service';

describe('AdminCredentialsService', () => {
  const passwords = { hash: jest.fn().mockResolvedValue('HASH') } as any;
  const svc = new AdminCredentialsService(passwords);
  beforeEach(() => jest.clearAllMocks());

  it('resetPassword 404s and mutates nothing when user is not a SCHOOL_ADMIN of that school', async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    await expect(svc.resetPassword('school-1', 'user-x')).rejects.toThrow(/not found/i);
    expect(mockDb.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-x', schoolId: 'school-1', role: 'SCHOOL_ADMIN' },
      select: { id: true },
    });
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('resetPassword hashes a fresh password and revokes the user\'s sessions', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: 'user-1' });
    mockDb.user.update.mockReturnValue('U');
    mockDb.refreshToken.updateMany.mockReturnValue('R');
    const res = await svc.resetPassword('school-1', 'user-1');
    expect(typeof res.password).toBe('string');
    expect(res.password.length).toBeGreaterThan(10);
    expect(passwords.hash).toHaveBeenCalledWith(res.password);
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'HASH', failedLoginAttempts: 0, lockedUntil: null },
    });
    expect(mockDb.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', schoolId: 'school-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it('listAdmins scopes to SCHOOL_ADMIN of the school and maps rows', async () => {
    mockDb.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@x.test', isActive: true, lastLoginAt: null, lockedUntil: null },
    ]);
    const rows = await svc.listAdmins('school-1');
    expect(mockDb.user.findMany).toHaveBeenCalledWith({
      where: { schoolId: 'school-1', role: 'SCHOOL_ADMIN' },
      orderBy: { email: 'asc' },
      select: { id: true, email: true, isActive: true, lastLoginAt: true, lockedUntil: true },
    });
    expect(rows).toEqual([
      { userId: 'u1', email: 'a@x.test', isActive: true, lastLoginAt: null, lockedUntil: null },
    ]);
  });
});

const mockDb = {
  user: { findFirst: jest.fn(), update: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};
jest.mock('@skoolos/db', () => ({ getPlatformPrisma: () => mockDb, UserRole: { OWNER: 'OWNER', SCHOOL_ADMIN: 'SCHOOL_ADMIN', TEACHER: 'TEACHER', STUDENT: 'STUDENT', PARENT: 'PARENT' } }));

import { AccountService } from './account.service';

describe('AccountService.changePassword', () => {
  const passwords = { hash: jest.fn().mockResolvedValue('NEWHASH'), verify: jest.fn() } as any;
  const svc = new AccountService(passwords);
  beforeEach(() => jest.clearAllMocks());

  it('401s and mutates nothing when the current password is wrong', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: 'OLD' });
    passwords.verify.mockResolvedValue(false);
    await expect(svc.changePassword('s1', 'u1', 'wrong', 'brandnew1')).rejects.toThrow(/incorrect/i);
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('401s when the user is not found in this tenant', async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    await expect(svc.changePassword('s1', 'u1', 'x', 'brandnew1')).rejects.toThrow(/invalid/i);
    expect(mockDb.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'u1', schoolId: 's1' },
      select: { id: true, passwordHash: true },
    });
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('updates the hash and revokes sessions on success', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: 'OLD' });
    passwords.verify.mockResolvedValue(true);
    mockDb.user.update.mockReturnValue('U');
    mockDb.refreshToken.updateMany.mockReturnValue('R');
    const res = await svc.changePassword('s1', 'u1', 'current1', 'brandnew1');
    expect(res).toEqual({ ok: true });
    expect(passwords.hash).toHaveBeenCalledWith('brandnew1');
    expect(mockDb.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { passwordHash: 'NEWHASH' },
    });
    expect(mockDb.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', schoolId: 's1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mockDb.$transaction).toHaveBeenCalled();
  });

  it('400s and mutates nothing when the new password equals the current one', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: 'u1', passwordHash: 'OLD' });
    passwords.verify.mockResolvedValue(true);
    await expect(svc.changePassword('s1', 'u1', 'samepass1', 'samepass1')).rejects.toThrow(/different/i);
    expect(passwords.hash).not.toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});

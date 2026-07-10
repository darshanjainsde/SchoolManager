import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';

const prismaMock = {
  impersonationToken: {
    findUnique: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
};

jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => prismaMock,
  withTenant: jest.fn(),
}));
jest.mock('@skoolos/config', () => ({
  loadEnv: () => ({
    JWT_SCHOOL_ACCESS_SECRET: 'test-school-access-secret',
    JWT_SCHOOL_REFRESH_SECRET: 'test-school-refresh-secret',
    JWT_ACCESS_TTL: 900,
    JWT_REFRESH_TTL: 3600,
    LOCKOUT_MAX_ATTEMPTS: 5,
    LOCKOUT_DURATION_SECONDS: 900,
  }),
}));

import { AuthService } from './auth.service';
import type { PasswordService } from './password.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RAW = 'raw-impersonation-token-x';

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    userId: 'user-1',
    schoolId: SCHOOL,
    tokenHash: sha256(RAW),
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    user: { id: 'user-1', role: 'SCHOOL_ADMIN', isActive: true },
    ...overrides,
  };
}

describe('AuthService.impersonate', () => {
  const jwt = new JwtService({});
  const svc = new AuthService(jwt, {} as PasswordService);

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.impersonationToken.updateMany.mockResolvedValue({ count: 1 });
  });

  it('exchanges a valid token for an imp-flagged school access token and burns it', async () => {
    prismaMock.impersonationToken.findUnique.mockResolvedValue(tokenRow());
    const res = await svc.impersonate(SCHOOL, RAW);
    expect(res.impersonated).toBe(true);
    const payload = jwt.decode(res.accessToken) as Record<string, unknown>;
    expect(payload.imp).toBe(true);
    expect(payload.schoolId).toBe(SCHOOL);
    expect(payload.role).toBe('SCHOOL_ADMIN');
    expect(prismaMock.impersonationToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tok-1', usedAt: null } }),
    );
  });

  it('rejects an already-used token', async () => {
    prismaMock.impersonationToken.findUnique.mockResolvedValue(tokenRow({ usedAt: new Date() }));
    await expect(svc.impersonate(SCHOOL, RAW)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    prismaMock.impersonationToken.findUnique.mockResolvedValue(tokenRow({ expiresAt: new Date(Date.now() - 1) }));
    await expect(svc.impersonate(SCHOOL, RAW)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token minted for a different school (host mismatch)', async () => {
    prismaMock.impersonationToken.findUnique.mockResolvedValue(tokenRow());
    await expect(svc.impersonate('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', RAW)).rejects.toThrow(UnauthorizedException);
  });

  it('loses a burn race cleanly (second exchange of the same token fails)', async () => {
    prismaMock.impersonationToken.findUnique.mockResolvedValue(tokenRow());
    prismaMock.impersonationToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.impersonate(SCHOOL, RAW)).rejects.toThrow(UnauthorizedException);
  });
});

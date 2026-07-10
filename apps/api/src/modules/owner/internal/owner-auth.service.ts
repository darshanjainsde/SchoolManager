import { ForbiddenException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import type { User } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from '../../auth';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';

export interface IssuedTokens { accessToken: string; refreshToken: string; expiresIn: number; }

/** Constant-time password check (compares sha256 digests, so length never leaks). */
export function gatePasswordMatches(candidate: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Pure, unit-testable TOTP check (window ±1 step for clock skew). */
export function verifyTotp(code: string, secret: string | null): boolean {
  if (!secret) return false;
  authenticator.options = { window: 1 };
  try { return authenticator.check(code, secret); } catch { return false; }
}

@Injectable()
export class OwnerAuthService {
  private readonly env = loadEnv();
  private readonly logger = new Logger(OwnerAuthService.name);
  constructor(private readonly jwt: JwtService, private readonly passwords: PasswordService) {}

  async login(email: string, password: string, totp?: string): Promise<IssuedTokens> {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({ where: { email: email.toLowerCase(), schoolId: null, role: 'OWNER' } });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    if (user.lockedUntil && user.lockedUntil > new Date()) throw new ForbiddenException('Account temporarily locked');
    const passOk = await this.passwords.verify(user.passwordHash, password);
    // MFA is optional: a supplied code must be valid, but it isn't required.
    const totpOk = totp ? verifyTotp(totp, user.mfaSecret) : true;
    if (!passOk || !totpOk) {
      await this.recordFailedAttempt(user);
      throw new UnauthorizedException('Invalid credentials');
    }
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null } });
    return this.issue(user.id);
  }

  /**
   * Single-password console unlock for sckools.com/owner. Issues the same
   * platform tokens as email login, for the (single) OWNER user. Disabled
   * (503) unless OWNER_GATE_PASSWORD is configured.
   */
  async gateLogin(password: string): Promise<IssuedTokens> {
    if (!this.env.OWNER_GATE_PASSWORD) {
      throw new ServiceUnavailableException('Owner gate is not enabled');
    }
    if (!gatePasswordMatches(password, this.env.OWNER_GATE_PASSWORD)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const db = getPlatformPrisma();
    const owner = await db.user.findFirst({ where: { schoolId: null, role: 'OWNER', isActive: true } });
    if (!owner) throw new UnauthorizedException('Invalid credentials');
    await db.user.update({ where: { id: owner.id }, data: { lastLoginAt: new Date() } });
    this.logger.log(`Owner console unlocked via gate password (user ${owner.id})`);
    return this.issue(owner.id);
  }

  async refresh(rawToken: string): Promise<IssuedTokens> {
    let payload: { sub: string; fam: string };
    try {
      payload = this.jwt.verify(rawToken, { secret: this.env.JWT_PLATFORM_REFRESH_SECRET, audience: 'platform-refresh' });
    } catch { throw new UnauthorizedException('Invalid refresh token'); }
    const db = getPlatformPrisma();
    const tokenHash = sha256(rawToken);
    const row = await db.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt) {
      if (row) {
        await db.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      throw new UnauthorizedException('Refresh token invalid');
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    await db.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.issue(payload.sub, row.familyId);
  }

  private async issue(userId: string, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const accessPayload: Omit<PlatformJwtPayload, 'iat' | 'exp'> = { sub: userId, aud: 'platform', role: 'OWNER', jti: randomUUID() };
    const accessToken = this.jwt.sign(accessPayload, { secret: this.env.JWT_PLATFORM_ACCESS_SECRET, expiresIn: this.env.JWT_ACCESS_TTL });
    const refreshToken = this.jwt.sign({ sub: userId, fam: familyId, jti: randomUUID() }, { secret: this.env.JWT_PLATFORM_REFRESH_SECRET, audience: 'platform-refresh', expiresIn: this.env.JWT_REFRESH_TTL });
    await getPlatformPrisma().refreshToken.create({ data: { userId, schoolId: null, familyId, tokenHash: sha256(refreshToken), expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000) } });
    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL };
  }

  private async recordFailedAttempt(user: User): Promise<void> {
    const next = user.failedLoginAttempts + 1;
    const lock =
      next >= this.env.LOCKOUT_MAX_ATTEMPTS
        ? new Date(Date.now() + this.env.LOCKOUT_DURATION_SECONDS * 1000)
        : null;
    await getPlatformPrisma().user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: next, lockedUntil: lock },
    });
    if (lock) {
      this.logger.warn(`Owner user ${user.id} locked for ${this.env.LOCKOUT_DURATION_SECONDS}s`);
    }
  }
}
function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

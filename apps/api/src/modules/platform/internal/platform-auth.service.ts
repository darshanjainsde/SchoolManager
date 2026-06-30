import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { createHash, randomUUID } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import type { PlatformUser } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from '../../auth';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class PlatformAuthService {
  private readonly logger = new Logger(PlatformAuthService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
  ) {
    // Allow a small clock skew on TOTP windows.
    authenticator.options = { window: 1, step: 30 };
  }

  async login(email: string, password: string, totp: string): Promise<IssuedTokens> {
    const prisma = getPlatformPrisma();
    const user = await prisma.platformUser.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Platform account temporarily locked');
    }

    const passOk = await this.passwords.verify(user.passwordHash, password);
    const totpOk = passOk && authenticator.check(totp, user.totpSecret);

    if (!passOk || !totpOk) {
      await this.recordFailedAttempt(user);
      // Identical message regardless of which factor failed — avoids leaking which one.
      throw new UnauthorizedException('Invalid credentials');
    }

    await prisma.platformUser.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.issueTokens(user, randomUUID());
  }

  async refresh(rawToken: string): Promise<IssuedTokens> {
    // Verify the signature/audience — the payload itself is not consumed
    // because we look up state in the DB by the token's hash, not by claims.
    try {
      this.jwt.verify(rawToken, {
        secret: this.env.JWT_PLATFORM_REFRESH_SECRET,
        audience: 'platform-refresh',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const prisma = getPlatformPrisma();
    const tokenHash = sha256(rawToken);
    const existing = await prisma.platformRefreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.revokedAt) {
      if (existing) {
        await prisma.platformRefreshToken.updateMany({
          where: { familyId: existing.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token reuse detected — session terminated');
    }
    if (existing.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');

    const user = await prisma.platformUser.findUnique({ where: { id: existing.platformUserId } });
    if (!user) throw new UnauthorizedException('User no longer exists');

    const newRefresh = this.signRefresh({
      sub: user.id,
      jti: randomUUID(),
      fam: existing.familyId,
    });
    const newRow = await prisma.platformRefreshToken.create({
      data: {
        platformUserId: user.id,
        familyId: existing.familyId,
        tokenHash: sha256(newRefresh),
        expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
      },
    });
    await prisma.platformRefreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: newRow.id },
    });

    return {
      accessToken: this.signAccess(user),
      refreshToken: newRefresh,
      expiresIn: this.env.JWT_ACCESS_TTL,
    };
  }

  async logout(rawToken: string): Promise<void> {
    const hash = sha256(rawToken);
    await getPlatformPrisma()
      .platformRefreshToken.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  private async issueTokens(user: PlatformUser, familyId: string): Promise<IssuedTokens> {
    const refreshToken = this.signRefresh({ sub: user.id, jti: randomUUID(), fam: familyId });
    await getPlatformPrisma().platformRefreshToken.create({
      data: {
        platformUserId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
      },
    });
    return {
      accessToken: this.signAccess(user),
      refreshToken,
      expiresIn: this.env.JWT_ACCESS_TTL,
    };
  }

  private signAccess(user: PlatformUser): string {
    const payload: Omit<PlatformJwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      aud: 'platform',
      role: user.role,
      jti: randomUUID(),
    };
    return this.jwt.sign(payload, {
      secret: this.env.JWT_PLATFORM_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });
  }

  private signRefresh(p: { sub: string; jti: string; fam: string }): string {
    return this.jwt.sign(p, {
      secret: this.env.JWT_PLATFORM_REFRESH_SECRET,
      audience: 'platform-refresh',
      expiresIn: this.env.JWT_REFRESH_TTL,
    });
  }

  private async recordFailedAttempt(user: PlatformUser): Promise<void> {
    const next = user.failedLoginAttempts + 1;
    const lock =
      next >= this.env.LOCKOUT_MAX_ATTEMPTS
        ? new Date(Date.now() + this.env.LOCKOUT_DURATION_SECONDS * 1000)
        : null;
    await getPlatformPrisma().platformUser.update({
      where: { id: user.id },
      data: { failedLoginAttempts: next, lockedUntil: lock },
    });
    if (lock) {
      this.logger.warn(
        `Platform user ${user.id} locked for ${this.env.LOCKOUT_DURATION_SECONDS}s`,
      );
    }
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

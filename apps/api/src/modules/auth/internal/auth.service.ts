import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import type { User } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { PasswordService } from './password.service';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly env = loadEnv();

  constructor(
    private readonly jwt: JwtService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Look up by (schoolId, email). User row lookup uses the platform connection
   * because we have not yet established the request's tenant scope from a JWT;
   * the schoolId is trusted because it comes from the tenant-resolved Host.
   */
  async login(schoolId: string, email: string, password: string): Promise<IssuedTokens> {
    const platform = getPlatformPrisma();
    const user = await platform.user.findUnique({
      where: { schoolId_email: { schoolId, email: email.toLowerCase() } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account temporarily locked');
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      await this.recordFailedAttempt(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Successful login — reset counters and issue a fresh token family.
    await platform.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    return this.issueTokens(user, randomUUID(), schoolId);
  }

  async refresh(rawToken: string): Promise<IssuedTokens> {
    let payload: { sub: string; jti: string; fam: string; schoolId: string };
    try {
      payload = this.jwt.verify(rawToken, {
        secret: this.env.JWT_SCHOOL_REFRESH_SECRET,
        audience: 'school-refresh',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = sha256(rawToken);

    // Reuse detection runs in its own committed transaction so a throw can't
    // roll back the family-wide revocation. Only after that's persisted do we
    // surface the 401.
    const existing0 = await withTenant(payload.schoolId, async (tx) =>
      tx.refreshToken.findUnique({ where: { tokenHash } }),
    );
    if (!existing0 || existing0.revokedAt) {
      if (existing0) {
        await withTenant(payload.schoolId, async (tx) => {
          await tx.refreshToken.updateMany({
            where: { familyId: existing0.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        });
      }
      throw new UnauthorizedException('Refresh token reuse detected — session terminated');
    }

    // Happy path: rotate inside a single tenant-scoped transaction (defeats races).
    return withTenant(payload.schoolId, async (tx) => {
      const existing = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!existing || existing.revokedAt) {
        // Lost a race with the reuse detector above — re-check and reject.
        throw new UnauthorizedException('Refresh token reuse detected — session terminated');
      }
      if (existing.expiresAt < new Date()) {
        throw new UnauthorizedException('Refresh token expired');
      }

      const user = await tx.user.findUnique({ where: { id: existing.userId } });
      if (!user || !user.isActive) throw new UnauthorizedException('User no longer active');

      // Mint new tokens within the same family, mark the old one revoked.
      const newJti = randomUUID();
      const newRefresh = this.signRefresh({
        sub: user.id,
        jti: newJti,
        fam: existing.familyId,
        schoolId: payload.schoolId,
      });

      const newHash = sha256(newRefresh);
      const newRow = await tx.refreshToken.create({
        data: {
          schoolId: payload.schoolId,
          userId: user.id,
          familyId: existing.familyId,
          tokenHash: newHash,
          expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
        },
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedById: newRow.id },
      });

      const accessToken = this.signAccess(user, payload.schoolId);
      return { accessToken, refreshToken: newRefresh, expiresIn: this.env.JWT_ACCESS_TTL };
    });
  }

  /**
   * Exchanges a single-use owner-minted impersonation token for a short-lived
   * school-admin session. No refresh token is issued — the session hard-ends
   * when the access token expires, and the `imp` claim lets the UI show an
   * "Owner view" banner.
   */
  async impersonate(schoolId: string, rawToken: string): Promise<{ accessToken: string; expiresIn: number; impersonated: true }> {
    const db = getPlatformPrisma();
    const row = await db.impersonationToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: true },
    });
    const invalid =
      !row ||
      row.usedAt !== null ||
      row.expiresAt < new Date() ||
      row.schoolId !== schoolId ||
      !row.user.isActive;
    if (invalid) throw new UnauthorizedException('This impersonation link is invalid or has expired');

    // Burn before issuing: a raced second exchange must lose.
    const burned = await db.impersonationToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (burned.count === 0) throw new UnauthorizedException('This impersonation link is invalid or has expired');

    const payload: Omit<SchoolJwtPayload, 'iat' | 'exp'> = {
      sub: row.user.id,
      aud: 'school',
      schoolId,
      role: row.user.role,
      jti: randomUUID(),
      imp: true,
    };
    const accessToken = this.jwt.sign(payload, {
      secret: this.env.JWT_SCHOOL_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });
    this.logger.warn(`Impersonation session started for user ${row.user.id} (school ${schoolId})`);
    return { accessToken, expiresIn: this.env.JWT_ACCESS_TTL, impersonated: true };
  }

  async logout(schoolId: string, rawToken: string): Promise<void> {
    const hash = sha256(rawToken);
    await withTenant(schoolId, async (tx) => {
      await tx.refreshToken.updateMany({
        where: { tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }).catch(() => undefined);
  }

  private async issueTokens(user: User, familyId: string, schoolId: string): Promise<IssuedTokens> {
    const accessToken = this.signAccess(user, schoolId);
    const refreshToken = this.signRefresh({
      sub: user.id,
      jti: randomUUID(),
      fam: familyId,
      schoolId,
    });

    // Persist refresh-token hash so we can detect reuse.
    await withTenant(schoolId, (tx) =>
      tx.refreshToken.create({
        data: {
          schoolId,
          userId: user.id,
          familyId,
          tokenHash: sha256(refreshToken),
          expiresAt: new Date(Date.now() + this.env.JWT_REFRESH_TTL * 1000),
        },
      }),
    );

    return { accessToken, refreshToken, expiresIn: this.env.JWT_ACCESS_TTL };
  }

  private signAccess(user: User, schoolId: string): string {
    const payload: Omit<SchoolJwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      aud: 'school',
      schoolId,
      role: user.role,
      jti: randomUUID(),
    };
    return this.jwt.sign(payload, {
      secret: this.env.JWT_SCHOOL_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });
  }

  private signRefresh(p: { sub: string; jti: string; fam: string; schoolId: string }): string {
    return this.jwt.sign(p, {
      secret: this.env.JWT_SCHOOL_REFRESH_SECRET,
      audience: 'school-refresh',
      expiresIn: this.env.JWT_REFRESH_TTL,
    });
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
      this.logger.warn(`User ${user.id} locked for ${this.env.LOCKOUT_DURATION_SECONDS}s`);
    }
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

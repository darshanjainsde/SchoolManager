import { randomUUID, createHash } from 'node:crypto';
import { Inject, Injectable, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getLibraryPlatformPrisma } from '@library/db';
import { loadLibraryEnv } from '../../../config/env';
import { TenancyModule } from '../../tenancy';
import { AuthController } from './auth.controller';
import { AuthService, type AuthStore, type AuthUserRow, type TokenIssuer } from './auth.service';
import { PasswordService } from './password.service';
import type { LibJwtPayload } from './lib-jwt.guard';

/**
 * Account lockout policy. Lives here (not env) because it's a security
 * default, not a per-deployment tunable — same posture as the sibling
 * system's LOCKOUT_MAX_ATTEMPTS / LOCKOUT_DURATION_SECONDS.
 */
const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function toAuthUserRow(user: {
  id: string; orgId: string; role: string; branchIds: string[];
  passwordHash: string; active: boolean; failedAttempts: number; lockedUntil: Date | null;
}): AuthUserRow {
  return {
    id: user.id,
    orgId: user.orgId,
    role: user.role,
    branchIds: user.branchIds,
    passwordHash: user.passwordHash,
    active: user.active,
    failedAttempts: user.failedAttempts,
    lockedUntil: user.lockedUntil,
  };
}

/**
 * Login runs before any tenant scope exists to look the user up under, so
 * every query here uses the BYPASSRLS platform client and re-scopes by
 * `orgId` explicitly in code — the same pattern org.middleware.ts uses for
 * host lookup. `recordFailure`/`recordSuccess` key on `userId` alone (the
 * primary key), which is safe without an orgId filter because it is only
 * ever called with the id of a row `findByIdentifier` already matched to the
 * caller-supplied orgId.
 */
class PrismaAuthStore implements AuthStore {
  async findByIdentifier(orgId: string, identifier: string): Promise<AuthUserRow | null> {
    const platform = getLibraryPlatformPrisma();
    const user = identifier.includes('@')
      ? await platform.libUser.findFirst({ where: { orgId, email: { equals: identifier, mode: 'insensitive' } } })
      : await platform.libUser.findFirst({ where: { orgId, phone: identifier } });
    return user ? toAuthUserRow(user) : null;
  }

  async recordFailure(userId: string): Promise<void> {
    const platform = getLibraryPlatformPrisma();
    const { failedAttempts } = await platform.libUser.update({
      where: { id: userId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    if (failedAttempts >= LOCKOUT_MAX_ATTEMPTS) {
      await platform.libUser.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
      });
    }
  }

  async recordSuccess(userId: string): Promise<void> {
    const platform = getLibraryPlatformPrisma();
    await platform.libUser.update({
      where: { id: userId },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }
}

/**
 * Mints access tokens directly and issues the *first* refresh token for a
 * session. This is deliberately minimal: it creates one `RefreshToken` row
 * (family root) so login has something to hand back, but rotation, reuse
 * detection and family-wide revocation on refresh belong to Task 8's
 * `RefreshService`. Do not extend this class with that behaviour — add a
 * `POST /auth/refresh` endpoint backed by its own service instead.
 *
 * @Inject(JwtService) is explicit, not a bare typed param: tsx does not
 * reliably emit design:paramtypes decorator metadata (confirmed at
 * runtime), so a `useClass` provider relying on implicit type-based DI gets
 * `jwt: undefined` here instead of a bootstrap error.
 */
@Injectable()
class JwtTokenIssuer implements TokenIssuer {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  signAccess(user: AuthUserRow): string {
    const env = loadLibraryEnv();
    const payload: Omit<LibJwtPayload, never> = {
      sub: user.id,
      org: user.orgId,
      role: user.role as LibJwtPayload['role'],
      branches: user.branchIds,
      aud: 'library',
    };
    // No `audience` sign option here: jsonwebtoken rejects signing when the
    // payload already carries an `aud` key AND options.audience is also set
    // ("Bad options.audience option. The payload already has an aud
    // property.") — confirmed at runtime. LibJwtGuard's verify() still checks
    // it via its own `audience: 'library'` option, which reads payload.aud
    // regardless of how it got there.
    return this.jwt.sign(payload, {
      secret: env.LIBRARY_JWT_SECRET,
      expiresIn: env.LIBRARY_ACCESS_TTL,
    });
  }

  async issueRefresh(user: AuthUserRow): Promise<string> {
    const env = loadLibraryEnv();
    const familyId = randomUUID();
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + env.LIBRARY_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    const refreshToken = this.jwt.sign(
      { sub: user.id, org: user.orgId, jti, fam: familyId },
      {
        secret: env.LIBRARY_REFRESH_SECRET,
        audience: 'library-refresh',
        expiresIn: `${env.LIBRARY_REFRESH_TTL_DAYS}d`,
      },
    );
    await getLibraryPlatformPrisma().refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt,
      },
    });
    return refreshToken;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Module({
  imports: [TenancyModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    JwtService,
    { provide: 'AUTH_STORE', useClass: PrismaAuthStore },
    { provide: 'TOKEN_ISSUER', useClass: JwtTokenIssuer },
    {
      provide: AuthService,
      useFactory: (store: AuthStore, passwords: PasswordService, tokens: TokenIssuer) =>
        new AuthService(store, passwords, tokens),
      inject: ['AUTH_STORE', PasswordService, 'TOKEN_ISSUER'],
    },
  ],
  exports: [PasswordService],
})
export class AuthModule {}

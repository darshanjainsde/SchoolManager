import { Inject, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getLibraryPlatformPrisma } from '@library/db';
import { loadLibraryEnv } from '../../../config/env';
import { TenancyModule } from '../../tenancy';
import { AuthController } from './auth.controller';
import { AuthService, type AuthStore, type AuthUserRow, type TokenIssuer } from './auth.service';
import { PasswordService } from './password.service';
import { SckoolsBridgeService } from './sckools-bridge.service';
import {
  RefreshService,
  type AccessSigner,
  type GraceReplayEvent,
  type RefreshRow,
  type RefreshStore,
} from './refresh.service';
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
 * Shared by both `JwtTokenIssuer.signAccess` (login) and `JwtAccessSigner`
 * (refresh rotation) so a rotated access token is byte-for-byte the same
 * shape as one minted at login — one payload-building code path, not two
 * that could drift apart.
 *
 * No `audience` sign option here: jsonwebtoken rejects signing when the
 * payload already carries an `aud` key AND options.audience is also set
 * ("Bad options.audience option. The payload already has an aud
 * property.") — confirmed at runtime. LibJwtGuard's verify() still checks
 * it via its own `audience: 'library'` option, which reads payload.aud
 * regardless of how it got there.
 */
/**
 * Exported (unlike most of this file's internals) so test helpers can mint
 * tokens shaped byte-for-byte like a real login response instead of
 * reimplementing the payload/sign call from memory — see
 * `test/helpers/live-db.ts`'s `seedLogins`.
 */
export function signAccessToken(
  jwt: JwtService,
  user: { id: string; orgId: string; role: string; branchIds: string[] },
): string {
  const env = loadLibraryEnv();
  const payload: Omit<LibJwtPayload, never> = {
    sub: user.id,
    org: user.orgId,
    role: user.role as LibJwtPayload['role'],
    branches: user.branchIds,
    aud: 'library',
  };
  return jwt.sign(payload, {
    secret: env.LIBRARY_JWT_SECRET,
    expiresIn: env.LIBRARY_ACCESS_TTL,
  });
}

/**
 * Mints access tokens and delegates all refresh-token issuance to
 * `RefreshService` (Task 8) — this class no longer touches `RefreshToken`
 * rows itself. Task 7 built this as a deliberately minimal seam; rotation,
 * reuse detection and family-wide revocation now live in `RefreshService`.
 *
 * @Inject(...) explicit, not bare typed params: tsx does not reliably emit
 * design:paramtypes decorator metadata (confirmed at runtime), so a
 * `useClass` provider relying on implicit type-based DI silently gets
 * `undefined` deps here instead of a bootstrap error.
 */
@Injectable()
class JwtTokenIssuer implements TokenIssuer {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(RefreshService) private readonly refresh: RefreshService,
  ) {}

  signAccess(user: AuthUserRow): string {
    return signAccessToken(this.jwt, user);
  }

  issueRefresh(user: AuthUserRow): Promise<string> {
    return this.refresh.issue(user);
  }
}

/** Thin adapter so `RefreshService` can sign access tokens without knowing about Nest's `JwtService`. */
@Injectable()
class JwtAccessSigner implements AccessSigner {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  signAccess(user: { id: string; orgId: string; role: string; branchIds: string[] }): string {
    return signAccessToken(this.jwt, user);
  }
}

/**
 * Refresh-token lookups run on the BYPASSRLS platform client for the same
 * reason `PrismaAuthStore` does: a refresh request carries no authenticated
 * tenant scope to bind an RLS session to. Every query here is still
 * reasoned about for cross-tenant safety even though none of them takes an
 * explicit `orgId`:
 *
 *   - `findByHash` looks up by `tokenHash`, which is `@unique` in the schema
 *     — the hash is itself the scope. Producing it at all requires having
 *     possessed the raw 384-bit token, so this is a point lookup that can
 *     resolve to at most one org's row, never a cross-org listing.
 *   - `markUsed` / `revokeFamily` / `loadUser` never take caller-supplied
 *     ids. They're only ever called with an `id` / `familyId` / `userId`
 *     read off the row `findByHash` already matched — same pattern
 *     `PrismaAuthStore.recordFailure/recordSuccess` documents above.
 *   - `create` performs no query at all.
 *
 * `markUsed` additionally guards `revokedAt: null` in its WHERE clause
 * (not just its SET) and checks the affected row count: without that, two
 * concurrent `rotate()` calls racing on the same still-valid raw token would
 * both pass `RefreshService`'s revoked/expired checks (both read the row
 * before either write lands) and both mint a fresh child token — silently
 * doubling the family instead of the intended one-child-per-parent rotation.
 * The conditional update makes the *first* writer's consumption authoritative;
 * the loser's `count` comes back 0 and it throws — `RefreshService.rotate`
 * catches that and re-reads the row, which now carries the WINNER's
 * `supersededAt` (set in this same UPDATE's SET clause, so there is no
 * window where the row is marked used without yet recording when), and
 * treats it as an ordinary grace-window replay rather than theft.
 *
 * `loadUser` also checks `active`: a deactivated account's stolen refresh
 * token otherwise keeps minting valid access tokens forever, even though
 * `AuthService.login` already refuses `active: false` at the password gate.
 *
 * Exported (unlike `PrismaAuthStore`) so `test/refresh-store.e2e.spec.ts`
 * can exercise `markUsed`'s conditional update directly against real
 * Postgres — the double-mint race it closes is a database guarantee
 * (concurrent UPDATE ... WHERE re-evaluation under READ COMMITTED), not
 * something a mocked `RefreshStore` in a unit test could ever prove.
 */
export class PrismaRefreshStore implements RefreshStore {
  async findByHash(hash: string): Promise<RefreshRow | null> {
    const row = await getLibraryPlatformPrisma().refreshToken.findUnique({ where: { tokenHash: hash } });
    return row
      ? {
          id: row.id, userId: row.userId, familyId: row.familyId, revokedAt: row.revokedAt, expiresAt: row.expiresAt,
          supersededAt: row.supersededAt,
        }
      : null;
  }

  async create(row: { userId: string; tokenHash: string; familyId: string; expiresAt: Date }): Promise<void> {
    await getLibraryPlatformPrisma().refreshToken.create({ data: row });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await getLibraryPlatformPrisma().refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async markUsed(id: string, supersededAt: Date): Promise<void> {
    const { count } = await getLibraryPlatformPrisma().refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), supersededAt },
    });
    if (count === 0) throw new UnauthorizedException();
  }

  async loadUser(userId: string): Promise<{ id: string; orgId: string; role: string; branchIds: string[] }> {
    const user = await getLibraryPlatformPrisma().libUser.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException();
    return { id: user.id, orgId: user.orgId, role: user.role, branchIds: user.branchIds };
  }

  /**
   * A grace-window replay is expected occasionally by design — that's the
   * feature working, not an anomaly — so this writes a plain `AuditLog` row
   * (queryable, org-scoped, countable per family/user over a window) rather
   * than a warn-level log line, which would either spam on every legitimate
   * double-tap or get filtered out and stop meaning anything either way.
   * Carries only ids and a duration — never the token or its hash.
   */
  async recordGraceReplay(event: GraceReplayEvent): Promise<void> {
    await getLibraryPlatformPrisma().auditLog.create({
      data: {
        orgId: event.orgId,
        actorUserId: event.userId,
        action: 'auth.refresh.grace_replay',
        entity: 'RefreshToken',
        entityId: event.refreshTokenId,
        after: { familyId: event.familyId, replayedAfterMs: event.replayedAfterMs },
      },
    });
  }

  /**
   * Same conditional-update shape as `markUsed`: the cap is enforced in the
   * WHERE clause of a single UPDATE, not read in one query and checked in
   * application code before a second write. That matters exactly the way it
   * matters for `markUsed` — under concurrent callers, Postgres serializes
   * writers to the same row (each UPDATE takes the row lock, and the next
   * waiting writer re-evaluates its WHERE clause against the value the
   * previous one just committed, not a stale value read before either
   * wrote). A read-then-write version (`SELECT graceReplayCount` then `if
   * (count < cap) UPDATE`) would let two concurrent replays both read the
   * same pre-increment count and both pass, silently letting the family
   * exceed the cap — exactly the bug this shape exists to prevent.
   */
  async incrementGraceReplay(id: string, cap: number): Promise<boolean> {
    const { count } = await getLibraryPlatformPrisma().refreshToken.updateMany({
      where: { id, graceReplayCount: { lt: cap } },
      data: { graceReplayCount: { increment: 1 } },
    });
    return count > 0;
  }
}

@Module({
  imports: [TenancyModule],
  controllers: [AuthController],
  providers: [
    PasswordService,
    JwtService,
    { provide: 'AUTH_STORE', useClass: PrismaAuthStore },
    { provide: 'REFRESH_STORE', useClass: PrismaRefreshStore },
    { provide: 'ACCESS_SIGNER', useClass: JwtAccessSigner },
    {
      provide: RefreshService,
      useFactory: (store: RefreshStore, signer: AccessSigner) =>
        new RefreshService(store, signer, loadLibraryEnv().LIBRARY_REFRESH_TTL_DAYS),
      inject: ['REFRESH_STORE', 'ACCESS_SIGNER'],
    },
    { provide: 'TOKEN_ISSUER', useClass: JwtTokenIssuer },
    // Verifies a Sckools token with a PUBLIC key and mints an ordinary library
    // one — see the service for why it is never a shared secret.
    SckoolsBridgeService,
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

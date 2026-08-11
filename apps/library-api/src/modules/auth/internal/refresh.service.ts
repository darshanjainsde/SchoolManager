import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface RefreshRow {
  id: string; userId: string; familyId: string; revokedAt: Date | null; expiresAt: Date;
  /**
   * Set when this row was rotated normally (as opposed to being replayed
   * after the fact). `null` until the first successful rotation.
   */
  supersededAt: Date | null;
  /**
   * The RAW replacement refresh token minted when this row was superseded —
   * NOT a hash. `tokenHash` is one-way (SHA-256), so the raw value can never
   * be recovered from it, and a client legitimately replaying this parent
   * within the grace window needs a token it can actually authenticate
   * with. This field is therefore itself a live, single-use bearer secret —
   * the exact token the rotation winner already holds — and must be handled
   * with the same care as a raw refresh token anywhere else in this file:
   * never logged, and reachable only through the platform (BYPASSRLS)
   * store. See `RefreshToken.replacedByToken` in schema.prisma and
   * `RLS_ALLOW_LIST` in packages/library-db/src/rls-audit.ts for why this
   * table carries no RLS policy by design.
   */
  replacedByToken: string | null;
}

export interface RefreshStore {
  findByHash(hash: string): Promise<RefreshRow | null>;
  create(row: { userId: string; tokenHash: string; familyId: string; expiresAt: Date }): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  /**
   * Atomically marks the parent row used AND records what it was superseded
   * by, in the same conditional write (`WHERE id, revokedAt: null`) that
   * already arbitrates concurrent rotations — the grace-window bookkeeping
   * rides along with the existing atomicity guarantee rather than adding a
   * second, non-atomic write. Throws `UnauthorizedException` (count === 0)
   * when a concurrent rotation already consumed this row first; the caller
   * is expected to re-read and treat that exactly like any other replay.
   */
  markUsed(id: string, replacement: { supersededAt: Date; replacedByToken: string }): Promise<void>;
  loadUser(userId: string): Promise<{ id: string; orgId: string; role: string; branchIds: string[] }>;
}

export interface AccessSigner { signAccess(user: { id: string; orgId: string; role: string; branchIds: string[] }): string }

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/**
 * How long after a normal rotation a replay of the parent is treated as a
 * duplicate request rather than theft. Covers double-taps, duplicate tabs
 * sharing storage, and mobile retry-on-timeout — all of which produce two
 * concurrent `rotate()` calls on one still-valid token, where the loser's
 * read (or losing write) would otherwise look identical to a thief
 * replaying an already-used token. Long enough to absorb a retry, far
 * shorter than any plausible offline-theft window.
 *
 * Exposed only as the default; `RefreshService`'s constructor takes an
 * explicit `graceMs` override so tests can prove the window discriminates
 * (set it to 0 and watch a genuine concurrent retry start failing) without
 * mutating shared module state, which — unlike a constructor parameter —
 * would leak between test files/instances and isn't reassignable through a
 * TS namespace import in the first place.
 */
export const REFRESH_GRACE_MS = 15_000;

@Injectable()
export class RefreshService {
  constructor(
    private readonly store: RefreshStore,
    private readonly signer: AccessSigner,
    private readonly ttlDays: number,
    private readonly graceMs: number = REFRESH_GRACE_MS,
  ) {}

  async issue(user: { id: string }, familyId: string = randomUUID()): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    await this.persistChild(user.id, familyId, raw);
    return raw;
  }

  private async persistChild(userId: string, familyId: string, raw: string): Promise<void> {
    await this.store.create({
      userId,
      tokenHash: sha256(raw),
      familyId,
      expiresAt: new Date(Date.now() + this.ttlDays * 86_400_000),
    });
  }

  /**
   * Replay of an already-revoked token normally means the token was stolen:
   * the thief and the owner now both hold tokens in the same family.
   * Revoking the family — in its own committed write, BEFORE the 401 — logs
   * both out rather than letting the thief keep rotating.
   *
   * The exception is a row revoked by a NORMAL rotation within the last
   * `graceMs`: that is not theft, it's a concurrent retry (the loser of a
   * double-tap / duplicate-tab / mobile-retry race) reading or writing after
   * the winner already rotated. In that narrow window we hand back the same
   * replacement the winner already minted instead of revoking the family —
   * revoking here would log the legitimate winner out for retrying.
   */
  private async handleReplay(row: RefreshRow): Promise<{ accessToken: string; refreshToken: string }> {
    const superseded = row.supersededAt?.getTime();
    const withinGrace = superseded !== undefined && Date.now() - superseded <= this.graceMs;
    if (withinGrace && row.replacedByToken) {
      const user = await this.store.loadUser(row.userId);
      return { accessToken: this.signer.signAccess(user), refreshToken: row.replacedByToken };
    }
    await this.store.revokeFamily(row.familyId);
    throw new UnauthorizedException();
  }

  async rotate(raw: string): Promise<{ accessToken: string; refreshToken: string }> {
    const row = await this.store.findByHash(sha256(raw));
    if (!row) throw new UnauthorizedException();

    if (row.revokedAt) return this.handleReplay(row);
    if (row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();

    // Generated up front (not inside `issue()`) because `markUsed` must
    // persist it as `replacedByToken` in the very same atomic write that
    // marks the parent used — otherwise a concurrent loser reading between
    // "parent marked used" and "child recorded" would find a revoked row
    // with no replacement to hand back, and get treated as theft anyway.
    const childRaw = randomBytes(48).toString('base64url');
    try {
      await this.store.markUsed(row.id, { supersededAt: new Date(), replacedByToken: childRaw });
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        // Lost the race: a concurrent sibling call already consumed this
        // row first. Re-read what the winner wrote and treat this exactly
        // like any other replay of a revoked token — within grace, hand
        // back the WINNER's child (never this call's own discarded
        // `childRaw`); outside it, revoke the family.
        const fresh = await this.store.findByHash(sha256(raw));
        if (fresh?.revokedAt) return this.handleReplay(fresh);
      }
      throw err;
    }

    const user = await this.store.loadUser(row.userId);
    await this.persistChild(user.id, row.familyId, childRaw);
    return { accessToken: this.signer.signAccess(user), refreshToken: childRaw };
  }
}

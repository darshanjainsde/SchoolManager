import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

export interface RefreshRow {
  id: string; userId: string; familyId: string; revokedAt: Date | null; expiresAt: Date;
  /**
   * Set when this row was rotated normally (as opposed to being replayed
   * after the fact). `null` until the first successful rotation.
   */
  supersededAt: Date | null;
}

/** Emitted on every grace-window replay so the event is investigable after the fact — see `RefreshService`'s grace-hit doc comment for why this exists and what it deliberately omits. */
export interface GraceReplayEvent {
  userId: string;
  orgId: string;
  refreshTokenId: string;
  familyId: string;
  /** Milliseconds between the row's `supersededAt` and this replay. */
  replayedAfterMs: number;
}

export interface RefreshStore {
  findByHash(hash: string): Promise<RefreshRow | null>;
  create(row: { userId: string; tokenHash: string; familyId: string; expiresAt: Date }): Promise<void>;
  revokeFamily(familyId: string): Promise<void>;
  /**
   * Atomically marks the parent row used AND records when it was
   * superseded, in the same conditional write (`WHERE id, revokedAt: null`)
   * that already arbitrates concurrent rotations — the grace-window
   * bookkeeping rides along with the existing atomicity guarantee rather
   * than adding a second, non-atomic write. Throws `UnauthorizedException`
   * (count === 0) when a concurrent rotation already consumed this row
   * first; the caller is expected to re-read and treat that exactly like
   * any other replay.
   */
  markUsed(id: string, supersededAt: Date): Promise<void>;
  loadUser(userId: string): Promise<{ id: string; orgId: string; role: string; branchIds: string[] }>;
  /**
   * Best-effort audit signal for a grace-window replay (see
   * `RefreshService.recordGraceReplay`). Never carries a token or a hash —
   * only ids and a duration.
   */
  recordGraceReplay(event: GraceReplayEvent): Promise<void>;
  /**
   * Atomically increments `graceReplayCount` on row `id` IFF it is
   * currently below `cap`, and reports whether it did — the same
   * conditional-update pattern `markUsed` uses (`WHERE id AND
   * graceReplayCount < cap`, not just the SET), so two concurrent replays
   * cannot both read the same pre-increment count and both pass. Returns
   * `false` when the cap was already reached (or the row no longer
   * matches), which the caller treats as theft.
   */
  incrementGraceReplay(id: string, cap: number): Promise<boolean>;
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

/**
 * How many grace-window replays of the SAME parent are allowed before a
 * further replay is treated as theft instead of another retry.
 *
 * This is not a rate limit bolted on after the time window — it IS a theft
 * signal in its own right, on the same footing as `REFRESH_GRACE_MS`. A
 * genuine double-tap or duplicate tab produces one or two replays of the
 * same parent; a mobile retry chain might produce three. Meaningfully more
 * than that inside the same few seconds is not a client retrying — it's
 * someone (anyone who obtained the raw parent token, which without this cap
 * is also all a legitimate concurrent-rotation loser needs) working the
 * window to mint an unbounded number of independent, full-TTL bearer
 * tokens. The correct response to THAT is the same theft response as any
 * other replay outside the window: revoke the family. 3 is chosen to
 * comfortably cover the legitimate cases named above with one to spare,
 * while making a working-the-window pattern (e.g. 10 rapid replays) fail
 * fast rather than exhaust some larger budget first.
 */
export const REFRESH_GRACE_REPLAY_CAP = 3;

@Injectable()
export class RefreshService {
  constructor(
    private readonly store: RefreshStore,
    private readonly signer: AccessSigner,
    private readonly ttlDays: number,
    private readonly graceMs: number = REFRESH_GRACE_MS,
    private readonly graceReplayCap: number = REFRESH_GRACE_REPLAY_CAP,
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
   * Best-effort: a failure recording the audit event must never turn a
   * legitimate grace-window reply into a 401 for the caller, but silently
   * losing the signal entirely defeats the point of emitting it, so a
   * failure is at minimum surfaced structurally.
   */
  private async recordGraceReplay(event: GraceReplayEvent): Promise<void> {
    try {
      await this.store.recordGraceReplay(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[RefreshService] failed to record grace-replay audit event', {
        familyId: event.familyId,
        refreshTokenId: event.refreshTokenId,
        err,
      });
    }
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
   * the winner already rotated. In that narrow window we mint and return a
   * FRESH child in the same family rather than revoking it — revoking here
   * would log the legitimate winner out for retrying.
   *
   * Deliberately a FRESH child, not the winner's own child handed back
   * again: an earlier version of this stored the winner's raw child token
   * on the row so every replayer could be given the identical value, but
   * that meant a live, directly-usable bearer secret sat in the database
   * for the row's entire life on every ordinary (non-replayed) rotation —
   * trading away the one property hashing `tokenHash` exists to provide.
   * Minting fresh needs nothing extra stored: N concurrent duplicate
   * callers (the "5-way contention" scenario from Phase 0a) each get their
   * own distinct, independently valid child, all in the same family, all
   * legitimate, all superseded by whichever one the client's next normal
   * rotation actually uses.
   *
   * Every hit through this branch is expected occasionally — that's the
   * feature working as designed, not an anomaly — so it is recorded as a
   * plain audit event (queryable/thresholdable) rather than a warn-level
   * log that would train operators to ignore it.
   *
   * Being inside the time window is necessary but not sufficient: this row
   * must ALSO still be under `graceReplayCap`, checked and incremented
   * atomically by `incrementGraceReplay` (same conditional-update pattern
   * as `markUsed`, so concurrent replays cannot all read the same
   * pre-increment count and all pass — see `REFRESH_GRACE_REPLAY_CAP`'s doc
   * for why the cap exists at all, not just how it's enforced). Crossing
   * it falls through to the exact same theft response as being outside the
   * time window — no separate branch, no separate audit action — because
   * that's what it is: a second, count-based theft signal alongside the
   * time-based one.
   */
  private async handleReplay(row: RefreshRow): Promise<{ accessToken: string; refreshToken: string }> {
    const superseded = row.supersededAt?.getTime();
    const withinGrace = superseded !== undefined && Date.now() - superseded <= this.graceMs;
    if (withinGrace && await this.store.incrementGraceReplay(row.id, this.graceReplayCap)) {
      const user = await this.store.loadUser(row.userId);
      await this.recordGraceReplay({
        userId: user.id,
        orgId: user.orgId,
        refreshTokenId: row.id,
        familyId: row.familyId,
        replayedAfterMs: Date.now() - superseded!,
      });
      return {
        accessToken: this.signer.signAccess(user),
        refreshToken: await this.issue(user, row.familyId),
      };
    }
    await this.store.revokeFamily(row.familyId);
    throw new UnauthorizedException();
  }

  async rotate(raw: string): Promise<{ accessToken: string; refreshToken: string }> {
    const row = await this.store.findByHash(sha256(raw));
    if (!row) throw new UnauthorizedException();

    if (row.revokedAt) return this.handleReplay(row);
    if (row.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();

    try {
      await this.store.markUsed(row.id, new Date());
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        // Lost the race: a concurrent sibling call already consumed this
        // row first. Re-read what the winner wrote and treat this exactly
        // like any other replay of a revoked token — within grace, mint a
        // fresh child of our own; outside it, revoke the family.
        const fresh = await this.store.findByHash(sha256(raw));
        if (fresh?.revokedAt) return this.handleReplay(fresh);
      }
      throw err;
    }

    const user = await this.store.loadUser(row.userId);
    return {
      accessToken: this.signer.signAccess(user),
      refreshToken: await this.issue(user, row.familyId),
    };
  }
}

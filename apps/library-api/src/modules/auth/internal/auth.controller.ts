import { Body, Controller, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrgContextService } from '../../tenancy';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto';
import { RefreshService } from './refresh.service';
import { loginIdentityTracker, refreshIdentityTracker } from './throttle-trackers';

/**
 * Explicit @Inject() tokens, not bare typed constructor params: tsx does not
 * reliably emit `design:paramtypes` decorator metadata (verified — it comes
 * back `undefined` at runtime here), so Nest's type-based autowiring silently
 * resolves to nothing instead of throwing. Same constraint org.middleware.ts
 * already documents for functional middleware; it turns out to bite typed
 * controller constructors too, not just middleware DI.
 */
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(RefreshService) private readonly refreshService: RefreshService,
  ) {}

  // Two independent throttlers, per spec §9.4 — a per-IP bucket alone
  // punishes a whole NAT'd school for one busy morning (see the review
  // arithmetic this replaced: N devices each refreshing once per access-TTL
  // crosses 30/min at ~450 concurrent devices, plausible for one school's
  // egress and worst exactly at class-start). `identity` keys on (org,
  // identifier) — the 5-per-15-min attempt budget the spec actually means —
  // via `loginIdentityTracker` (throttle-trackers.ts); `default` stays a
  // looser, genuinely IP-keyed ceiling (its ordinary req.ip tracker, just
  // with this route's own tighter limit/ttl) so one IP grinding through many
  // different identifiers is still bounded.
  @Throttle({
    default: { limit: 20, ttl: 900_000 },
    identity: { limit: 5, ttl: 900_000, getTracker: loginIdentityTracker },
  })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(this.orgs.requireOrgId(), dto.identifier, dto.password);
  }

  // @Throttle here (added on review): the earlier reasoning that a 384-bit
  // token isn't guessable is still true, but it assumes the caller doesn't
  // already hold a valid one. The grace-window replay cap
  // (REFRESH_GRACE_REPLAY_CAP in refresh.service.ts) is the real defence
  // against someone who DOES hold a valid parent token firing rapid
  // replays — this throttle is a second, coarser layer bounding overall
  // request volume against this route regardless of which token is being
  // presented.
  //
  // `identity` (not `default`) carries the 30/min number, keyed on a hash
  // of the presented refresh token via `refreshIdentityTracker` — the
  // original per-IP 30/min was wrong for the same reason login's was: a
  // legitimate client refreshes roughly once per LIBRARY_ACCESS_TTL (15m
  // default), so a shared-IP school with several dozen concurrently-active
  // devices could cross an IP-keyed 30/min on its own, and the arithmetic
  // gets worse exactly at class-start when refreshes cluster. Keying on the
  // token means each device gets its own 30/min, not a shared one. `default`
  // is deliberately left at the module's own 100/min-per-IP setting — a
  // looser second layer, not a number this route needs to name itself.
  @Throttle({ identity: { limit: 30, ttl: 60_000, getTracker: refreshIdentityTracker } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.refreshService.rotate(dto.refreshToken);
  }
}

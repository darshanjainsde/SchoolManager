import { Body, Controller, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrgContextService } from '../../tenancy';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto';
import { RefreshService } from './refresh.service';

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

  @Throttle({ default: { limit: 5, ttl: 900_000 } })
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
  // presented. 30/min per IP: a legitimate client refreshes roughly once
  // per LIBRARY_ACCESS_TTL (15m default), so even a shared-IP school with
  // several dozen concurrently-active devices each occasionally bursting a
  // retry sits well under this, while it still meaningfully tightens the
  // app-wide 100/min default for a route with no equivalent credential-
  // stuffing surface to justify that looser number.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.refreshService.rotate(dto.refreshToken);
  }
}

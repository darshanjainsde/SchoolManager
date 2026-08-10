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

  // No @Throttle here: the secret being checked is a 384-bit random token,
  // not a guessable password — rate-limiting login guards against credential
  // stuffing, but there is no equivalent brute-force surface on this route.
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.refreshService.rotate(dto.refreshToken);
  }
}

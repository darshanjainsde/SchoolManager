import { Body, Controller, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OrgContextService } from '../../tenancy';
import { AuthService } from './auth.service';
import { LoginDto } from './dto';

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
  ) {}

  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(this.orgs.requireOrgId(), dto.identifier, dto.password);
  }
}

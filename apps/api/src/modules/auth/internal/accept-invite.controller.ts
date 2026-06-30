import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, IsUUID, Length, MinLength } from 'class-validator';
import { getPlatformPrisma } from '@skoolos/db';
import { Public } from '../../../common/auth/public.decorator';
import { TenantContextService } from '../../tenancy';
import { PasswordService } from './password.service';
import { AuthService } from './auth.service';

export class AcceptInviteDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiProperty() @IsString() @Length(48, 48) inviteToken!: string;
  @ApiProperty() @IsString() @MinLength(8) password!: string;
  @ApiProperty({ required: false }) @IsEmail() @IsString() email?: string;
}

/**
 * Phase 2 finish-line. Lives on the *tenant* host because the invite URL the
 * provisioning email sends looks like:
 *   https://<slug>.skoolos.app/accept-invite?token=…&u=…
 *
 * Mechanism — schema-additive, no extra column needed:
 *   OnboardingService stores the placeholder password hash as `argon2(inviteToken)`.
 *   That makes "did the user already accept?" equivalent to "does
 *   argon2.verify(placeholderHash, suppliedToken)" — once they set a real
 *   password the hash is replaced and the verify returns false.
 *
 * Cross-tenant safety:
 *   We trust ctx.schoolId from the tenant middleware (resolved from Host).
 *   If a user row with the supplied id belongs to a different school we
 *   return 404 — never reveal existence. Cross-tenant exploitation requires
 *   the attacker to control DNS for *that* tenant's host, which is gated
 *   by the platform's domain-verification flow.
 *
 * Rate limit: 10 req / minute (per-IP) — combined with 192-bit token entropy
 * this is unbreakable in practice.
 */
@ApiTags('auth')
@Controller('auth')
export class AcceptInviteController {
  private readonly logger = new Logger(AcceptInviteController.name);

  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept-invite')
  @HttpCode(200)
  async accept(@Body() dto: AcceptInviteDto) {
    const ctx = this.tenantCtx.requireTenant();
    if (!isStrongPassword(dto.password)) {
      throw new BadRequestException('Password must be ≥8 chars and contain a letter + a digit');
    }

    const platform = getPlatformPrisma();
    const user = await platform.user.findUnique({ where: { id: dto.userId } });
    if (!user || user.schoolId !== ctx.schoolId) {
      throw new NotFoundException('Invite not found for this school');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }

    // Compare the supplied raw token against the stored placeholder hash. The
    // OnboardingService writes a hash of the invite token as the placeholder
    // password, so verifying it doubles as "have they used the invite?". Once
    // the user has set a real password, the placeholder is replaced and the
    // verify returns false → 401.
    const matched = await this.passwords.verify(user.passwordHash, dto.inviteToken).catch(() => false);
    if (!matched) {
      throw new UnauthorizedException('Invite token is invalid or already used');
    }

    const newHash = await this.passwords.hash(dto.password);
    await platform.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, failedLoginAttempts: 0, lockedUntil: null },
    });

    this.logger.log(`User ${user.id} (${user.email}) completed invite acceptance`);
    return this.auth.login(user.schoolId, user.email, dto.password);
  }
}

function isStrongPassword(p: string): boolean {
  return p.length >= 8 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
}

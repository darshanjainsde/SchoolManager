import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { loadEnv } from '@skoolos/config';
import { OtpAuthService } from './otp-auth.service';
import { OtpChooseDto, OtpRequestDto, OtpVerifyDto, ResetWithOtpDto, SwitchProfileDto } from './dto';
import { TenantContextService } from '../../tenancy';
import { Public } from '../../../common/auth/public.decorator';
import { shapeTokenResponse } from '../../../common/auth/refresh-body';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { schoolRefreshCookie, setRefreshCookie } from '../../../common/auth/refresh-cookie';
import type { IssuedFor } from './auth.service';

/**
 * Phone login (design §4). Lives beside AuthController rather than inside
 * it: these routes are tenant-OPTIONAL (the app asks before it knows the
 * school), and the cookie they set is named after the profile's school, not
 * the request's host.
 */
@ApiTags('auth')
@Controller('auth')
export class OtpAuthController {
  private readonly env = loadEnv();
  constructor(private readonly otpAuth: OtpAuthService, private readonly tenantCtx: TenantContextService) {}

  private schoolIdOrNull(): string | null {
    const ctx = this.tenantCtx.get();
    return ctx?.kind === 'tenant' ? ctx.schoolId : null;
  }

  private ip(req: Request): string | null {
    const fwd = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
    return (first ?? req.ip ?? null)?.trim() || null;
  }

  /** Tokens in the body for native clients, the refresh cookie for browsers — the same shape /auth/login answers with, plus where to go. */
  private answer(req: Request, res: Response, issued: IssuedFor, profile: { host: string; kind: string; label: string; sub: string; schoolName: string; userId: string; role: string }) {
    setRefreshCookie(res, schoolRefreshCookie(issued.schoolSlug), issued.tokens.refreshToken, this.env);
    return { ...shapeTokenResponse(issued.tokens, req), host: profile.host, profile: { userId: profile.userId, kind: profile.kind, role: profile.role, label: profile.label, sub: profile.sub, schoolName: profile.schoolName } };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/request')
  request(@Req() req: Request, @Body() dto: OtpRequestDto) {
    return this.otpAuth.request(dto.phone, this.schoolIdOrNull(), this.ip(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  async verify(@Req() req: Request, @Body() dto: OtpVerifyDto, @Res({ passthrough: true }) res: Response) {
    const out = await this.otpAuth.verify(dto.challengeId, dto.code, this.schoolIdOrNull());
    if (out.choose) return { choose: true, ticket: out.ticket, profiles: out.profiles };
    return { choose: false, ...this.answer(req, res, out.issued, out.profile) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/choose')
  async choose(@Req() req: Request, @Body() dto: OtpChooseDto, @Res({ passthrough: true }) res: Response) {
    const { issued, profile } = await this.otpAuth.choose(dto.ticket, dto.userId);
    return this.answer(req, res, issued, profile);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-with-otp')
  async resetWithOtp(@Body() dto: ResetWithOtpDto) {
    const ctx = this.tenantCtx.requireTenant();
    await this.otpAuth.resetWithOtp(ctx.schoolId, dto.email, dto.challengeId, dto.code, dto.newPassword);
    return { ok: true };
  }

  /** Whether the phone door should be shown at all. */
  @Public()
  @Get('otp/ready')
  ready() {
    return { ready: this.otpAuth.ready };
  }

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Get('profiles')
  async profiles(@CurrentUser() user: SchoolJwtPayload) {
    return { current: user.sub, profiles: await this.otpAuth.profilesFor(user.sub) };
  }

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('switch')
  async switchProfile(@Req() req: Request, @CurrentUser() user: SchoolJwtPayload, @Body() dto: SwitchProfileDto, @Res({ passthrough: true }) res: Response) {
    const { issued, profile } = await this.otpAuth.switch(user.sub, dto.userId);
    return this.answer(req, res, issued, profile);
  }
}

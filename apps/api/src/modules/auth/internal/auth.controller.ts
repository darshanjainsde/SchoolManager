import { Body, Controller, ForbiddenException, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadEnv } from '@skoolos/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto, ImpersonateDto, LoginDto, RefreshDto, ResetPasswordDto } from './dto';
import { TenantContextService } from '../../tenancy';
import { FeatureResolverService } from '../../features';
import { Public } from '../../../common/auth/public.decorator';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import {
  SCHOOL_REFRESH_COOKIE,
  clearRefreshCookie,
  resolveRefreshToken,
  setRefreshCookie,
} from './refresh-cookie';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly tenantCtx: TenantContextService,
    private readonly features: FeatureResolverService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const ctx = this.tenantCtx.requireTenant();
    const tokens = await this.auth.login(ctx.schoolId, dto.identifier ?? dto.email ?? '', dto.password);
    setRefreshCookie(res, SCHOOL_REFRESH_COOKIE, tokens.refreshToken, this.env);
    // refreshToken stays in the body for now: clients released before the
    // cookie existed still read it from here. Drop it once they are gone.
    return tokens;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = resolveRefreshToken(req, SCHOOL_REFRESH_COOKIE, dto?.refreshToken);
    if (!token) throw new ForbiddenException('No refresh token');
    const tokens = await this.auth.refresh(token);
    // Rotation: the new token replaces the cookie. A session that arrived with
    // a body token leaves with a cookie — that is the migration path.
    setRefreshCookie(res, SCHOOL_REFRESH_COOKIE, tokens.refreshToken, this.env);
    return tokens;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const ctx = this.tenantCtx.requireTenant();
    await this.passwordReset.requestReset(ctx.schoolId, dto.email);
    // Identical response whether or not the account exists.
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const ctx = this.tenantCtx.requireTenant();
    await this.passwordReset.resetPassword(ctx.schoolId, dto.token, dto.newPassword);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('impersonate')
  async impersonate(@Body() dto: ImpersonateDto) {
    const ctx = this.tenantCtx.requireTenant();
    // Impersonation issues an access token only (no refresh), so there is no
    // cookie to set — the session ends when the access token expires.
    return this.auth.impersonate(ctx.schoolId, dto.token);
  }

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @CurrentUser() user: SchoolJwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.tenantCtx.requireTenant();
    if (user.schoolId !== ctx.schoolId) throw new ForbiddenException();
    const token = resolveRefreshToken(req, SCHOOL_REFRESH_COOKIE, dto?.refreshToken);
    if (token) await this.auth.logout(ctx.schoolId, token);
    clearRefreshCookie(res, SCHOOL_REFRESH_COOKIE, this.env);
    return { ok: true };
  }

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Get('me')
  async me(@CurrentUser() user: SchoolJwtPayload) {
    const features = await this.features.getFeatures(user.schoolId);
    return {
      userId: user.sub,
      schoolId: user.schoolId,
      role: user.role,
      features: [...features],
    };
  }
}

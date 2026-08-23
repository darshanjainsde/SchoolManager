import { Body, Controller, ForbiddenException, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadEnv } from '@skoolos/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { ForgotPasswordDto, ImpersonateDto, LoginDto, RefreshDto, ResetByCodeDto, ResetPasswordDto, ResolveSchoolDto } from './dto';
import { SchoolResolveService } from './school-resolve.service';
import { TenantContextService } from '../../tenancy';
import { FeatureResolverService } from '../../features';
import { Public } from '../../../common/auth/public.decorator';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import {
  SCHOOL_REFRESH_COOKIE,
  clearRefreshCookie,
  resolveRefreshTokens,
  resolveSchoolRefreshTokens,
  schoolRefreshCookie,
  firstValidToken,
  setRefreshCookie,
} from '../../../common/auth/refresh-cookie';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(
    private readonly auth: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly tenantCtx: TenantContextService,
    private readonly features: FeatureResolverService,
    private readonly schoolResolve: SchoolResolveService,
  ) {}

  /**
   * App entry gate — the identifier field's replacement for the deleted
   * "enter your school code" screen. Deliberately does NOT touch tenant
   * context: it runs before the app knows which school it is talking to.
   * Same neutral shape whether or not the identifier exists (an empty list),
   * throttled like login.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('resolve-school')
  async resolveSchool(@Body() dto: ResolveSchoolDto) {
    return { hosts: await this.schoolResolve.resolve(dto.identifier) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const ctx = this.tenantCtx.requireTenant();
    const tokens = await this.auth.login(ctx.schoolId, dto.identifier ?? dto.email ?? '', dto.password);
    // Per-school cookie name: signing into a second school must not overwrite
    // (or be overwritten by) the first — they share the parent domain.
    setRefreshCookie(res, schoolRefreshCookie(ctx.schoolSlug), tokens.refreshToken, this.env);
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
    // EVERY cookie sent under this name, not just the first. A browser holding
    // a stale copy under different attributes sends both, and picking the first
    // meant a permanently unrefreshable session that signing out could not fix.
    // This school's own cookie first, then the legacy shared one, then the body.
    // `auth.refresh` refuses any token belonging to a different school, so a
    // second school's session in the same browser is skipped rather than
    // mistakenly accepted (and is never rotated, so it stays alive).
    const ctx = this.tenantCtx.requireTenant();
    const candidates = resolveSchoolRefreshTokens(req, ctx.schoolSlug, dto?.refreshToken);
    if (candidates.length === 0) throw new ForbiddenException('No refresh token');
    const tokens = await firstValidToken(candidates, (t) => this.auth.refresh(t, ctx.schoolId));
    // Rotation: the new token replaces the cookie, under this school's OWN
    // name. A session that arrived on the legacy shared cookie (or a body
    // token) leaves with a per-school cookie — that is the migration path.
    setRefreshCookie(res, schoolRefreshCookie(ctx.schoolSlug), tokens.refreshToken, this.env);
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

  /**
   * Phase 5·1 — reset with only the student code. Tighter throttle than
   * forgot-password: the response carries a masked email (the confirmation
   * the parent sees), so brute-forcing codes must stay expensive.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('reset-by-code')
  async resetByCode(@Body() dto: ResetByCodeDto) {
    const ctx = this.tenantCtx.requireTenant();
    const emailMasked = await this.passwordReset.requestResetByCode(ctx.schoolId, dto.code);
    // ok:true either way; a null mask means "no login/email on file — contact
    // the school office" in client copy.
    return { ok: true, emailMasked };
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
    // Revoke every token the browser offered, not just the first — otherwise a
    // stale duplicate outlives the sign-out it was meant to end.
    for (const token of resolveSchoolRefreshTokens(req, ctx.schoolSlug, dto?.refreshToken)) {
      // Tenant-scoped: a token belonging to another school simply is not found
      // in this school's rows, so signing out here cannot revoke it.
      await this.auth.logout(ctx.schoolId, token).catch(() => undefined);
    }
    // Only THIS school's cookie is cleared. The legacy shared name is cleared
    // too — it can only hold a session this browser is signing out of or one
    // already migrated to a per-school cookie.
    clearRefreshCookie(res, schoolRefreshCookie(ctx.schoolSlug), this.env);
    clearRefreshCookie(res, SCHOOL_REFRESH_COOKIE, this.env);
    return { ok: true };
  }

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Get('me')
  async me(@CurrentUser() user: SchoolJwtPayload) {
    const [features, name, staffRole] = await Promise.all([
      this.features.getFeatures(user.schoolId),
      // The clients have nowhere else to learn the signed-in person's NAME:
      // the login response carries none, and `User` has no name column. Without
      // it the mobile app fell back to the login identifier and greeted
      // teachers with their own email address. Null when no role record claims
      // the user yet — the client decides what to show instead.
      this.auth.displayNameFor(user.schoolId, user.sub, user.role),
      // Which KIND of staff (LIBRARIAN, OFFICE, …) — how the web login lands a
      // librarian on /library instead of /staff. Null for non-STAFF logins.
      this.auth.staffRoleFor(user.schoolId, user.sub, user.role),
    ]);
    return {
      userId: user.sub,
      schoolId: user.schoolId,
      role: user.role,
      name,
      staffRole,
      features: [...features],
    };
  }
}

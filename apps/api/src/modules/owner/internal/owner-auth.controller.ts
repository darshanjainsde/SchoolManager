import { Body, Controller, ForbiddenException, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadEnv } from '@skoolos/config';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/auth/public.decorator';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { shapeTokenResponse } from '../../../common/auth/refresh-body';
import { OwnerAuthService } from './owner-auth.service';
import { GateLoginDto, OwnerLoginDto, RefreshDto } from './owner.dto';
import {
  OWNER_REFRESH_COOKIE,
  resolveRefreshTokens,
  firstValidToken,
  setRefreshCookie,
  clearRefreshCookie,
} from '../../../common/auth/refresh-cookie';

@Controller('owner/auth')
@UseGuards(OwnerHostGuard)
export class OwnerAuthController {
  private readonly env = loadEnv();

  constructor(private readonly auth: OwnerAuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(
    @Req() req: Request,
    @Body() dto: OwnerLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(dto.email, dto.password, dto.totp);
    setRefreshCookie(res, OWNER_REFRESH_COOKIE, tokens.refreshToken, this.env);
    return shapeTokenResponse(tokens, req);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('gate')
  async gate(
    @Req() req: Request,
    @Body() dto: GateLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.gateLogin(dto.password);
    setRefreshCookie(res, OWNER_REFRESH_COOKIE, tokens.refreshToken, this.env);
    return shapeTokenResponse(tokens, req);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // See auth.controller.ts — a stale duplicate cookie under the same name
    // shadowed the live one and made every refresh fail.
    const candidates = resolveRefreshTokens(req, OWNER_REFRESH_COOKIE, dto?.refreshToken);
    if (candidates.length === 0) throw new ForbiddenException('No refresh token');
    const tokens = await firstValidToken(candidates, (t) => this.auth.refresh(t));
    setRefreshCookie(res, OWNER_REFRESH_COOKIE, tokens.refreshToken, this.env);
    return shapeTokenResponse(tokens, req);
  }

  /**
   * End the owner session for real.
   *
   * There was no such endpoint: apps/web/app/platform/layout.tsx cleared a
   * Zustand store and navigated, leaving the cookie in the browser and its row
   * unrevoked, so a replayed POST /owner/auth/refresh kept minting platform
   * tokens for up to 30 days after "sign out" — full access to every school,
   * with no way to revoke it.
   *
   * Public because logging out must work with an expired access token; the
   * cookie is the credential, and revoking a token you already hold is not a
   * privileged act. Always answers 204, so it cannot be used to probe whether
   * a given token was live.
   */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const candidates = resolveRefreshTokens(req, OWNER_REFRESH_COOKIE, dto?.refreshToken);
    // Revoke every candidate: a stale duplicate cookie under the same name is
    // exactly the case that made refresh fail before, and leaving one live
    // would leave the session alive.
    await Promise.all(candidates.map((t) => this.auth.logout(t).catch(() => undefined)));
    clearRefreshCookie(res, OWNER_REFRESH_COOKIE, this.env);
  }
}

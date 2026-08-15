import { Body, Controller, ForbiddenException, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadEnv } from '@skoolos/config';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/auth/public.decorator';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { OwnerAuthService } from './owner-auth.service';
import { GateLoginDto, OwnerLoginDto, RefreshDto } from './owner.dto';
import {
  OWNER_REFRESH_COOKIE,
  resolveRefreshTokens,
  firstValidToken,
  setRefreshCookie,
} from '../../../common/auth/refresh-cookie';

@Controller('owner/auth')
@UseGuards(OwnerHostGuard)
export class OwnerAuthController {
  private readonly env = loadEnv();

  constructor(private readonly auth: OwnerAuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: OwnerLoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(dto.email, dto.password, dto.totp);
    setRefreshCookie(res, OWNER_REFRESH_COOKIE, tokens.refreshToken, this.env);
    return tokens;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('gate')
  async gate(@Body() dto: GateLoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.gateLogin(dto.password);
    setRefreshCookie(res, OWNER_REFRESH_COOKIE, tokens.refreshToken, this.env);
    return tokens;
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
    return tokens;
  }
}

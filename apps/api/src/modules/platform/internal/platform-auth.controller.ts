import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformLoginDto, PlatformRefreshDto } from './dto';
import { Public } from '../../../common/auth/public.decorator';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';

@ApiTags('platform-auth')
@UseGuards(PlatformHostGuard)
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.email, dto.password, dto.totp);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: PlatformRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(PlatformJwtGuard)
  @Post('logout')
  async logout(@Body() dto: PlatformRefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  @ApiBearerAuth()
  @UseGuards(PlatformJwtGuard)
  @Get('me')
  me(@CurrentUser() user: PlatformJwtPayload) {
    return { platformUserId: user.sub, role: user.role };
  }
}

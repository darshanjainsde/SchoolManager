import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/auth/public.decorator';
import { OwnerHostGuard } from './owner-host.guard';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerLoginDto, RefreshDto } from './owner.dto';

@Controller('owner/auth')
@UseGuards(OwnerHostGuard)
export class OwnerAuthController {
  constructor(private readonly auth: OwnerAuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: OwnerLoginDto) {
    return this.auth.login(dto.email, dto.password, dto.totp);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
}

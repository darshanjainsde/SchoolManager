import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto';
import { TenantContextService } from '../../tenancy';
import { FeatureResolverService } from '../../features';
import { Public } from '../../../common/auth/public.decorator';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tenantCtx: TenantContextService,
    private readonly features: FeatureResolverService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const ctx = this.tenantCtx.requireTenant();
    return this.auth.login(ctx.schoolId, dto.email, dto.password);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Post('logout')
  async logout(@Body() dto: RefreshDto, @CurrentUser() user: SchoolJwtPayload) {
    const ctx = this.tenantCtx.requireTenant();
    if (user.schoolId !== ctx.schoolId) throw new ForbiddenException();
    await this.auth.logout(ctx.schoolId, dto.refreshToken);
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

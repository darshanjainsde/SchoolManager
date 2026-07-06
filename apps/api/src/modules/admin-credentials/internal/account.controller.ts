import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { AccountService } from './account.service';
import { ChangePasswordDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(SchoolJwtGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: SchoolJwtPayload,
  ) {
    const ctx = this.tenantCtx.requireTenant();
    return this.account.changePassword(ctx.schoolId, user.sub, dto.currentPassword, dto.newPassword);
  }
}

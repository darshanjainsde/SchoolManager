import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OwnerHostGuard } from '../../owner/internal/owner-host.guard';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { AdminCredentialsService } from './admin-credentials.service';

@ApiTags('owner')
@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class AdminCredentialsController {
  constructor(private readonly svc: AdminCredentialsService) {}

  @Get('schools/:id/admins')
  listAdmins(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listAdmins(id);
  }

  @Post('schools/:id/admins/:userId/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.svc.resetPassword(id, userId);
  }
}

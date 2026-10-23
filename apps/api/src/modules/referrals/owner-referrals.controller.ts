import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { OwnerHostGuard } from '../../common/auth/owner-host.guard';
import { PlatformJwtGuard } from '../../common/auth/platform-jwt.guard';
import { ReferralsService } from './referrals.service';
import { AddPromoterDto, MarkPaidDto, ReferralSettingsDto, ReferralStageDto, RejectReferralDto, SetCommissionDto, SetPromoterStatusDto } from './referrals.dto';

/** The Referrals tab of the owner console. Static paths are declared before any `:id` sibling. */
@Controller('owner/referrals')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OwnerReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('tasks') tasks() { return this.referrals.listTasks(); }

  @Get('promoters') promoters(@Query('q') q?: string, @Query('city') city?: string, @Query('status') status?: string) { return this.referrals.listPromoters({ q, city, status }); }
  @Post('promoters') addPromoter(@Body() dto: AddPromoterDto) { return this.referrals.addPromoter(dto); }
  @Patch('promoters/:id/commission') setCommission(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCommissionDto) { return this.referrals.setCommission(id, dto); }
  @Patch('promoters/:id/status') setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPromoterStatusDto) { return this.referrals.setPromoterStatus(id, dto); }
  @Post('promoters/:id/kyc-verified') verifyKyc(@Param('id', ParseUUIDPipe) id: string) { return this.referrals.verifyKyc(id); }
  @Post('promoters/:id/login-link') loginLink(@Param('id', ParseUUIDPipe) id: string) { return this.referrals.sendLoginLink(id); }

  @Get('payouts') payouts(@Query('status') status?: string) { return this.referrals.listPayouts({ status }); }
  @Patch('payouts/:id/paid') markPaid(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) { return this.referrals.markPaid(id, dto); }

  @Get('settings') settings() { return this.referrals.settings(); }
  @Put('settings') updateSettings(@Body() dto: ReferralSettingsDto) { return this.referrals.updateSettings(dto); }

  @Get() list(@Query('q') q?: string, @Query('promoterId') promoterId?: string, @Query('city') city?: string, @Query('status') status?: string) { return this.referrals.listReferrals({ q, promoterId, city, status }); }
  @Post(':id/accept') accept(@Param('id', ParseUUIDPipe) id: string) { return this.referrals.accept(id); }
  @Post(':id/reject') reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectReferralDto) { return this.referrals.reject(id, dto.reason); }
  @Patch(':id/stage') stage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReferralStageDto) { return this.referrals.setStage(id, dto); }
}

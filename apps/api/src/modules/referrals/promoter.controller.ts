import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import type { Promoter } from '@skoolos/db';
import { CurrentPromoter, PromoterJwtGuard } from './promoter-jwt.guard';
import { OtpService } from '../../common/otp/otp.service';
import { PromoterAuthService } from './promoter-auth.service';
import { ReferralsService } from './referrals.service';
import { omit } from './referral-rules';
import { CreateReferralDto, PayoutDetailsDto, ReferralNoteDto, StartCodeDto, UpdatePromoterDto, VerifyCodeDto } from './referrals.dto';

const ip = (req: Request): string | null => (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null;

/** The two doors a visitor uses before they have a session. */
@Controller('promoter/auth')
export class PromoterAuthController {
  constructor(private readonly auth: PromoterAuthService, private readonly otp: OtpService) {}

  /** Which doors are open today, so the page never offers a WhatsApp code the platform cannot send. */
  @Get('channels')
  channels() { return { email: true, whatsapp: this.otp.ready }; }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('start')
  start(@Body() dto: StartCodeDto, @Req() req: Request) {
    return this.auth.start(dto, ip(req));
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  async verify(@Body() dto: VerifyCodeDto) {
    const s = await this.auth.verify(dto);
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, isNew: s.isNew, promoter: omit(s.promoter, ['pan', 'bankAccount']) };
  }
}

/** Everything behind a promoter session. */
@Controller('promoter')
@UseGuards(PromoterJwtGuard)
export class PromoterController {
  constructor(private readonly referrals: ReferralsService, private readonly auth: PromoterAuthService) {}

  @Get('me') me(@CurrentPromoter() p: Promoter) { return this.referrals.me(p); }
  @Patch('me') async update(@CurrentPromoter() p: Promoter, @Body() dto: UpdatePromoterDto) { const u = await this.referrals.updateProfile(p, dto); return this.referrals.me(u); }
  @Post('sign-out-all') async signOutAll(@CurrentPromoter() p: Promoter) { await this.auth.signOutAll(p); return { ok: true }; }

  @Post('commission-request') requestCommission(@CurrentPromoter() p: Promoter) { return this.referrals.requestCommission(p); }

  @Get('referrals') list(@CurrentPromoter() p: Promoter) { return this.referrals.listForPromoter(p); }
  @Post('referrals') async create(@CurrentPromoter() p: Promoter, @Body() dto: CreateReferralDto) {
    const r = await this.referrals.createReferral(p, dto);
    return this.referrals.getForPromoter(p, r.id);
  }
  @Get('referrals/:id') one(@CurrentPromoter() p: Promoter, @Param('id', ParseUUIDPipe) id: string) { return this.referrals.getForPromoter(p, id); }
  @Post('referrals/:id/notes') note(@CurrentPromoter() p: Promoter, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReferralNoteDto) { return this.referrals.addPromoterNote(p, id, dto.body); }

  @Put('payout-details') async payoutDetails(@CurrentPromoter() p: Promoter, @Body() dto: PayoutDetailsDto) { const u = await this.referrals.savePayoutDetails(p, dto); return this.referrals.me(u); }
  @Get('payouts') payouts(@CurrentPromoter() p: Promoter) { return this.referrals.listPayoutsForPromoter(p); }
}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OwnerHostGuard } from '../../common/auth/owner-host.guard';
import { OwnerReferralsController } from './owner-referrals.controller';
import { PromoterAuthService } from './promoter-auth.service';
import { PromoterJwtGuard } from './promoter-jwt.guard';
import { PromoterAuthController, PromoterController } from './promoter.controller';
import { ReferralsService } from './referrals.service';

/**
 * Refer & Earn: the promoter portal's API and the owner console's Referrals
 * tab. MailModule, OtpModule and NotificationModule are global, so the code
 * senders and the letters need no import here.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [PromoterAuthController, PromoterController, OwnerReferralsController],
  providers: [ReferralsService, PromoterAuthService, PromoterJwtGuard, OwnerHostGuard],
  exports: [ReferralsService],
})
export class ReferralsModule {}

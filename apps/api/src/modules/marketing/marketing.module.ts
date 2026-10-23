import { Module } from '@nestjs/common';
import { MailModule } from '../../common/mail/mail.module';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { ReferralsModule } from '../referrals';

@Module({
  imports: [MailModule, ReferralsModule],
  providers: [MarketingService],
  controllers: [MarketingController],
  exports: [MarketingService],
})
export class MarketingModule {}

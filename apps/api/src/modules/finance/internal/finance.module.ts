import { Module } from '@nestjs/common';
import { PlatformModule } from '../../platform';
import { FeesController } from './fees.controller';
import { StripeController } from './stripe.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [PlatformModule],
  providers: [StripeService],
  controllers: [FeesController, StripeController],
})
export class FinanceModule {}

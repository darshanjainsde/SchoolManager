import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { FeeBillingService } from './fee-billing.service';
import { FeeConfigService } from './fee-config.service';
import { FeePaymentService } from './fee-payment.service';
import { FeePortalController } from './fee-portal.controller';
import { FeePortalService } from './fee-portal.service';
import { FeeQueryService } from './fee-query.service';
import { FeeSetupService } from './fee-setup.service';
import { FeesController } from './fees.controller';
import { ManualBankTransferProvider } from './providers/manual-bank-transfer.provider';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import { PAYMENT_PROVIDERS } from './providers/payment-providers.token';
import { PhonePeProvider } from './providers/phonepe.provider';
import { RazorpayProvider } from './providers/razorpay.provider';

/**
 * To add a payment provider later — Cashfree, or a school's own gateway:
 * implement `PaymentProvider`, add the class to `providers`, and add it to the
 * `PAYMENT_PROVIDERS` factory's array and `inject` list below. No other file
 * changes: the admin setup screen renders from each provider's own
 * `configFields`, and `PaymentProviderRegistry` resolves by key.
 *
 * This mirrors `NotificationModule`'s `NOTIFICATION_CHANNELS` deliberately —
 * a developer who has read that one has read this one.
 */
@Module({
  imports: [AuthModule, FeaturesModule, TenancyModule],
  controllers: [FeesController, FeePortalController],
  providers: [
    ManualBankTransferProvider,
    PhonePeProvider,
    RazorpayProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (
        manual: ManualBankTransferProvider,
        phonepe: PhonePeProvider,
        razorpay: RazorpayProvider,
      ) => [manual, phonepe, razorpay],
      inject: [ManualBankTransferProvider, PhonePeProvider, RazorpayProvider],
    },
    PaymentProviderRegistry,
    FeeSetupService,
    FeeBillingService,
    FeePaymentService,
    FeeConfigService,
    FeeQueryService,
    FeePortalService,
  ],
  exports: [FeeQueryService, FeeBillingService],
})
export class FeesModule {}

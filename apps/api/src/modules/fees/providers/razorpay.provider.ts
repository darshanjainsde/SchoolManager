import { Injectable } from '@nestjs/common';
import { ApiError } from '../../../common/errors/api-error';
import type {
  PaymentContext,
  PaymentProvider,
  PaymentStartResult,
  ProviderConfigField,
  ProviderStatus,
} from './payment-provider.types';

/**
 * Razorpay, not yet live — the second rail, so a single gateway's bad day is
 * not a school's bad day.
 *
 * Kept deliberately thinner than PhonePe's stub: Razorpay's partner model is
 * already well understood (basic auth with partner credentials plus the
 * sub-merchant's `account_id` in an `X-Razorpay-Account` header), and building
 * more of it before PhonePe's model is confirmed risks building twice.
 *
 * Worth noting what that model buys, because it shapes the field list below:
 * the only per-school value is `accountId`, which is NOT a secret. A school
 * row therefore holds no live key at all.
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly key = 'RAZORPAY';
  readonly displayName = 'Razorpay';
  readonly kind = 'GATEWAY' as const;
  readonly blurb =
    'An alternative to PhonePe. If your school already has a Razorpay account, it can be connected here.';

  readonly configFields: readonly ProviderConfigField[] = [
    {
      name: 'accountId',
      label: 'Account ID',
      scope: 'SCHOOL',
      secret: false,
      required: true,
      placeholder: 'acc_XXXXXXXXXXXX',
      help: 'Sckools connects your account for you — there are no keys to copy.',
    },
    {
      name: 'webhookSecret',
      label: 'Webhook secret',
      scope: 'SCHOOL',
      secret: true,
      required: false,
      help: 'Per school, so one leak cannot forge another school’s payments.',
    },
  ];

  isAvailable(): boolean {
    return process.env.RAZORPAY_ENABLED === 'true';
  }

  resolveStatus(config: Record<string, unknown>, enabled: boolean): ProviderStatus {
    if (!this.isAvailable()) return 'PENDING';
    if (!config.accountId) return 'NOT_CONFIGURED';
    return enabled ? 'ACTIVE' : 'NOT_CONFIGURED';
  }

  async start(_ctx: PaymentContext): Promise<PaymentStartResult> {
    throw new ApiError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Online payment through Razorpay is not switched on yet.',
      409,
    );
  }
}

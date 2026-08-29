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
 * PhonePe PG, not yet live.
 *
 * Present now, deliberately, so the shape is fixed while the commercial
 * conversation is still open: the admin screen already lists it, the parent's
 * Pay Now button already renders (disabled, with an honest reason), and the
 * config fields below are exactly what a school will be asked for. When
 * credentials arrive, `isAvailable()` flips and `start()` is written — nothing
 * above `FeePayment` moves.
 *
 * Field names follow PhonePe's V2 (OAuth) flow: a `client_id` / `client_secret`
 * / `client_version` triple held once by Sckools, and a per-school merchant id
 * issued after that school's KYC — which is the model PhonePe described.
 * If they put us on the older V1 flow instead, the platform triple becomes
 * `salt_key` + `salt_index` and the school field stays exactly as it is.
 */
@Injectable()
export class PhonePeProvider implements PaymentProvider {
  readonly key = 'PHONEPE';
  readonly displayName = 'PhonePe';
  readonly kind = 'GATEWAY' as const;
  readonly blurb =
    'Parents pay by UPI, card or net banking. Money settles straight into your school’s own bank account.';

  readonly configFields: readonly ProviderConfigField[] = [
    {
      name: 'merchantId',
      label: 'Merchant ID',
      scope: 'SCHOOL',
      secret: false,
      required: true,
      placeholder: 'e.g. SCKOOLSARASWATI',
      help: 'PhonePe issues this to your school once its KYC is approved.',
    },
    {
      name: 'webhookUsername',
      label: 'Callback username',
      scope: 'SCHOOL',
      secret: false,
      required: false,
      help: 'Set in your PhonePe dashboard under callback settings.',
    },
    {
      name: 'webhookPassword',
      label: 'Callback password',
      scope: 'SCHOOL',
      secret: true,
      required: false,
      help: 'Stored encrypted. We never show it again once saved.',
    },
  ];

  /**
   * Reads an env flag rather than a hardcoded `false`, so switching PhonePe on
   * is a deploy-time decision and not a code change — and so staging can
   * exercise the enabled path before production does.
   */
  isAvailable(): boolean {
    return process.env.PHONEPE_ENABLED === 'true';
  }

  resolveStatus(config: Record<string, unknown>, enabled: boolean): ProviderStatus {
    if (!this.isAvailable()) return 'PENDING';
    if (!config.merchantId) return 'NOT_CONFIGURED';
    return enabled ? 'ACTIVE' : 'NOT_CONFIGURED';
  }

  async start(_ctx: PaymentContext): Promise<PaymentStartResult> {
    // Unreachable while isAvailable() is false — FeePaymentService checks
    // first. Kept as a hard failure rather than a silent no-op so a wiring
    // mistake surfaces as an error with a code, not as a parent staring at a
    // blank page.
    throw new ApiError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Online payment through PhonePe is not switched on yet.',
      409,
    );
  }
}

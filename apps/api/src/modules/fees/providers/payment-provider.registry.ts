import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../../../common/errors/api-error';
import { PAYMENT_PROVIDERS } from './payment-providers.token';
import type { PaymentProvider } from './payment-provider.types';

/**
 * Resolves a provider by key. The only way anything outside `providers/`
 * reaches a provider — no call site imports `PhonePeProvider` directly, which
 * is what keeps the swap in §7 of the blueprint a one-file change.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byKey: ReadonlyMap<string, PaymentProvider>;

  constructor(@Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[]) {
    const map = new Map<string, PaymentProvider>();
    for (const p of providers) {
      if (map.has(p.key)) {
        // A duplicate key would silently shadow one provider with another and
        // route real money to the wrong integration. Fail at boot instead.
        throw new Error(`Duplicate payment provider key: ${p.key}`);
      }
      map.set(p.key, p);
    }
    this.byKey = map;
  }

  /** Every provider, in registration order — what the admin screen lists. */
  all(): PaymentProvider[] {
    return [...this.byKey.values()];
  }

  /** Providers a school can actually collect through today. */
  available(): PaymentProvider[] {
    return this.all().filter((p) => p.isAvailable());
  }

  get(key: string): PaymentProvider {
    const p = this.byKey.get(key);
    if (!p) throw new ApiError('UNKNOWN_PAYMENT_PROVIDER', `Unknown payment provider: ${key}`, 400);
    return p;
  }
}

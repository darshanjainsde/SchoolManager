/**
 * DI token for the `PaymentProvider[]` array `PaymentProviderRegistry`
 * resolves against. Its own file so a future `CashfreeProvider` can import
 * just the token without pulling in the registry — the same reason
 * `notification-channels.token.ts` exists.
 */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

import { Module } from '@nestjs/common';
import { TenancyModule } from '../../modules/tenancy';
import { IdempotencyInterceptor, PrismaIdempotencyStore } from './idempotency.interceptor';

/**
 * Group B, finding 4: `'IDEMPOTENCY_STORE'` (the token IdempotencyInterceptor
 * injects) was bound in no module anywhere in the app graph — nothing was
 * broken yet only because no controller uses the interceptor yet, but the
 * first Phase 1 controller to do `@UseInterceptors(IdempotencyInterceptor)`
 * would hit a DI resolution error at boot, not at review time.
 *
 * Deliberately NOT registered as an `APP_INTERCEPTOR` here or anywhere else
 * — idempotency is opt-in per route (see IdempotencyInterceptor's own class
 * doc), not something every write endpoint should silently get. A feature
 * module wires this in per-controller with `@UseInterceptors(IdempotencyInterceptor)`
 * after importing `IdempotencyModule` (for the DI graph) — same shape as
 * PlansModule + RequireFeatureGuard.
 *
 * Imports TenancyModule because IdempotencyInterceptor's constructor also
 * needs `OrgContextService` — a provider can only inject what its own module
 * provides or imports, so without this import Nest would fail to construct
 * the interceptor even with the store token bound.
 */
@Module({
  imports: [TenancyModule],
  providers: [
    { provide: 'IDEMPOTENCY_STORE', useClass: PrismaIdempotencyStore },
    IdempotencyInterceptor,
  ],
  exports: [IdempotencyInterceptor, 'IDEMPOTENCY_STORE'],
})
export class IdempotencyModule {}

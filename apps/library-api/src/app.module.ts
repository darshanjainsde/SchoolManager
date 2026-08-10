import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { TenancyModule } from './modules/tenancy';
import { AuthModule } from './modules/auth';
import { PlansModule } from './modules/plans';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { IdempotencyModule } from './common/idempotency/idempotency.module';

@Module({
  imports: [
    // Registered once, app-wide: every future module rate-limits its own
    // routes with @Throttle(), not by re-registering ThrottlerModule/APP_GUARD
    // itself — a second forRoot()+APP_GUARD pair in a feature module would
    // stack a second, independent throttler guard on every request.
    //
    // `storage` is a RedisThrottlerStorage, not the @nestjs/throttler default:
    // the default keeps counters in an in-process object, which on N warm
    // lambda instances enforces N×limit instead of limit — see
    // redis-throttler.storage.ts for the full reasoning (including why it
    // fails open on Redis errors rather than failing closed).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      storage: new RedisThrottlerStorage(),
      skipIf: () => process.env.DISABLE_THROTTLER === 'true',
    }),
    TenancyModule,
    HealthModule,
    AuthModule,
    // Group B, finding 4: neither of these was wired in — PlanResolverService
    // (what RequireFeatureGuard needs) and the 'IDEMPOTENCY_STORE' token
    // (what IdempotencyInterceptor needs) resolved from nowhere, a DI trap
    // waiting for the first Phase 1 controller to use either. Importing them
    // here makes both providers resolvable app-wide without registering
    // either the guard or the interceptor globally — both stay opt-in,
    // applied per-route by whichever future controller needs them, the same
    // way ThrottlerGuard above is the only guard actually registered
    // app-wide today.
    PlansModule,
    IdempotencyModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

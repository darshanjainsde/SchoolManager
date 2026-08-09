import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { TenancyModule } from './modules/tenancy';
import { AuthModule } from './modules/auth';

@Module({
  imports: [
    // Registered once, app-wide: every future module rate-limits its own
    // routes with @Throttle(), not by re-registering ThrottlerModule/APP_GUARD
    // itself — a second forRoot()+APP_GUARD pair in a feature module would
    // stack a second, independent throttler guard on every request.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.DISABLE_THROTTLER === 'true',
    }),
    TenancyModule,
    HealthModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

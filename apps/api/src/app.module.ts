import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ValidationPipe } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { IdempotencyMiddleware } from './common/idempotency/idempotency.middleware';
import { HealthModule } from './health/health.module';
import { EventBusModule } from './common/event-bus/event-bus.module';
import { CommonAuthModule } from './common/auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { StorageModule } from './common/storage/storage.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthModule } from './modules/auth';
import { TenancyModule } from './modules/tenancy';
import { PlatformModule } from './modules/platform';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    // Default global rate limit: 100 req / minute / IP. Auth endpoints set
    // tighter limits via @Throttle(). `skipIf` short-circuits the guard in tests
    // (per-endpoint @Throttle overrides the module limits but `skipIf` is
    // honoured by the guard before any limit is checked).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.DISABLE_THROTTLER === 'true',
    }),

    CommonAuthModule,
    AuditModule,
    StorageModule,
    EventBusModule,
    HealthModule,

    TenancyModule,
    AuthModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Idempotency-Key handling runs AFTER the tenant middleware (registered in
    // TenancyModule) but BEFORE any controller. Mounted globally because the
    // middleware itself checks the HTTP method and bails for safe methods.
    consumer.apply(IdempotencyMiddleware).forRoutes('*');
  }
}

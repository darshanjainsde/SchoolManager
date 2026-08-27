import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ValidationPipe } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './health/health.module';
import { EventBusModule } from './common/event-bus/event-bus.module';
import { CommonAuthModule } from './common/auth/auth.module';
import { AuditModule } from './common/audit/audit.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { MailModule } from './common/mail/mail.module';
import { NotificationModule } from './common/notifications/notification.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthModule } from './modules/auth';
import { TenancyModule } from './modules/tenancy';
import { FeaturesModule } from './modules/features';
import { OwnerModule } from './modules/owner';
import { CmsModule } from './modules/cms';
import { ManagementModule } from './modules/management';
import { CommunityModule } from './modules/community';
import { HiringModule } from './modules/hiring';
import { PublicModule } from './modules/public';
import { PortalModule } from './modules/portal';
import { LibraryModule } from './modules/library';
import { DirectoryModule } from './modules/directory/directory.module';
import { AlumniModule } from './modules/alumni';
import { MarketingModule } from './modules/marketing';
import { AdminCredentialsModule } from './modules/admin-credentials';
import { BlogModule } from './modules/blog';
import { RedisThrottlerModule } from './common/throttler/redis-throttler.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';

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
    //
    // The counter lives in Redis (shared across every lambda instance) when
    // REDIS_URL is configured; without it (local dev, unit tests) the guard
    // falls back to the in-memory store. See RedisThrottlerStorage for the
    // fail-open policy.
    ThrottlerModule.forRootAsync({
      imports: [RedisThrottlerModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        skipIf: () => process.env.DISABLE_THROTTLER === 'true',
        ...(storage.shared ? { storage } : {}),
      }),
    }),

    RedisModule,
    CommonAuthModule,
    AuditModule,
    StorageModule,
    MailModule,
    NotificationModule,
    EventBusModule,
    HealthModule,

    TenancyModule,
    AuthModule,
    FeaturesModule,
    OwnerModule,
    AdminCredentialsModule,
    CmsModule,
    ManagementModule,
    CommunityModule,
    HiringModule,
    PublicModule,
    PortalModule,
    LibraryModule,
    DirectoryModule,
    AlumniModule,
    MarketingModule,
    BlogModule,
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
export class AppModule {}

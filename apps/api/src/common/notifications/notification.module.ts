import { Global, Module } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { EmailChannel } from './email.channel';
import { PushChannel } from './push.channel';
import { NOTIFICATION_CHANNELS } from './notification-channels.token';
import { NotificationService } from './notification.service';

/**
 * Global (mirrors MailModule) so any module can inject `NotificationService`
 * without importing this module explicitly.
 *
 * To add WhatsApp later: implement `WhatsAppChannel` (NotificationChannel),
 * add it to `providers`, and add it to the `NOTIFICATION_CHANNELS` factory's
 * array + `inject` list below. No other file changes.
 *
 * `PushChannel` is built via its own `useFactory` (rather than letting Nest
 * construct it off `@Injectable()` metadata) because its one dependency is a
 * `PrismaClient`, and this codebase has no injectable Prisma token — every
 * other service reaches Prisma via `getPlatformPrisma()`/`withTenant()`
 * called directly, not constructor DI. See push.channel.ts's docstring for
 * why the platform (BYPASSRLS, cross-tenant) client is the correct choice
 * here specifically.
 */
@Global()
@Module({
  providers: [
    EmailChannel,
    {
      provide: PushChannel,
      useFactory: () => new PushChannel(getPlatformPrisma()),
    },
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (email: EmailChannel, push: PushChannel) => [email, push],
      inject: [EmailChannel, PushChannel],
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}

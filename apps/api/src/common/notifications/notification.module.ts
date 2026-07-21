import { Global, Module } from '@nestjs/common';
import { EmailChannel } from './email.channel';
import { NOTIFICATION_CHANNELS } from './notification-channels.token';
import { NotificationService } from './notification.service';

/**
 * Global (mirrors MailModule) so any module can inject `NotificationService`
 * without importing this module explicitly.
 *
 * To add WhatsApp later: implement `WhatsAppChannel` (NotificationChannel),
 * add it to `providers`, and add it to the `NOTIFICATION_CHANNELS` factory's
 * array + `inject` list below. No other file changes.
 */
@Global()
@Module({
  providers: [
    EmailChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (email: EmailChannel) => [email],
      inject: [EmailChannel],
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}

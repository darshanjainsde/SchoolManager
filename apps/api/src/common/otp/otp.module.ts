import { Global, Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notification.module';
import { OtpSenders, SmsOtpSender, WhatsAppOtpSender } from './otp-senders';
import { OtpService } from './otp.service';

/**
 * Global like NotificationModule: a one-time code is asked for from auth
 * (login, reset) and from a person's profile (verify a number), and both
 * must hit the same limits and the same senders.
 */
@Global()
@Module({
  // Explicit for the same reason AuthModule imports this module: the WhatsApp
  // sender injects WhatsAppChannel, and a spec may boot without the root.
  imports: [NotificationModule],
  providers: [WhatsAppOtpSender, { provide: SmsOtpSender, useFactory: () => new SmsOtpSender() }, OtpSenders, OtpService],
  exports: [OtpService, OtpSenders],
})
export class OtpModule {}

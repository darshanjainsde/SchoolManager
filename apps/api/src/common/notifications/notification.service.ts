import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_CHANNELS } from './notification-channels.token';
import type {
  NotificationChannel,
  NotificationKind,
  NotificationMessage,
  NotificationRecipient,
  NotifySummary,
} from './notification.types';

/**
 * Fans a notification out over every configured channel (email today,
 * WhatsApp later). Never throws — a channel that rejects or resolves `false`
 * is simply tallied as `failed`, so callers (ExamsService.create/publish,
 * AttendanceService.save, the reminder cron) can fire this best-effort
 * without risking their own mutation's result.
 *
 * Each recipient carries ITS OWN payload: an ABSENCE_NOTICE must name the
 * child that guardian is being written about, so one shared payload for the
 * whole fan-out would be wrong. Callers that genuinely send the same content
 * to everyone just map the same object over their recipient list.
 *
 * Adding a channel is a change to `notification.module.ts`'s
 * `NOTIFICATION_CHANNELS` provider only — this class and every caller of
 * `notify()` stay untouched.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
  ) {}

  async notify<K extends NotificationKind>(
    kind: K,
    recipients: ReadonlyArray<NotificationRecipient<K>>,
  ): Promise<NotifySummary> {
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      // `kind` and `recipient.payload` are correlated by the generic K, which
      // TypeScript cannot express when *building* a discriminated-union
      // member — this one assertion is the whole reason callers get full
      // type-checking (their payload had to satisfy PayloadFor<K> above) and
      // channels get an exhaustively narrowable union below.
      const message = { kind, payload: recipient.payload } as NotificationMessage;

      for (const channel of this.channels) {
        try {
          const ok = await channel.send(recipient.email, message, recipient.schoolId);
          if (ok) {
            sent += 1;
          } else {
            failed += 1;
          }
        } catch (e) {
          failed += 1;
          this.logger.error(
            `Notification channel "${channel.name}" threw for ${kind} -> ${recipient.email}: ${(e as Error).message}`,
          );
        }
      }
    }

    return { sent, failed };
  }
}

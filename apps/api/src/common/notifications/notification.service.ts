import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_CHANNELS } from './notification-channels.token';
import type { NotificationChannel, NotificationKind, NotifySummary } from './notification.types';

/**
 * Fans a notification out over every configured channel (email today,
 * WhatsApp later) for every recipient. Never throws — a channel that
 * rejects or resolves `false` is simply tallied as `failed`, so callers
 * (ExamsService.create/publish, AttendanceService.save, the reminder cron)
 * can fire this best-effort without risking their own mutation's result.
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

  async notify(
    kind: NotificationKind,
    recipients: string[],
    payload: Record<string, unknown>,
  ): Promise<NotifySummary> {
    let sent = 0;
    let failed = 0;

    for (const to of recipients) {
      for (const channel of this.channels) {
        try {
          const ok = await channel.send(kind, to, payload);
          if (ok) {
            sent += 1;
          } else {
            failed += 1;
          }
        } catch (e) {
          failed += 1;
          this.logger.error(
            `Notification channel "${channel.name}" threw for ${kind} -> ${to}: ${(e as Error).message}`,
          );
        }
      }
    }

    return { sent, failed };
  }
}

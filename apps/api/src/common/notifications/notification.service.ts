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

  /**
   * `onlyChannels`, when given, restricts this call to channels whose `.name`
   * is in the list (default: every configured channel, unchanged behaviour).
   *
   * Added for `ExamsService.create()`/`publish()`: TEST_SCHEDULED and
   * RESULTS_PUBLISHED now ALSO get a push send via the transactional
   * `NotificationOutbox` drain (`NotificationOutboxService`) — a guarantee
   * this best-effort, post-commit `notify()` call cannot offer (it simply
   * never runs if the process dies right after the mutation commits). If
   * `PushChannel` stayed in the default fan-out here too, a family would get
   * the SAME push twice: once best-effort immediately, once guaranteed via
   * the outbox. Those two call sites pass `['email']` so push is sent
   * exactly once, through the outbox, while email keeps its existing
   * best-effort immediate delivery unchanged.
   */
  async notify<K extends NotificationKind>(
    kind: K,
    recipients: ReadonlyArray<NotificationRecipient<K>>,
    onlyChannels?: readonly string[],
  ): Promise<NotifySummary> {
    let sent = 0;
    let failed = 0;
    const channels = onlyChannels
      ? this.channels.filter((c) => onlyChannels.includes(c.name))
      : this.channels;

    for (const recipient of recipients) {
      // `kind` and `recipient.payload` are correlated by the generic K, which
      // TypeScript cannot express when *building* a discriminated-union
      // member — this one assertion is the whole reason callers get full
      // type-checking (their payload had to satisfy PayloadFor<K> above) and
      // channels get an exhaustively narrowable union below.
      const message = { kind, payload: recipient.payload } as NotificationMessage;

      for (const channel of channels) {
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

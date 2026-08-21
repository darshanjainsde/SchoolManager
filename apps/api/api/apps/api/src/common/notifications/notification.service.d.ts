import type { NotificationChannel, NotificationKind, NotificationRecipient, NotifySummary } from './notification.types';
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
export declare class NotificationService {
    private readonly channels;
    private readonly logger;
    constructor(channels: NotificationChannel[]);
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
    notify<K extends NotificationKind>(kind: K, recipients: ReadonlyArray<NotificationRecipient<K>>, onlyChannels?: readonly string[]): Promise<NotifySummary>;
}
//# sourceMappingURL=notification.service.d.ts.map
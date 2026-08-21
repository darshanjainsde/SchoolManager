import { PushChannel } from '../../common/notifications/push.channel';
export interface NotificationOutboxDrainResult {
    processed: number;
    sent: number;
    failed: number;
}
/**
 * Drains the `NotificationOutbox` (S6/S7 wiring — see the model's docstring
 * in packages/db/prisma/schema.prisma and `ExamsService.create()`/`publish()`,
 * which write the rows this reads). Triggered by
 * `NotificationOutboxController` (`internal/cron/notification-outbox`), the
 * SAME `CronSecretGuard` pattern as `ExamRemindersService`.
 *
 * Runs on the platform (RLS-BYPASSING) Prisma client — like
 * `ExamRemindersService`, there is no tenant/JWT context for a cron
 * invocation, and `NotificationOutbox` rows span every school. Every
 * downstream lookup is still explicitly scoped by the row's own `schoolId`
 * (`resolveSectionRecipients`, `PushChannel.send`'s own `schoolId` filter).
 *
 * DELIVERY GUARANTEE IS AT-LEAST-ONCE, NOT EXACTLY-ONCE: the push send and
 * the `sentAt` write below are two separate steps, not one atomic unit (Expo
 * push has no transactional participation). If this process crashes AFTER a
 * successful `push.send()` but BEFORE the `sentAt` update commits, the row is
 * still `sentAt: null` and the NEXT drain run will resend it — a duplicate
 * "results published" push in that narrow crash window. This is the
 * documented tradeoff from the pitch ("never notified twice" refers to the
 * ORDINARY case — a row is marked sent immediately after a successful send,
 * so a normal re-run never re-touches it); we accept the rare at-least-once
 * duplicate rather than risk the opposite (a crash before `sentAt` commits
 * silently losing the notification forever, which a naive "mark sent before
 * sending" ordering would risk instead).
 */
export declare class NotificationOutboxService {
    private readonly push;
    private readonly logger;
    constructor(push: PushChannel);
    drain(): Promise<NotificationOutboxDrainResult>;
}
//# sourceMappingURL=notification-outbox.service.d.ts.map
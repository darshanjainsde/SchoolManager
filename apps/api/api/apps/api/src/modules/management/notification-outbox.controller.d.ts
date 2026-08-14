import { NotificationOutboxService, type NotificationOutboxDrainResult } from './notification-outbox.service';
/**
 * Triggered by Vercel Cron (see apps/api/vercel.json). Mirrors
 * `ExamRemindersController` exactly: no user/school JWT exists for a cron
 * invocation, so this is `@Public()` and protected by `CronSecretGuard`
 * instead (header `x-cron-secret` or Vercel's native
 * `Authorization: Bearer <CRON_SECRET>`, matching `process.env.CRON_SECRET`).
 *
 * BOTH verbs are exposed, and both sit behind `CronSecretGuard`:
 *   - GET  — what Vercel Cron actually invokes (the `crons` schema has no
 *            method option; it always issues a GET).
 *   - POST — manual/operator trigger (curl, runbook), and also the shape the
 *            Task 2 spec names explicitly.
 */
export declare class NotificationOutboxController {
    private readonly outbox;
    constructor(outbox: NotificationOutboxService);
    runFromCron(): Promise<NotificationOutboxDrainResult>;
    run(): Promise<NotificationOutboxDrainResult>;
}
//# sourceMappingURL=notification-outbox.controller.d.ts.map
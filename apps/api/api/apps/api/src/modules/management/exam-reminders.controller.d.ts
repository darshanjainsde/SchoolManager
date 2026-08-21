import { ExamRemindersService, type ExamReminderRunResult } from './exam-reminders.service';
/**
 * Triggered daily by Vercel Cron (see apps/api/vercel.json). There is no
 * user/school JWT for a cron invocation, so this is `@Public()` (bypasses
 * any JWT guard globally applied elsewhere) and instead protected by
 * `CronSecretGuard`, which requires header `x-cron-secret` (or Vercel's
 * native `Authorization: Bearer <CRON_SECRET>`) to match
 * `process.env.CRON_SECRET`.
 *
 * BOTH verbs are exposed, and both sit behind `CronSecretGuard`:
 *   - GET  — what Vercel Cron actually invokes. The `crons` schema has no
 *            method option; it always issues a GET, so a POST-only route
 *            would mean the daily job silently 404s forever.
 *   - POST — manual/operator trigger (curl, runbook).
 */
export declare class ExamRemindersController {
    private readonly reminders;
    constructor(reminders: ExamRemindersService);
    runFromCron(): Promise<ExamReminderRunResult>;
    run(): Promise<ExamReminderRunResult>;
}
//# sourceMappingURL=exam-reminders.controller.d.ts.map
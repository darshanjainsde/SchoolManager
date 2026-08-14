import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import {
  NotificationOutboxService,
  type NotificationOutboxDrainResult,
} from './notification-outbox.service';

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
@Controller('internal/cron')
@Public()
@UseGuards(CronSecretGuard)
export class NotificationOutboxController {
  constructor(private readonly outbox: NotificationOutboxService) {}

  @Get('notification-outbox')
  runFromCron(): Promise<NotificationOutboxDrainResult> {
    return this.outbox.drain();
  }

  @Post('notification-outbox')
  run(): Promise<NotificationOutboxDrainResult> {
    return this.outbox.drain();
  }
}

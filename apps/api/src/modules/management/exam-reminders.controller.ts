import { Controller, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { CronSecretGuard } from './cron-secret.guard';
import { ExamRemindersService, type ExamReminderRunResult } from './exam-reminders.service';

/**
 * Triggered daily by Vercel Cron (see apps/api/vercel.json). There is no
 * user/school JWT for a cron invocation, so this is `@Public()` (bypasses
 * any JWT guard globally applied elsewhere) and instead protected by
 * `CronSecretGuard`, which requires header `x-cron-secret` to match
 * `process.env.CRON_SECRET`.
 */
@Controller('internal/cron')
@Public()
@UseGuards(CronSecretGuard)
export class ExamRemindersController {
  constructor(private readonly reminders: ExamRemindersService) {}

  @Post('exam-reminders')
  run(): Promise<ExamReminderRunResult> {
    return this.reminders.run();
  }
}

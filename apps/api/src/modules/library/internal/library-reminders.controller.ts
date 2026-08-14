import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/auth/public.decorator';
import { CronSecretGuard } from '../../../common/auth/cron-secret.guard';
import { LibraryRemindersService, type LibraryReminderRunResult } from './library-reminders.service';

/**
 * Daily library reminders, triggered by Vercel Cron.
 *
 * There is no user or school JWT for a cron invocation, so this is `@Public()`
 * and protected by `CronSecretGuard` instead — the same shape as
 * `ExamRemindersController`, deliberately, rather than a second convention.
 *
 * BOTH verbs, for the same reason that controller documents: Vercel's `crons`
 * schema has no method option and always issues a GET, so a POST-only route
 * would mean the daily job silently 404s forever. POST is the operator's
 * manual trigger.
 *
 * `CRON_SECRET` unset means this fails CLOSED — no header can match an unset
 * secret. That is the right way round: an unauthenticated route that walks
 * every school's library and writes into people's inboxes is not something to
 * leave open when a variable is missing.
 */
@Controller('internal/cron')
@Public()
@UseGuards(CronSecretGuard)
export class LibraryRemindersController {
  constructor(private readonly reminders: LibraryRemindersService) {}

  @Get('library-reminders')
  runFromCron(): Promise<LibraryReminderRunResult> {
    return this.reminders.run();
  }

  @Post('library-reminders')
  run(): Promise<LibraryReminderRunResult> {
    return this.reminders.run();
  }
}

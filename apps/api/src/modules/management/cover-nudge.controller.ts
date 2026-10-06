import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { CoverNudgeService } from './cover-nudge.service';

/**
 * Vercel Cron issues a GET at 12:30 UTC (18:00 IST) and again at 12:45 UTC —
 * the second is a resume for schools a run cut short at its deadline (a school
 * already nudged is skipped) — see apps/api/vercel.json; POST is the
 * operator's manual trigger. No JWT on a cron call, so `@Public()` and
 * `CronSecretGuard` on both verbs.
 */
@Controller('internal/cron')
@Public()
@UseGuards(CronSecretGuard)
export class CoverNudgeController {
  constructor(private readonly nudge: CoverNudgeService) {}

  @Get('cover-nudge')
  runFromCron() {
    return this.nudge.run();
  }

  @Post('cover-nudge')
  run() {
    return this.nudge.run();
  }
}

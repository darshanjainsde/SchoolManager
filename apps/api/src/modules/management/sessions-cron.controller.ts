import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { SessionsService } from './sessions.service';

/**
 * Scheduled session starts (Active Roster, Track C). Mirrors
 * `NotificationOutboxController`: Vercel Cron issues a GET with the cron
 * secret; POST is the operator's manual trigger. Runs at 18:30 UTC — midnight
 * in Asia/Kolkata — and starts every SCHEDULED plan whose start day has come.
 */
@Controller('internal/cron')
@Public()
@UseGuards(CronSecretGuard)
export class SessionsCronController {
  constructor(private readonly sessions: SessionsService) {}

  @Get('session-start')
  runFromCron() {
    return this.sessions.startDue();
  }

  @Post('session-start')
  run() {
    return this.sessions.startDue();
  }
}

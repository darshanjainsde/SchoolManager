import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { FeeDueSoonService } from './fee-due-soon.service';

/**
 * Daily fee-due nudge. Same shape as `LibraryDueSoonController`: `@Public()`
 * (no user JWT exists for a Vercel Cron invocation) + the constant-time
 * `CronSecretGuard`, exposed on GET and POST because Vercel Cron issues GET.
 */
@Controller('internal/cron/fee-due-soon')
@Public()
@UseGuards(CronSecretGuard)
export class FeeDueSoonController {
  constructor(private readonly dueSoon: FeeDueSoonService) {}

  @Get()
  runGet() {
    return this.dueSoon.run();
  }

  @Post()
  runPost() {
    return this.dueSoon.run();
  }
}

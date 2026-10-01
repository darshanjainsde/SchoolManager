import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PlatformJwtGuard } from '../../common/auth/platform-jwt.guard';
import { OwnerHostGuard } from '../../common/auth/owner-host.guard';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { Public } from '../../common/auth/public.decorator';
import type { PlatformJwtPayload } from '../../common/auth/jwt-payload';
import { BackupsService } from './backups.service';
import { RegisterUploadDto, StartRestoreDto } from './backups.dto';
import { continueInBackground } from './continue';

/**
 * Owner console: school backups, restores and the safe delete. Same wall as
 * every owner route — the owner host AND a platform JWT.
 */
@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get('schools/:id/backups')
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.list(id);
  }

  @Post('schools/:id/backups')
  async start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() op: PlatformJwtPayload, @Req() req: Request) {
    const b = await this.backups.start(id, 'MANUAL', op?.sub ?? null);
    continueInBackground(req);
    return b;
  }

  /** Final backup, then the delete — one job. The school must be suspended. */
  @Post('schools/:id/delete')
  async deleteWithBackup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() op: PlatformJwtPayload, @Req() req: Request) {
    const b = await this.backups.deleteWithBackup(id, op?.sub ?? null);
    continueInBackground(req);
    return b;
  }

  @Get('backups/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.get(id);
  }

  /** The console polls this while a backup runs; each call advances it one step. */
  @Post('backups/:id/step')
  step(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.step(id);
  }

  @Get('backups/:id/download')
  download(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.downloadUrl(id);
  }

  @Post('backups/upload-url')
  uploadUrl() {
    return this.backups.uploadUrl();
  }

  @Post('backups/uploaded')
  registerUpload(@Body() dto: RegisterUploadDto, @CurrentUser() op: PlatformJwtPayload) {
    return this.backups.registerUpload(dto.key, op?.sub ?? null);
  }

  @Get('deleted-schools')
  deleted() {
    return this.backups.deletedSchools();
  }

  @Post('restores')
  async restore(@Body() dto: StartRestoreDto, @CurrentUser() op: PlatformJwtPayload, @Req() req: Request) {
    const r = await this.backups.startRestore(dto, op?.sub ?? null);
    continueInBackground(req);
    return r;
  }

  @Get('restores/:id')
  getRestore(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.getRestore(id);
  }

  @Post('restores/:id/step')
  stepRestore(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.stepRestore(id);
  }
}

/**
 * The engine room, for Vercel Cron and for the job's own continuation calls.
 * `@Public()` (no user JWT exists here) + the constant-time CronSecretGuard,
 * on GET and POST because Vercel Cron issues GET.
 */
@Controller('internal/cron/school-backups')
@Public()
@UseGuards(CronSecretGuard)
export class BackupsCronController {
  constructor(private readonly backups: BackupsService) {}

  private async drive(req: Request) {
    const r = await this.backups.drive(Date.now() + 52_000);
    if (r.moreWork) continueInBackground(req);
    return r;
  }

  @Get()
  runGet(@Req() req: Request) { return this.drive(req); }

  @Post()
  runPost(@Req() req: Request) { return this.drive(req); }

  @Get('weekly')
  async weeklyGet(@Req() req: Request) {
    const started = await this.backups.startWeekly();
    continueInBackground(req);
    return started;
  }
}

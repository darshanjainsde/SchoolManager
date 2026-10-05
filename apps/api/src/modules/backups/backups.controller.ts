import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PlatformJwtGuard } from '../../common/auth/platform-jwt.guard';
import { OwnerHostGuard } from '../../common/auth/owner-host.guard';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { Public } from '../../common/auth/public.decorator';
import type { PlatformJwtPayload } from '../../common/auth/jwt-payload';
import { BackupsService } from './backups.service';
import { BucketRestoresService } from './bucket-restores.service';
import { SamplePacksService } from './sample-packs.service';
import {
  BucketRestoreDto, CreatePackDto, RegisterPackUploadDto, RegisterUploadDto, RenamePackDto, SnapshotDto, StartRestoreDto,
} from './backups.dto';
import { BUCKETS, Bucket } from './engine/buckets';
import { continueInBackground } from './continue';

/**
 * Owner console: school backups, restores and the safe delete. Same wall as
 * every owner route — the owner host AND a platform JWT.
 */
@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class BackupsController {
  constructor(
    private readonly backups: BackupsService,
    private readonly bucketRestores: BucketRestoresService,
    private readonly packs: SamplePacksService,
  ) {}

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

  /* ── buckets ──────────────────────────────────────────────────────────── */

  /** One row per bucket: what it holds, when it was last saved, how far back it goes. */
  @Get('schools/:id/buckets')
  buckets(@Param('id', ParseUUIDPipe) id: string) {
    return this.backups.buckets(id);
  }

  /** Save some buckets now. An unchanged bucket is recognised and not kept twice. */
  @Post('schools/:id/buckets/save')
  async saveBuckets(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: SnapshotDto,
    @CurrentUser() op: PlatformJwtPayload, @Req() req: Request,
  ) {
    const wanted: Bucket[] = dto.buckets?.length ? dto.buckets : [...BUCKETS];
    const started = [];
    const skipped: { bucket: Bucket; why: string }[] = [];
    for (const bucket of wanted) {
      try {
        started.push(await this.backups.start(id, 'SNAPSHOT', op?.sub ?? null, { scope: [bucket] }));
      } catch (e) {
        skipped.push({ bucket, why: (e as Error).message });
      }
    }
    continueInBackground(req);
    return { started, skipped };
  }

  /** The versions of one bucket, newest first. */
  @Get('schools/:id/buckets/:bucket/versions')
  versions(@Param('id', ParseUUIDPipe) id: string, @Param('bucket') bucket: string) {
    return this.backups.bucketVersions(id, bucket);
  }

  /** What putting a snapshot, a pack, or a reset through would change. Read-only. */
  @Post('schools/:id/buckets/preflight')
  preflight(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BucketRestoreDto) {
    return this.bucketRestores.preflight({ ...dto, schoolId: id });
  }

  @Post('schools/:id/buckets/restore')
  async restoreBuckets(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: BucketRestoreDto,
    @CurrentUser() op: PlatformJwtPayload, @Req() req: Request,
  ) {
    const r = await this.bucketRestores.start({ ...dto, schoolId: id }, op?.sub ?? null);
    if (dto.packId) await this.packs.noteLoaded(dto.packId);
    continueInBackground(req);
    return r;
  }

  /** "Reset management data" — empty `setup` and `day`, keep the website. */
  @Post('schools/:id/buckets/reset')
  async reset(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() op: PlatformJwtPayload, @Req() req: Request) {
    const r = await this.bucketRestores.resetManagementData(id, op?.sub ?? null);
    continueInBackground(req);
    return r;
  }

  @Get('schools/:id/bucket-restores')
  bucketRestoreList(@Param('id', ParseUUIDPipe) id: string) {
    return this.bucketRestores.list(id);
  }

  @Get('bucket-restores/:id')
  bucketRestore(@Param('id', ParseUUIDPipe) id: string) {
    return this.bucketRestores.get(id);
  }

  @Post('bucket-restores/:id/step')
  stepBucketRestore(@Param('id', ParseUUIDPipe) id: string) {
    return this.bucketRestores.step(id);
  }

  /* ── the sample-pack library ──────────────────────────────────────────── */

  @Get('sample-packs')
  listPacks() {
    return this.packs.list();
  }

  @Get('sample-packs/excluded')
  packExclusions() {
    return this.packs.excluded();
  }

  @Post('sample-packs')
  async createPack(@Body() dto: CreatePackDto, @CurrentUser() op: PlatformJwtPayload, @Req() req: Request) {
    const p = await this.packs.createFromSchool(dto, op?.sub ?? null);
    continueInBackground(req);
    return p;
  }

  @Post('sample-packs/upload-url')
  packUploadUrl() {
    return this.packs.uploadUrl();
  }

  @Post('sample-packs/uploaded')
  registerPackUpload(@Body() dto: RegisterPackUploadDto, @CurrentUser() op: PlatformJwtPayload) {
    return this.packs.registerUpload(dto, op?.sub ?? null);
  }

  @Get('sample-packs/:id')
  getPack(@Param('id', ParseUUIDPipe) id: string) {
    return this.packs.get(id);
  }

  /** Polled while a pack is being built; each call advances it one step. */
  @Post('sample-packs/:id/step')
  stepPack(@Param('id', ParseUUIDPipe) id: string) {
    return this.packs.advance(id);
  }

  @Patch('sample-packs/:id')
  renamePack(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenamePackDto) {
    return this.packs.rename(id, dto);
  }

  @Get('sample-packs/:id/download')
  downloadPack(@Param('id', ParseUUIDPipe) id: string) {
    return this.packs.downloadUrl(id);
  }

  @Delete('sample-packs/:id')
  deletePack(@Param('id', ParseUUIDPipe) id: string) {
    return this.packs.remove(id);
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
  constructor(
    private readonly backups: BackupsService,
    private readonly bucketRestores: BucketRestoresService,
    private readonly packs: SamplePacksService,
  ) {}

  private async drive(req: Request) {
    const settled = await this.packs.settlePending().catch(() => 0);
    // ONE budget, ONE loop: backups, whole-school restores and scoped restores
    // all draw from the same 52 s, so none can run the invocation past its limit.
    const r = await this.backups.drive(Date.now() + 52_000, () => this.bucketRestores.stepNext());
    if (r.moreWork) continueInBackground(req);
    return { ...r, settled };
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

  /** Nightly: one snapshot per bucket per school in use. Unchanged ones are dropped. */
  @Get('snapshots')
  async snapshotsGet(@Req() req: Request) {
    const started = await this.backups.startSnapshots();
    continueInBackground(req);
    return started;
  }

  @Post('snapshots')
  async snapshotsPost(@Req() req: Request) {
    const started = await this.backups.startSnapshots();
    continueInBackground(req);
    return started;
  }
}

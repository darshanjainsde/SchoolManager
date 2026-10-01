import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { getPlatformPrisma, Prisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../../common/errors/api-error';
import { StorageService } from '../../common/storage/storage.service';
import { SchoolLookupService } from '../tenancy';
import { FeatureResolverService } from '../features';
import { ArchiveReader } from './engine/archive';
import { ArchiveError } from './engine/container';
import { rawDbFromPrisma } from './engine/db';
import { ExportState, Manifest, beginExport, runExport } from './engine/export';
import { FinalStatus, ImportFailed, ImportRefused, ImportState, preflightImport, rollbackImport, runImport } from './engine/import';
import { machineFromEnv } from './engine/machine';
import { purgeSchoolFiles, purgeSchoolRows } from './engine/purge';
import { buildSchemaPlan } from './engine/schema-plan';
import { MultipartState, S3MultipartSink, S3ObjectStore, S3Source, s3Client } from './engine/store';

/** A step must finish well inside the 60 s function limit, checkpoint included. */
const STEP_MS = 40_000;
const LEASE_MS = 75_000;
const DAY = 86_400_000;
/** How long each kind of backup is kept (decided 2026-10-01). WEEKLY also keeps only the last 4. */
const KEEP: Record<string, number> = { MANUAL: 90 * DAY, WEEKLY: 35 * DAY, BEFORE_DELETE: 365 * DAY, BEFORE_REPLACE: 90 * DAY, UPLOADED: 90 * DAY };
const WEEKLY_KEPT = 4;
/** A step that is cut off this many times in a row stops the job instead of retrying forever. */
const MAX_ATTEMPTS = 5;
/**
 * A final backup (before a delete or a replace) waits this long after the
 * school was suspended before reading a row: the host lookup is cached for
 * 60 s and requests already in flight must finish, or a late write could land
 * after its table was copied and be lost with the school.
 */
const SETTLE_MS = 70_000;

type BackupReason = 'MANUAL' | 'BEFORE_DELETE' | 'BEFORE_REPLACE' | 'WEEKLY' | 'UPLOADED';
interface BackupJobState { export: ExportState; sink: MultipartState | null; progress: number; attempts?: number; waiting?: boolean }
interface RestoreJobState {
  phase: 'awaiting-backup' | 'import';
  preBackupId?: string;
  previousStatus?: string;
  import: ImportState | null;
  progress: number;
  attempts?: number;
}

export interface BackupView {
  id: string; schoolId: string; schoolSlug: string; schoolName: string;
  reason: string; status: string; progress: number;
  sizeBytes: number | null; rowCount: number | null; fileCount: number | null;
  warnings: string[]; error: string | null; deleteSchoolAfter: boolean;
  /** READY, but the school it was taken to delete is not gone yet (retried by the cron). */
  deletePending: boolean;
  /** A final backup waiting for the suspended school to go quiet. */
  waiting: boolean;
  createdAt: Date; finishedAt: Date | null; expiresAt: Date | null;
}

/**
 * SCHOOL BACKUPS AS JOBS. The engine (./engine) knows how to copy a school;
 * this service decides WHEN, keeps the register, and makes sure a request
 * that dies halfway leaves nothing behind that the next one cannot finish.
 *
 * Every step: claim a lease (one worker per job), load the saved state, do
 * ~40 s of work, save the state, release. Steps are driven by the owner
 * console's polling AND by the cron, which re-calls itself while work is left
 * — so a backup finishes even when the operator closes the tab.
 */
@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);
  private readonly env = loadEnv();
  private readonly plan = buildSchemaPlan();
  private readonly s3 = s3Client(this.s3Config());
  private readonly files = new S3ObjectStore(this.s3, this.s3Config());
  /** Backups live in the private bucket when there is one. */
  private readonly bucket = this.env.S3_PRIVATE_BUCKET ?? this.env.S3_BUCKET;

  constructor(
    private readonly storage: StorageService,
    private readonly lookup: SchoolLookupService,
    private readonly features: FeatureResolverService,
  ) {}

  private s3Config() {
    const e = loadEnv();
    return {
      endpoint: e.S3_ENDPOINT, region: e.S3_REGION, forcePathStyle: e.S3_FORCE_PATH_STYLE,
      accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY,
      bucket: e.S3_BUCKET, privateBucket: e.S3_PRIVATE_BUCKET ?? null,
    };
  }

  private password(): string {
    // Read at use, like FEES_SECRET_KEY: loadEnv() caches its first parse.
    const pw = process.env.SCHOOL_BACKUP_PASSWORD || this.env.SCHOOL_BACKUP_PASSWORD;
    if (!pw) {
      throw new ApiError('BACKUPS_NOT_CONFIGURED', 'Backups are switched off on this server: SCHOOL_BACKUP_PASSWORD is not set. Set it (and keep a copy somewhere safe), then redeploy.', 503);
    }
    return pw;
  }

  private deps() {
    return { db: rawDbFromPrisma(getPlatformPrisma()), files: this.files, machine: machineFromEnv(this.env), plan: this.plan };
  }

  /* ── reading the register ─────────────────────────────────────────────── */

  private view(b: Prisma.SchoolBackupGetPayload<object>): BackupView {
    const st = b.state as unknown as BackupJobState | null;
    const m = b.manifest as unknown as Manifest | null;
    return {
      id: b.id, schoolId: b.sourceSchoolId, schoolSlug: b.schoolSlug, schoolName: b.schoolName,
      reason: b.reason, status: b.status,
      progress: b.status === 'READY' ? 1 : (st?.progress ?? 0),
      sizeBytes: b.sizeBytes == null ? null : Number(b.sizeBytes),
      rowCount: b.rowCount, fileCount: b.fileCount,
      warnings: m?.warnings ?? [], error: b.error, deleteSchoolAfter: b.deleteSchoolAfter,
      deletePending: b.deleteSchoolAfter && b.status === 'READY',
      waiting: b.status === 'RUNNING' && !!st?.waiting,
      createdAt: b.createdAt, finishedAt: b.finishedAt, expiresAt: b.expiresAt,
    };
  }

  async list(schoolId: string): Promise<BackupView[]> {
    const rows = await getPlatformPrisma().schoolBackup.findMany({ where: { sourceSchoolId: schoolId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((r) => this.view(r));
  }

  async get(id: string): Promise<BackupView> {
    const b = await getPlatformPrisma().schoolBackup.findUnique({ where: { id } });
    if (!b) throw new ApiError('NOT_FOUND', 'No such backup.', 404);
    return this.view(b);
  }

  /** Schools that are gone, with the newest backup each one left behind. */
  async deletedSchools() {
    const rows = await getPlatformPrisma().$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ON (b."sourceSchoolId") b.id
        FROM "SchoolBackup" b
       WHERE b.status = 'READY'
         AND NOT EXISTS (SELECT 1 FROM "School" s WHERE s.id = b."sourceSchoolId")
       ORDER BY b."sourceSchoolId", b."createdAt" DESC`;
    const backups = await getPlatformPrisma().schoolBackup.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'desc' } });
    return backups.map((b) => this.view(b));
  }

  /* ── taking a backup ──────────────────────────────────────────────────── */

  async start(schoolId: string, reason: BackupReason, actor: string | null, opts: { deleteSchoolAfter?: boolean } = {}): Promise<BackupView> {
    this.password(); // refuse up front when backups are not configured
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true, slug: true, name: true, status: true } });
    if (!school) throw new ApiError('NOT_FOUND', 'No such school.', 404);
    if (opts.deleteSchoolAfter && school.status !== 'SUSPENDED') {
      throw new ApiError('SCHOOL_NOT_SUSPENDED', 'Suspend the school first — a school is only deleted after a final backup of it suspended, when nothing can change underneath.', 409);
    }
    const id = randomUUID();
    const stamp = new Date().toISOString().slice(0, 10);
    const exportState = await beginExport(this.deps(), schoolId);
    try {
      const b = await db.schoolBackup.create({
        data: {
          id, sourceSchoolId: schoolId, schoolSlug: school.slug, schoolName: school.name, reason,
          storageKey: `backups/schools/${schoolId}/${school.slug}-${stamp}-${id.slice(0, 8)}.sckools`,
          deleteSchoolAfter: !!opts.deleteSchoolAfter, createdBy: actor,
          state: { export: exportState, sink: null, progress: 0 } as unknown as Prisma.InputJsonValue,
        },
      });
      return this.view(b);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ApiError('BACKUP_RUNNING', 'A backup of this school is already running. Wait for it to finish.', 409);
      }
      throw e;
    }
  }

  /** Claims the job for one step. False when another request holds it. */
  private async lease(table: 'schoolBackup' | 'schoolRestore', id: string): Promise<boolean> {
    const now = new Date();
    const r = await (getPlatformPrisma()[table] as unknown as { updateMany: (a: unknown) => Promise<{ count: number }> }).updateMany({
      where: { id, status: 'RUNNING', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS) },
    });
    return r.count === 1;
  }

  /** Runs one step of a backup. Safe to call from anywhere, any number of times. */
  async step(id: string): Promise<BackupView> {
    const db = getPlatformPrisma();
    if (!(await this.lease('schoolBackup', id))) return this.get(id);
    const b = await db.schoolBackup.findUniqueOrThrow({ where: { id } });
    const st = b.state as unknown as BackupJobState;
    const fail = async (msg: string, sinkState: MultipartState | null) => {
      if (sinkState) await S3MultipartSink.abort(this.s3, sinkState);
      await db.schoolBackup.update({ where: { id }, data: { status: 'FAILED', error: msg.slice(0, 2000), state: Prisma.DbNull, lockedUntil: null, finishedAt: new Date() } });
      return this.get(id);
    };

    // A step that never finishes (killed at the time limit, out of memory)
    // must not be retried forever, holding the school's one backup slot.
    const attempts = (st.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) {
      return fail(`Stopped after ${MAX_ATTEMPTS} tries in a row that were cut off before finishing. Nothing was deleted. Try again, or use the command line (pnpm school export) for a school this large.`, st.sink);
    }

    if ((b.reason === 'BEFORE_DELETE' || b.reason === 'BEFORE_REPLACE') && st.export.table === 0 && !st.export.writer) {
      const school = await db.school.findUnique({ where: { id: b.sourceSchoolId }, select: { statusChangedAt: true } });
      if (school?.statusChangedAt && Date.now() - school.statusChangedAt.getTime() < SETTLE_MS) {
        await db.schoolBackup.update({ where: { id }, data: { lockedUntil: null, state: { ...st, waiting: true } as unknown as Prisma.InputJsonValue } });
        return this.get(id);
      }
    }
    await db.schoolBackup.update({ where: { id }, data: { state: { ...st, attempts, waiting: false } as unknown as Prisma.InputJsonValue } });

    let sink: S3MultipartSink | null = null;
    try {
      const password = this.password();
      sink = st.sink ? await S3MultipartSink.resume(this.s3, st.sink) : await S3MultipartSink.start(this.s3, this.bucket, b.storageKey);
      const r = await runExport({ ...this.deps(), appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? null }, st.export, sink, password, { deadline: Date.now() + STEP_MS });
      if (!r.done) {
        const s2 = r.state;
        const tables = this.plan.insertOrder.length;
        const progress = s2.phase === 'rows' ? 0.9 * (s2.table / tables) : 0.9 + 0.1 * (s2.files?.length ? s2.file / s2.files.length : 0);
        await db.schoolBackup.update({ where: { id }, data: { state: { export: s2, sink: sink.state, progress, attempts: 0 } as unknown as Prisma.InputJsonValue, lockedUntil: null } });
        return this.get(id);
      }
      // Proof it can be read back: header, password, footer and the sealed
      // index — any truncation or damage fails here, not at restore time.
      const reader = await ArchiveReader.open<Manifest>(new S3Source(this.s3, this.bucket, b.storageKey), password);
      if (reader.manifest.rowCount !== r.manifest!.rowCount) throw new Error('the stored backup does not read back the same — it was not kept');
      await db.schoolBackup.update({
        where: { id },
        data: {
          status: 'READY', state: Prisma.DbNull, lockedUntil: null, finishedAt: new Date(),
          sizeBytes: BigInt(r.bytes ?? reader.bytes), rowCount: r.manifest!.rowCount, fileCount: r.manifest!.fileCount,
          manifest: r.manifest as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + (KEEP[b.reason] ?? 90 * DAY)),
        },
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      this.logger.error(`backup ${id} failed: ${msg}`);
      return fail(msg, sink?.state ?? st.sink);
    }
    // From here the backup is READY and stays READY, whatever happens next.
    if (b.deleteSchoolAfter) await this.finishPendingDelete(id);
    if (b.reason === 'WEEKLY') await this.pruneWeekly(b.sourceSchoolId).catch((e) => this.logger.warn(`weekly prune: ${(e as Error).message}`));
    return this.get(id);
  }

  /**
   * The delete that a "Delete school" backup was taken for. Never touches the
   * backup's status: a failure is written on it and retried by the cron.
   */
  private async finishPendingDelete(backupId: string): Promise<void> {
    const db = getPlatformPrisma();
    const b = await db.schoolBackup.findUnique({ where: { id: backupId } });
    if (!b || b.status !== 'READY' || !b.deleteSchoolAfter) return;
    try {
      const school = await db.school.findUnique({ where: { id: b.sourceSchoolId }, select: { status: true } });
      if (school && school.status !== 'SUSPENDED') {
        await db.schoolBackup.update({ where: { id: backupId }, data: { deleteSchoolAfter: false, error: 'Not deleted: the school was taken off Suspended while its final backup ran. The backup is kept.' } });
        return;
      }
      if (school) {
        await this.deleteSchoolNow(b.sourceSchoolId, backupId);
      } else {
        // An earlier attempt removed the rows and was cut off before the files.
        await purgeSchoolFiles(this.files, b.sourceSchoolId);
        await this.forget(b.sourceSchoolId, [`${b.schoolSlug}.${this.env.PLATFORM_HOST}`]);
      }
      await db.schoolBackup.update({ where: { id: backupId }, data: { deleteSchoolAfter: false, error: null } });
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.error(`delete after backup ${backupId} did not finish: ${msg}`);
      await db.schoolBackup.update({ where: { id: backupId }, data: { error: `The backup is safe. The delete did not finish (${msg.slice(0, 300)}); it is retried automatically.` } });
    }
  }

  async downloadUrl(id: string): Promise<{ url: string; fileName: string; expiresInSeconds: number }> {
    const b = await getPlatformPrisma().schoolBackup.findUnique({ where: { id } });
    if (!b || b.status !== 'READY') throw new ApiError('NOT_FOUND', 'That backup is not ready to download.', 404);
    return { url: await this.storage.presignedGet(b.storageKey, 300), fileName: b.storageKey.split('/').pop()!, expiresInSeconds: 300 };
  }

  /* ── uploading a backup made somewhere else ───────────────────────────── */

  async uploadUrl(): Promise<{ key: string; url: string; expiresInSeconds: number }> {
    this.password();
    const key = `backups/uploads/${randomUUID()}.sckools`;
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: 'application/octet-stream' }), { expiresIn: 900 });
    return { key, url, expiresInSeconds: 900 };
  }

  /** Checks an uploaded file and adds it to the register so it can be restored. */
  async registerUpload(key: string, actor: string | null): Promise<BackupView> {
    if (!/^backups\/uploads\/[0-9a-f-]{36}\.sckools$/.test(key)) throw new ApiError('VALIDATION', 'That is not an upload this server issued.', 400);
    let reader: ArchiveReader<Manifest>;
    try {
      reader = await ArchiveReader.open<Manifest>(new S3Source(this.s3, this.bucket, key), this.password());
    } catch (e) {
      if (e instanceof ArchiveError) {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
        throw new ApiError('VALIDATION', e.code === 'WRONG_PASSWORD'
          ? 'This file is locked with a different backup password. Import it with the command line instead: pnpm school import <file> --password …'
          : e.message, 400);
      }
      if ((e as { name?: string }).name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        throw new ApiError('NOT_FOUND', 'The upload did not arrive. Try again.', 404);
      }
      throw e;
    }
    const m = reader.manifest;
    if (m?.kind !== 'sckools.school') throw new ApiError('VALIDATION', 'This is a Sckools backup, but not of a school.', 400);
    const b = await getPlatformPrisma().schoolBackup.create({
      data: {
        sourceSchoolId: m.source.schoolId, schoolSlug: m.source.slug, schoolName: m.source.name, reason: 'UPLOADED', status: 'READY',
        storageKey: key, sizeBytes: BigInt(reader.bytes), rowCount: m.rowCount, fileCount: m.fileCount,
        manifest: m as unknown as Prisma.InputJsonValue, createdBy: actor, finishedAt: new Date(), expiresAt: new Date(Date.now() + KEEP.UPLOADED),
      },
    });
    return this.view(b);
  }

  /* ── deleting a school ────────────────────────────────────────────────── */

  /**
   * "Delete school" — a final backup, then the delete, as one job. The school
   * is removed only by the job, and only once that backup is READY and has
   * been read back.
   */
  async deleteWithBackup(schoolId: string, actor: string | null): Promise<BackupView> {
    return this.start(schoolId, 'BEFORE_DELETE', actor, { deleteSchoolAfter: true });
  }

  /**
   * Removes a school now. Refused unless it is SUSPENDED and a READY backup was
   * taken after it was suspended — so no delete can ever lose data that is
   * not in a backup.
   */
  async deleteSchoolNow(schoolId: string, backupId?: string): Promise<{ ok: true; files: number; backupId: string }> {
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true, slug: true, status: true, statusChangedAt: true, domains: { select: { hostname: true } } } });
    if (!school) throw new ApiError('NOT_FOUND', 'No such school.', 404);
    if (school.status !== 'SUSPENDED') throw new ApiError('SCHOOL_NOT_SUSPENDED', 'Suspend the school first — only suspended schools can be deleted.', 409);
    const backup = await db.schoolBackup.findFirst({
      where: {
        ...(backupId ? { id: backupId } : {}),
        sourceSchoolId: schoolId, status: 'READY', reason: { not: 'UPLOADED' },
        ...(school.statusChangedAt ? { createdAt: { gte: school.statusChangedAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!backup) throw new ApiError('BACKUP_REQUIRED', 'Take a backup of the school first — a school is never deleted without one taken after it was suspended.', 409);
    // The file must really be there — a register row is not a backup.
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: backup.storageKey }));
    } catch {
      throw new ApiError('BACKUP_REQUIRED', 'The backup file for this school is missing from storage, so it was not deleted. Take a new backup.', 409);
    }
    // The school's last backup is kept as long as a deleted school's is.
    const keepUntil = new Date(Date.now() + KEEP.BEFORE_DELETE);
    if (!backup.expiresAt || backup.expiresAt < keepUntil) {
      await db.schoolBackup.update({ where: { id: backup.id }, data: { expiresAt: keepUntil } });
    }

    await purgeSchoolRows(this.deps().db, this.plan, schoolId);
    const files = await purgeSchoolFiles(this.files, schoolId);
    await this.forget(schoolId, [school.slug + '.' + this.env.PLATFORM_HOST, ...school.domains.map((d) => d.hostname)]);
    this.logger.warn(`School ${school.slug} (${schoolId}) deleted — ${files} files; final backup ${backup.id}`);
    return { ok: true, files, backupId: backup.id };
  }

  /** Drops the cached host lookup and feature flags, so a change takes effect now, not in a minute. */
  async forgetSchool(schoolId: string): Promise<void> {
    const s = await getPlatformPrisma().school.findUnique({ where: { id: schoolId }, select: { slug: true, domains: { select: { hostname: true } } } });
    if (s) await this.forget(schoolId, [`${s.slug}.${this.env.PLATFORM_HOST}`, ...s.domains.map((d) => d.hostname)]);
  }

  private async forget(schoolId: string, hosts: string[]): Promise<void> {
    await this.features.invalidate(schoolId);
    for (const h of hosts) await this.lookup.invalidate(h.toLowerCase());
  }

  /* ── restoring ────────────────────────────────────────────────────────── */

  async startRestore(
    input: { backupId: string; mode: 'restore' | 'replace'; slug?: string; finalStatus: FinalStatus },
    actor: string | null,
  ) {
    const db = getPlatformPrisma();
    const backup = await db.schoolBackup.findUnique({ where: { id: input.backupId } });
    if (!backup || backup.status !== 'READY') throw new ApiError('NOT_FOUND', 'That backup is not ready.', 404);
    const reader = await this.reader(backup.storageKey);
    const deps = this.deps();
    const schoolId = backup.sourceSchoolId;
    const existing = await db.school.findUnique({ where: { id: schoolId }, select: { status: true } });

    // Every refusal that can be decided now is decided now — before the
    // current copy is touched.
    let importState: ImportState | null = null;
    try {
      importState = await preflightImport(deps, reader, { mode: input.mode, slug: input.slug, finalStatus: input.finalStatus });
    } catch (e) {
      if (!(e instanceof ImportRefused)) throw e;
      if (!(e.code === 'ALREADY_HERE' && input.mode === 'replace')) throw new ApiError('RESTORE_REFUSED', e.message, 409);
    }
    if (input.mode === 'replace' && !existing) throw new ApiError('VALIDATION', 'That school is not on this server — choose Restore, not Replace.', 400);

    let state: RestoreJobState;
    if (input.mode === 'replace') {
      // Freeze the current copy, then back it up, BEFORE anything is removed.
      await db.school.update({ where: { id: schoolId }, data: { status: 'SUSPENDED', statusChangedAt: new Date() } });
      await this.forgetSchool(schoolId);
      let pre: BackupView;
      try {
        pre = await this.start(schoolId, 'BEFORE_REPLACE', actor);
      } catch (e) {
        // Nothing has been touched yet — put the school back as it was.
        await db.school.update({ where: { id: schoolId }, data: { status: existing!.status, statusChangedAt: new Date() } });
        await this.forgetSchool(schoolId);
        throw e;
      }
      state = { phase: 'awaiting-backup', preBackupId: pre.id, previousStatus: existing!.status, import: null, progress: 0 };
    } else {
      state = { phase: 'import', import: importState, progress: 0 };
    }
    try {
      const r = await db.schoolRestore.create({
        data: {
          backupId: backup.id, sourceSchoolId: schoolId, targetSlug: input.slug ?? backup.schoolSlug,
          mode: input.mode.toUpperCase(), finalStatus: input.finalStatus, createdBy: actor,
          state: state as unknown as Prisma.InputJsonValue,
        },
      });
      return this.restoreView(r);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ApiError('RESTORE_RUNNING', 'A restore of this school is already running.', 409);
      throw e;
    }
  }

  private async reader(key: string): Promise<ArchiveReader<Manifest>> {
    try {
      return await ArchiveReader.open<Manifest>(new S3Source(this.s3, this.bucket, key), this.password());
    } catch (e) {
      if (e instanceof ArchiveError) throw new ApiError('VALIDATION', e.message, 400);
      throw e;
    }
  }

  private restoreView(r: Prisma.SchoolRestoreGetPayload<object>) {
    const st = r.state as unknown as RestoreJobState | null;
    return {
      id: r.id, backupId: r.backupId, schoolId: r.sourceSchoolId, targetSlug: r.targetSlug,
      mode: r.mode, finalStatus: r.finalStatus, status: r.status,
      phase: st?.phase ?? null, progress: r.status === 'DONE' ? 1 : (st?.progress ?? 0),
      preBackupId: st?.preBackupId ?? null,
      report: r.report, error: r.error, createdAt: r.createdAt, finishedAt: r.finishedAt,
    };
  }

  async getRestore(id: string) {
    const r = await getPlatformPrisma().schoolRestore.findUnique({ where: { id } });
    if (!r) throw new ApiError('NOT_FOUND', 'No such restore.', 404);
    return this.restoreView(r);
  }

  async stepRestore(id: string) {
    const db = getPlatformPrisma();
    if (!(await this.lease('schoolRestore', id))) return this.getRestore(id);
    const r = await db.schoolRestore.findUniqueOrThrow({ where: { id } });
    const st = r.state as unknown as RestoreJobState;
    const deps = this.deps();
    const fail = async (msg: string) => {
      await db.schoolRestore.update({ where: { id }, data: { status: 'FAILED', error: msg.slice(0, 2000), lockedUntil: null, finishedAt: new Date() } });
      return this.getRestore(id);
    };
    const attempts = (st.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS && st.phase === 'import') {
      if (st.import?.started) await rollbackImport(deps, st.import).catch((e) => this.logger.error(`rollback: ${(e as Error).message}`));
      return fail(`Stopped after ${MAX_ATTEMPTS} tries in a row that were cut off before finishing; nothing of the import was kept.${st.preBackupId ? ` The school as it was before is in backup ${st.preBackupId}.` : ''} Use the command line (pnpm school import) for a school this large.`);
    }
    if (st.phase === 'import') await db.schoolRestore.update({ where: { id }, data: { state: { ...st, attempts } as unknown as Prisma.InputJsonValue } });
    try {
      if (st.phase === 'awaiting-backup') {
        const pre = await this.step(st.preBackupId!);
        if (pre.status === 'RUNNING') {
          await db.schoolRestore.update({ where: { id }, data: { lockedUntil: null, state: { ...st, progress: 0.3 * pre.progress } as unknown as Prisma.InputJsonValue } });
          return this.getRestore(id);
        }
        if (pre.status !== 'READY') {
          await db.school.update({ where: { id: r.sourceSchoolId }, data: { status: st.previousStatus as never, statusChangedAt: new Date() } });
          return fail(`The current copy could not be backed up (${pre.error ?? 'unknown error'}), so nothing was replaced. The school is back as it was.`);
        }
        // The current copy is safely in a backup — only now is it removed.
        const backup = await db.schoolBackup.findUniqueOrThrow({ where: { id: r.backupId! } });
        const reader = await this.reader(backup.storageKey);
        const hosts = await db.domain.findMany({ where: { schoolId: r.sourceSchoolId }, select: { hostname: true } });
        const slug = (await db.school.findUnique({ where: { id: r.sourceSchoolId }, select: { slug: true } }))?.slug;
        await purgeSchoolRows(deps.db, this.plan, r.sourceSchoolId);
        await purgeSchoolFiles(this.files, r.sourceSchoolId);
        await this.forget(r.sourceSchoolId, [...(slug ? [`${slug}.${this.env.PLATFORM_HOST}`] : []), ...hosts.map((h) => h.hostname)]);
        const imp = await preflightImport(deps, reader, { mode: 'replace', slug: r.targetSlug, finalStatus: r.finalStatus as FinalStatus });
        const next: RestoreJobState = { ...st, phase: 'import', import: imp, progress: 0.3 };
        await db.schoolRestore.update({ where: { id }, data: { state: next as unknown as Prisma.InputJsonValue, lockedUntil: null } });
        return this.getRestore(id);
      }

      const backup = await db.schoolBackup.findUniqueOrThrow({ where: { id: r.backupId! } });
      const reader = await this.reader(backup.storageKey);
      const res = await runImport(deps, reader, st.import!, { deadline: Date.now() + STEP_MS });
      const base = st.preBackupId ? 0.3 : 0;
      if (!res.done) {
        const s = res.state;
        const prog = base + (1 - base) * (s.phase === 'rows' ? 0.85 * (s.table / this.plan.insertOrder.length) : 0.9);
        await db.schoolRestore.update({ where: { id }, data: { state: { ...st, import: s, progress: prog, attempts: 0 } as unknown as Prisma.InputJsonValue, lockedUntil: null } });
        return this.getRestore(id);
      }
      await db.schoolRestore.update({
        where: { id },
        data: { status: 'DONE', report: res.report as unknown as Prisma.InputJsonValue, state: Prisma.DbNull, lockedUntil: null, finishedAt: new Date() },
      });
      const doms = await db.domain.findMany({ where: { schoolId: r.sourceSchoolId }, select: { hostname: true } });
      await this.forget(r.sourceSchoolId, [`${r.targetSlug}.${this.env.PLATFORM_HOST}`, ...doms.map((d) => d.hostname)]);
      return this.getRestore(id);
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof ImportRefused || e instanceof ImportFailed ? e.message : (e as Error).message;
      this.logger.error(`restore ${id} failed: ${msg}`);
      // The import may have got further than the saved state says (the School
      // row is written in the same step that failed) — use the state it reached.
      const reached = e instanceof ImportFailed ? e.state : st.import;
      if (reached?.started) {
        try {
          await rollbackImport(deps, reached);
        } catch (re) {
          this.logger.error(`restore ${id} rollback failed: ${(re as Error).message}`);
        }
      }
      return fail(st.preBackupId
        ? `${msg} — nothing of the import was kept. The school as it was before is in backup ${st.preBackupId}; restore that to bring it back.`
        : `${msg} — nothing of the import was kept.`);
    }
  }

  /* ── the cron ─────────────────────────────────────────────────────────── */

  /** Expires old backups, then advances every running job until `deadline`. Returns whether work is left. */
  async drive(deadline: number): Promise<{ moreWork: boolean; expired: number; stepped: number }> {
    const db = getPlatformPrisma();
    let expired = 0;
    for (const b of await db.schoolBackup.findMany({ where: { status: 'READY', expiresAt: { lt: new Date() } }, take: 100 })) {
      await this.expire(b.id, b.storageKey);
      expired += 1;
    }
    // Deletes whose backup is safe but whose delete was cut off or failed.
    for (const b of await db.schoolBackup.findMany({ where: { status: 'READY', deleteSchoolAfter: true }, take: 20, select: { id: true } })) {
      if (Date.now() + STEP_MS > deadline) break;
      await this.finishPendingDelete(b.id);
    }
    let stepped = 0;
    for (;;) {
      if (Date.now() + STEP_MS > deadline) break;
      const now = new Date();
      const nextBackup = await db.schoolBackup.findFirst({ where: { status: 'RUNNING', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      const nextRestore = await db.schoolRestore.findFirst({ where: { status: 'RUNNING', OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!nextBackup && !nextRestore) break;
      if (nextRestore) await this.stepRestore(nextRestore.id);
      else if (nextBackup) await this.step(nextBackup.id);
      stepped += 1;
    }
    const left = (await db.schoolBackup.count({ where: { status: 'RUNNING' } }))
      + (await db.schoolRestore.count({ where: { status: 'RUNNING' } }))
      + (await db.schoolBackup.count({ where: { status: 'READY', deleteSchoolAfter: true, error: null } }));
    return { moreWork: left > 0, expired, stepped };
  }

  /** Sunday 03:00 IST: one WEEKLY backup per live school. */
  async startWeekly(): Promise<{ started: number; skipped: number }> {
    if (!(process.env.SCHOOL_BACKUP_PASSWORD || this.env.SCHOOL_BACKUP_PASSWORD)) return { started: 0, skipped: 0 };
    const schools = await getPlatformPrisma().school.findMany({ where: { status: 'LIVE' }, select: { id: true } });
    let started = 0; let skipped = 0;
    for (const s of schools) {
      try { await this.start(s.id, 'WEEKLY', 'cron'); started += 1; } catch { skipped += 1; }
    }
    return { started, skipped };
  }

  private async pruneWeekly(schoolId: string): Promise<void> {
    const old = await getPlatformPrisma().schoolBackup.findMany({
      where: { sourceSchoolId: schoolId, reason: 'WEEKLY', status: 'READY' }, orderBy: { createdAt: 'desc' }, skip: WEEKLY_KEPT,
    });
    for (const b of old) await this.expire(b.id, b.storageKey);
  }

  /** Marked EXPIRED first, so nothing (a delete, a restore) can pick it up while its file goes. */
  private async expire(id: string, key: string): Promise<void> {
    const r = await getPlatformPrisma().schoolBackup.updateMany({ where: { id, status: 'READY', deleteSchoolAfter: false }, data: { status: 'EXPIRED' } });
    if (r.count === 0) return;
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch((e) => this.logger.warn(`could not remove ${key}: ${(e as Error).message}`));
  }
}

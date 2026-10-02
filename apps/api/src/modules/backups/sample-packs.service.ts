import { Injectable, Logger } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { Prisma, getPlatformPrisma } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { BackupsService } from './backups.service';
import { scopeKey } from './bucket-retention';
import { ArchiveError } from './engine/container';
import { BACKUP_KIND, Manifest } from './engine/export';
import { DATA_BUCKETS } from './engine/buckets';
import { PACK_EXCLUDED_MODELS } from './engine/rehome';
import { S3Source } from './engine/store';

/** Where a pack's object lives: platform level, never under a school. */
const PACK_PREFIX = 'samples/packs/';
const UPLOAD_PREFIX = 'samples/uploads/';
const NAME_RULE = /^[\p{L}\p{N}][\p{L}\p{N} ,._()+&/'’-]{1,59}$/u;

export interface PackView {
  id: string;
  name: string;
  notes: string | null;
  scope: string;
  status: string;
  version: number;
  rowCount: number | null;
  fileCount: number | null;
  sizeBytes: number | null;
  tableCount: number;
  takenAt: string | null;
  sourceSchoolId: string | null;
  sourceSchoolName: string | null;
  loadCount: number;
  lastLoadedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** The build job, while one is running. */
  buildingBackupId: string | null;
  buildProgress: number;
}

/**
 * THE SAMPLE-PACK LIBRARY.
 *
 * A pack is one school's management data (`setup` + `day`) frozen under a name,
 * so it can be loaded into any school to show that school what the product
 * looks like with a year of believable data in it. The school's website and its
 * own settings are never part of a pack, and loading one never touches them.
 *
 * Packs are kept at PLATFORM level, not under the school they were cut from:
 * the pack belongs to the platform, so deleting that school can never take the
 * pack with it. There can be as many as you like, and each load says which one
 * it came from.
 *
 * Two ways in — freeze a school, or upload a file made elsewhere — and both end
 * as the same password-locked `.sckools` archive, so a pack cut on a laptop
 * loads on staging and the other way round.
 */
@Injectable()
export class SamplePacksService {
  private readonly logger = new Logger(SamplePacksService.name);

  constructor(private readonly backups: BackupsService) {}

  private rt() { return this.backups.runtime(); }

  /** The plan a pack is built and loaded under: the management half, minus what must not travel. */
  packPlan() {
    return this.rt().plan;
  }

  private view(p: Prisma.SamplePackGetPayload<object>, job?: { id: string; progress: number } | null): PackView {
    const m = p.manifest as unknown as Manifest | null;
    return {
      id: p.id, name: p.name, notes: p.notes, scope: p.scope, status: p.status, version: p.version,
      rowCount: p.rowCount, fileCount: p.fileCount,
      sizeBytes: p.sizeBytes == null ? null : Number(p.sizeBytes),
      tableCount: Object.keys(m?.tables ?? {}).length,
      takenAt: m?.takenAt ?? null,
      sourceSchoolId: p.sourceSchoolId, sourceSchoolName: p.sourceSchoolName,
      loadCount: p.loadCount, lastLoadedAt: p.lastLoadedAt, error: p.error,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      buildingBackupId: job?.id ?? null, buildProgress: job?.progress ?? 0,
    };
  }

  async list(): Promise<PackView[]> {
    const db = getPlatformPrisma();
    const packs = await db.samplePack.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const jobs = await db.schoolBackup.findMany({
      where: { packId: { in: packs.map((p) => p.id) }, status: 'RUNNING' },
      select: { id: true, packId: true, state: true },
    });
    return packs.map((p) => {
      const job = jobs.find((j) => j.packId === p.id);
      const st = job?.state as { progress?: number } | null;
      return this.view(p, job ? { id: job.id, progress: st?.progress ?? 0 } : null);
    });
  }

  async get(id: string): Promise<PackView> {
    const p = await getPlatformPrisma().samplePack.findUnique({ where: { id } });
    if (!p) throw new ApiError('NOT_FOUND', 'No such sample pack.', 404);
    const job = await getPlatformPrisma().schoolBackup.findFirst({ where: { packId: id, status: 'RUNNING' }, select: { id: true, state: true } });
    const st = job?.state as { progress?: number } | null;
    return this.view(p, job ? { id: job.id, progress: st?.progress ?? 0 } : null);
  }

  private checkName(name: string): string {
    const n = name.trim();
    if (!NAME_RULE.test(n)) {
      throw new ApiError('VALIDATION', 'Give the pack a name of 2 to 60 letters or digits — it is what you will pick from the list later.', 400);
    }
    return n;
  }

  /* ── cutting a pack from a school ─────────────────────────────────────── */

  /**
   * Freezes a school's management data under a name.
   *
   * The export runs as an ordinary backup job — resumable, leased, driven by
   * the cron — but writes straight to the pack's own object, so there is no
   * copy step that could leave half a pack in the library. Until it finishes,
   * the pack is BUILDING and cannot be loaded.
   */
  async createFromSchool(input: { schoolId: string; name: string; notes?: string | null }, actor: string | null): Promise<PackView> {
    const db = getPlatformPrisma();
    const name = this.checkName(input.name);
    this.rt().password();
    const school = await db.school.findUnique({ where: { id: input.schoolId }, select: { id: true, name: true } });
    if (!school) throw new ApiError('NOT_FOUND', 'No such school.', 404);
    if (await db.samplePack.findUnique({ where: { name } })) {
      throw new ApiError('PACK_NAME_TAKEN', `There is already a pack called "${name}". Choose another name, or delete that one first.`, 409);
    }

    const id = randomUUID();
    const pack = await db.samplePack.create({
      data: {
        id, name, notes: input.notes?.trim() || null,
        scope: scopeKey([...DATA_BUCKETS]),
        storageKey: `${PACK_PREFIX}${id}.sckools`,
        sourceSchoolId: school.id, sourceSchoolName: school.name,
        createdBy: actor, status: 'BUILDING',
      },
    });
    try {
      await this.backups.startPackBuild(school.id, pack.id, pack.storageKey, actor);
    } catch (e) {
      await db.samplePack.delete({ where: { id: pack.id } }).catch(() => undefined);
      throw e;
    }
    return this.get(pack.id);
  }

  /** Called by the backup job when a PACK build reaches READY — or fails. */
  async settleBuild(backupId: string): Promise<void> {
    const db = getPlatformPrisma();
    const b = await db.schoolBackup.findUnique({ where: { id: backupId } });
    if (!b?.packId) return;
    const m = b.manifest as unknown as Manifest | null;
    if (b.status === 'READY') {
      await db.samplePack.update({
        where: { id: b.packId },
        data: {
          status: 'READY', error: null,
          sizeBytes: b.sizeBytes, rowCount: b.rowCount, fileCount: b.fileCount,
          manifest: (m ?? null) as unknown as Prisma.InputJsonValue,
        },
      });
      this.logger.log(`sample pack ${b.packId} built: ${b.rowCount} rows`);
      return;
    }
    if (b.status === 'FAILED') {
      await db.samplePack.update({
        where: { id: b.packId },
        data: { status: 'FAILED', error: (b.error ?? 'The pack could not be built.').slice(0, 1000) },
      });
    }
  }

  /**
   * Moves a building pack along: one step of its export job, then settle if it
   * has finished. The console calls this while it polls, and the cron calls
   * `settlePending` — so a pack finishes whether or not anyone is watching.
   */
  async advance(id: string): Promise<PackView> {
    const db = getPlatformPrisma();
    const job = await db.schoolBackup.findFirst({ where: { packId: id }, orderBy: { createdAt: 'desc' } });
    if (!job) return this.get(id);
    const after = job.status === 'RUNNING' ? await this.rt().step(job.id) : { status: job.status };
    if (after.status !== 'RUNNING') await this.settleBuild(job.id);
    return this.get(id);
  }

  /**
   * Packs whose job finished while nobody was looking. Self-healing on purpose:
   * the alternative is a pack stuck at BUILDING forever with a perfectly good
   * archive sitting behind it.
   */
  async settlePending(): Promise<number> {
    const db = getPlatformPrisma();
    const packs = await db.samplePack.findMany({ where: { status: 'BUILDING' }, take: 50 });
    let settled = 0;
    for (const p of packs) {
      const job = await db.schoolBackup.findFirst({ where: { packId: p.id }, orderBy: { createdAt: 'desc' } });
      if (!job) {
        await db.samplePack.update({ where: { id: p.id }, data: { status: 'FAILED', error: 'The export job for this pack is gone. Build it again.' } });
        settled += 1;
        continue;
      }
      if (job.status === 'RUNNING') continue;
      await this.settleBuild(job.id);
      settled += 1;
    }
    return settled;
  }

  /* ── a pack made somewhere else ───────────────────────────────────────── */

  async uploadUrl(): Promise<{ key: string; url: string; expiresInSeconds: number }> {
    this.rt().password();
    const key = `${UPLOAD_PREFIX}${randomUUID()}.sckools`;
    const url = await getSignedUrl(
      this.rt().s3,
      new PutObjectCommand({ Bucket: this.rt().bucket, Key: key, ContentType: 'application/octet-stream' }),
      { expiresIn: 900 },
    );
    return { key, url, expiresInSeconds: 900 };
  }

  /** Checks an uploaded file really is a management-data archive, then lists it. */
  async registerUpload(input: { key: string; name: string; notes?: string | null }, actor: string | null): Promise<PackView> {
    const db = getPlatformPrisma();
    const name = this.checkName(input.name);
    if (!new RegExp(`^${UPLOAD_PREFIX}[0-9a-f-]{36}\\.sckools$`).test(input.key)) {
      throw new ApiError('VALIDATION', 'That is not an upload this server issued.', 400);
    }
    if (await db.samplePack.findUnique({ where: { name } })) {
      throw new ApiError('PACK_NAME_TAKEN', `There is already a pack called "${name}".`, 409);
    }
    const drop = async () => {
      await this.rt().s3.send(new DeleteObjectCommand({ Bucket: this.rt().bucket, Key: input.key })).catch(() => undefined);
    };
    let reader;
    try {
      reader = await (await import('./engine/archive')).ArchiveReader.open<Manifest>(
        new S3Source(this.rt().s3, this.rt().bucket, input.key), this.rt().password(),
      );
    } catch (e) {
      if (e instanceof ArchiveError) {
        await drop();
        throw new ApiError('VALIDATION', e.code === 'WRONG_PASSWORD'
          ? 'This file is locked with a different backup password, so it cannot be opened here.'
          : e.message, 400);
      }
      if ((e as { name?: string }).name === 'NotFound' || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        throw new ApiError('NOT_FOUND', 'The upload did not arrive. Try again.', 404);
      }
      throw e;
    }
    const m = reader.manifest;
    if (m?.kind !== BACKUP_KIND) {
      await drop();
      throw new ApiError('VALIDATION', 'That file is not a Sckools backup.', 400);
    }
    const wanted = scopeKey([...DATA_BUCKETS]);
    if (!m.scope || scopeKey(m.scope) !== wanted) {
      await drop();
      throw new ApiError('VALIDATION', m.scope
        ? `A sample pack holds a school's ${wanted.replace(',', ' and ')}. This file holds its ${m.scope.join(' and ')}.`
        : 'That is a whole-school backup, not a sample pack. Restore it as a school, or cut a pack from a school instead.', 400);
    }
    const pack = await db.samplePack.create({
      data: {
        name, notes: input.notes?.trim() || null, scope: wanted, storageKey: input.key,
        sizeBytes: BigInt(reader.bytes), rowCount: m.rowCount, fileCount: m.fileCount,
        manifest: m as unknown as Prisma.InputJsonValue,
        sourceSchoolId: m.source.schoolId, sourceSchoolName: m.source.name,
        createdBy: actor, status: 'READY',
      },
    });
    return this.view(pack);
  }

  /* ── housekeeping ─────────────────────────────────────────────────────── */

  async rename(id: string, input: { name?: string; notes?: string | null }): Promise<PackView> {
    const db = getPlatformPrisma();
    const data: Prisma.SamplePackUpdateInput = {};
    if (input.name !== undefined) data.name = this.checkName(input.name);
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    try {
      await db.samplePack.update({ where: { id }, data });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw new ApiError('PACK_NAME_TAKEN', 'There is already a pack with that name.', 409);
      if ((e as { code?: string }).code === 'P2025') throw new ApiError('NOT_FOUND', 'No such sample pack.', 404);
      throw e;
    }
    return this.get(id);
  }

  async downloadUrl(id: string): Promise<{ url: string; fileName: string; expiresInSeconds: number }> {
    const p = await getPlatformPrisma().samplePack.findUnique({ where: { id } });
    if (!p || p.status !== 'READY') throw new ApiError('NOT_FOUND', 'That pack is not ready to download.', 404);
    const safe = p.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').toLowerCase();
    return {
      url: await this.rt().presignedGet(p.storageKey, 300),
      fileName: `${safe}.sckools`,
      expiresInSeconds: 300,
    };
  }

  /** Removes a pack and its file. The schools it was loaded into are untouched. */
  async remove(id: string): Promise<{ ok: true }> {
    const db = getPlatformPrisma();
    const p = await db.samplePack.findUnique({ where: { id } });
    if (!p) throw new ApiError('NOT_FOUND', 'No such sample pack.', 404);
    const building = await db.schoolBackup.findFirst({ where: { packId: id, status: 'RUNNING' } });
    if (building) throw new ApiError('PACK_BUILDING', 'This pack is still being built. Wait for it to finish, then delete it.', 409);
    await db.schoolBackup.deleteMany({ where: { packId: id } });
    await db.samplePack.delete({ where: { id } });
    await this.rt().s3.send(new DeleteObjectCommand({ Bucket: this.rt().bucket, Key: p.storageKey }))
      .catch((e) => this.logger.warn(`could not remove ${p.storageKey}: ${(e as Error).message}`));
    return { ok: true };
  }

  /** Counts a load, so the library can say which packs are actually used. */
  async noteLoaded(id: string): Promise<void> {
    await getPlatformPrisma().samplePack
      .update({ where: { id }, data: { loadCount: { increment: 1 }, lastLoadedAt: new Date() } })
      .catch(() => undefined);
  }

  /** What a pack must never carry, for the library page to explain itself. */
  excluded(): { model: string; why: string }[] {
    return Object.entries(PACK_EXCLUDED_MODELS).map(([model, why]) => ({ model, why }));
  }
}

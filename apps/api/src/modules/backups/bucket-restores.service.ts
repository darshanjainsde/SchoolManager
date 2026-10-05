import { Injectable, Logger } from '@nestjs/common';
import { Prisma, getPlatformPrisma } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { BackupsService } from './backups.service';
import { parseScope, scopeKey } from './bucket-retention';
import { ArchiveReader } from './engine/archive';
import {
  BucketImportDeps, BucketImportMode, BucketImportState, BucketPreflight,
  beginBucketImport, preflightBucketImport, runBucketImport,
} from './engine/bucket-import';
import { Bucket, DATA_BUCKETS } from './engine/buckets';
import { Manifest } from './engine/export';
import { ImportFailed, ImportRefused } from './engine/import';
import { purgeBucketRows } from './engine/purge';
import { ScopedPlan, expandScope, keptPointers, scopePlan } from './engine/scoped-plan';

const STEP_MS = 40_000;
const MAX_ATTEMPTS = 5;
/** How long a restore waits for another backup of the same buckets to release the running-job slot. */
const WAIT_FOR_SLOT_MS = 30 * 60_000;

/** What a job is doing. A reset stops at `purge`; a restore carries on. */
type Phase = 'starting' | 'awaiting-backup' | 'purge' | 'import' | 'rollback' | 'done';

type Mode = 'BUCKET_REPLACE' | 'BUCKET_MERGE' | 'RESET';

interface JobState {
  phase: Phase;
  buckets: Bucket[];
  mode: BucketImportMode;
  /** The safety snapshot of exactly what is being replaced. */
  preBackupId?: string;
  previousStatus?: string;
  packId?: string | null;
  shiftDates?: boolean;
  import: BucketImportState | null;
  /** Set while putting the safety snapshot back after a failure. */
  rollbackOf?: string;
  progress: number;
  attempts?: number;
}

export interface BucketRestoreView {
  id: string;
  schoolId: string;
  mode: string;
  scope: Bucket[] | null;
  packId: string | null;
  status: string;
  phase: Phase | null;
  progress: number;
  preBackupId: string | null;
  report: unknown;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface BucketRestoreRequest {
  schoolId: string;
  /** Exactly one source. `reset` empties the buckets and puts nothing back. */
  backupId?: string;
  packId?: string;
  reset?: boolean;
  /** What was asked for; widened to a closed scope before anything happens. */
  buckets: Bucket[];
  /** Shift a pack's dates so it reads as the current session. */
  shiftDates?: boolean;
}

/**
 * PUTTING BUCKETS BACK, EMPTYING THEM, OR SWAPPING THEM FOR A SAMPLE PACK.
 *
 * All three are the same job with different ends, and all three follow the
 * same order, which is what makes them safe to run on a school in use:
 *
 *   1. suspend the school, so nothing writes into a bucket being replaced
 *      (the fee-ledger and certificate registers also refuse a delete unless
 *      it is suspended, so this is not merely good manners);
 *   2. take a safety snapshot of EXACTLY the buckets that are about to change,
 *      and wait for it to be readable;
 *   3. empty those buckets and put the new rows in;
 *   4. put the school's status back.
 *
 * If step 3 fails halfway, the job puts the safety snapshot back by itself
 * rather than leaving a half-swapped school behind, and only reports failure if
 * that also fails. The school stays suspended until it is whole either way.
 */
@Injectable()
export class BucketRestoresService {
  private readonly logger = new Logger(BucketRestoresService.name);

  constructor(private readonly backups: BackupsService) {}

  private rt() { return this.backups.runtime(); }

  /**
   * The plan for a request. A REPLACE is widened to a scope that is safe to
   * empty — asking for `setup` takes `day` with it, because 42 required links
   * hang off the roster — and the answer says what it was widened to. A MERGE
   * empties nothing, so it is taken exactly as asked.
   */
  private planFor(buckets: Bucket[], mode: BucketImportMode): ScopedPlan {
    if (buckets.length === 0) throw new ApiError('VALIDATION', 'Name at least one bucket.', 400);
    const wanted = mode === 'replace' ? expandScope(this.rt().plan, buckets) : buckets;
    return scopePlan(this.rt().plan, wanted);
  }

  /**
   * The `school` bucket is never emptied: its admin logins cannot go without
   * taking their complaints and notifications with them, which `expandScope`
   * reports by widening a request for `school` to include `day`. So it is put
   * back by key instead — rows in the snapshot are written over whatever is
   * there, and nothing is deleted.
   */
  private modeFor(buckets: Bucket[]): BucketImportMode {
    return buckets.length === 1 && buckets[0] === 'school' ? 'merge' : 'replace';
  }

  private view(r: {
    id: string; sourceSchoolId: string; mode: string; scope: string | null; packId: string | null;
    status: string; state: unknown; report: unknown; error: string | null; createdAt: Date; finishedAt: Date | null;
  }): BucketRestoreView {
    const st = r.state as JobState | null;
    return {
      id: r.id, schoolId: r.sourceSchoolId, mode: r.mode, scope: parseScope(r.scope), packId: r.packId,
      status: r.status, phase: st?.phase ?? null,
      progress: r.status === 'DONE' ? 1 : (st?.progress ?? 0),
      preBackupId: st?.preBackupId ?? null,
      report: r.report, error: r.error, createdAt: r.createdAt, finishedAt: r.finishedAt,
    };
  }

  async get(id: string): Promise<BucketRestoreView> {
    const r = await getPlatformPrisma().schoolRestore.findUnique({ where: { id } });
    if (!r) throw new ApiError('NOT_FOUND', 'No such restore.', 404);
    return this.view(r);
  }

  async list(schoolId: string): Promise<BucketRestoreView[]> {
    const rows = await getPlatformPrisma().schoolRestore.findMany({
      where: { sourceSchoolId: schoolId, scope: { not: null } },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
    return rows.map((r) => this.view(r));
  }

  /* ── reading the source ───────────────────────────────────────────────── */

  private async source(req: BucketRestoreRequest): Promise<{ reader: ArchiveReader<Manifest>; label: string } | null> {
    if (req.reset) return null;
    const db = getPlatformPrisma();
    if (req.packId) {
      const pack = await db.samplePack.findUnique({ where: { id: req.packId } });
      if (!pack) throw new ApiError('NOT_FOUND', 'No such sample pack.', 404);
      return { reader: await this.rt().reader(pack.storageKey), label: `sample pack "${pack.name}"` };
    }
    if (req.backupId) {
      const b = await db.schoolBackup.findUnique({ where: { id: req.backupId } });
      if (!b || b.status !== 'READY') throw new ApiError('NOT_FOUND', 'That backup is not ready.', 404);
      if (b.sourceSchoolId !== req.schoolId) {
        throw new ApiError('VALIDATION', 'That backup belongs to another school. Save it as a sample pack to load it here.', 400);
      }
      return { reader: await this.rt().reader(b.storageKey), label: 'this school’s own snapshot' };
    }
    throw new ApiError('VALIDATION', 'Choose a snapshot, a sample pack, or a reset.', 400);
  }

  /* ── preflight ────────────────────────────────────────────────────────── */

  /** Read-only: exactly what would change, before anything is touched. */
  async preflight(req: BucketRestoreRequest): Promise<BucketPreflight & { label: string; widenedTo: Bucket[] }> {
    const mode = this.modeFor(req.buckets);
    const plan = this.planFor(req.buckets, mode);
    const widenedTo = plan.buckets.filter((b) => !req.buckets.includes(b));
    const src = await this.source(req);
    const deps = { ...this.rt().deps(plan), plan };
    if (!src) {
      // A reset puts nothing back, so there is no archive to read: report the
      // same shape with an empty snapshot so one dialog can show either.
      const tables: BucketPreflight['tables'] = [];
      let currentRows = 0;
      for (const t of plan.insertOrder) {
        const [{ n }] = await deps.db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM "${t.table}" t WHERE t."schoolId" = $1::uuid${plan.where(t.model) ? ` AND (${plan.where(t.model)})` : ''}`,
          req.schoolId,
        );
        currentRows += n;
        if (n) tables.push({ table: t.table, snapshot: 0, current: n });
      }
      return {
        buckets: plan.buckets, widenedTo,
        mode, takenAt: new Date().toISOString(),
        snapshotRows: 0, currentRows, tables,
        pointers: keptPointers(plan.full, plan.buckets).length,
        fromAnotherSchool: false, shiftWeeks: 0, filesInArchive: 0,
        warnings: [], label: 'nothing — the buckets are emptied',
      };
    }
    try {
      const pre = await preflightBucketImport(deps, src.reader, {
        schoolId: req.schoolId, mode,
        rehome: req.packId ? { shiftDates: req.shiftDates !== false } : undefined,
      });
      return { ...pre, label: src.label, widenedTo };
    } catch (e) {
      if (e instanceof ImportRefused) throw new ApiError('RESTORE_REFUSED', e.message, 409);
      throw e;
    }
  }

  /* ── running it ───────────────────────────────────────────────────────── */

  async start(req: BucketRestoreRequest, actor: string | null): Promise<BucketRestoreView> {
    const db = getPlatformPrisma();
    const mode = this.modeFor(req.buckets);
    const plan = this.planFor(req.buckets, mode);
    const school = await db.school.findUnique({ where: { id: req.schoolId }, select: { status: true, slug: true } });
    if (!school) throw new ApiError('NOT_FOUND', 'No such school.', 404);
    // Decided before anything moves: a refusal here leaves the school alone.
    await this.preflight(req);

    const dbMode: Mode = req.reset ? 'RESET' : (mode === 'replace' ? 'BUCKET_REPLACE' : 'BUCKET_MERGE');

    // THE INTENT IS WRITTEN FIRST, and nothing else happens here. Suspending the
    // school and taking the safety copy are the job's first STEP, so a request
    // that dies right after this line leaves a row any instance can pick up and
    // carry on — rather than a school suspended by a request nobody remembers.
    // The unique index (one running restore per school) is also what stops two
    // clicks racing: the second fails here, before it has touched anything.
    const state: JobState = {
      phase: 'starting',
      buckets: plan.buckets,
      mode,
      previousStatus: school.status,
      packId: req.packId ?? null,
      shiftDates: req.shiftDates !== false,
      import: null,
      progress: 0,
    };
    try {
      const r = await db.schoolRestore.create({
        data: {
          sourceSchoolId: req.schoolId,
          backupId: req.backupId ?? null,
          packId: req.packId ?? null,
          scope: scopeKey(plan.buckets),
          targetSlug: school.slug,
          mode: dbMode,
          finalStatus: school.status,
          createdBy: actor,
          state: state as unknown as Prisma.InputJsonValue,
        },
      });
      return this.view(r);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ApiError('RESTORE_RUNNING', 'Something is already being put back into this school. Wait for it to finish.', 409);
      }
      throw e;
    }
  }

  async step(id: string): Promise<BucketRestoreView> {
    const db = getPlatformPrisma();
    if (!(await this.rt().lease('schoolRestore', id))) return this.get(id);
    const r = await db.schoolRestore.findUniqueOrThrow({ where: { id } });
    const st = r.state as unknown as JobState;
    if (!st || st.phase === 'done') return this.get(id);
    const plan = scopePlan(this.rt().plan, st.buckets);
    const deps = { ...this.rt().deps(plan), plan };

    const save = async (next: JobState) =>
      db.schoolRestore.update({ where: { id }, data: { state: next as unknown as Prisma.InputJsonValue, lockedUntil: null } });
    const finish = async (report: unknown) => {
      // The school is opened BEFORE the job is marked done. Marking done first
      // would leave a window where an instance dying right after it leaves the
      // school suspended behind a job that says it is finished.
      await this.restoreStatus(r.sourceSchoolId, st.previousStatus);
      await db.schoolRestore.update({
        where: { id },
        data: { status: 'DONE', report: report as Prisma.InputJsonValue, state: Prisma.DbNull, lockedUntil: null, finishedAt: new Date() },
      });
      return this.get(id);
    };
    const fail = async (msg: string, leaveSuspended: boolean) => {
      if (!leaveSuspended) await this.restoreStatus(r.sourceSchoolId, st.previousStatus);
      await db.schoolRestore.update({
        where: { id },
        data: { status: 'FAILED', error: msg.slice(0, 2000), lockedUntil: null, finishedAt: new Date() },
      });
      return this.get(id);
    };

    const attempts = (st.attempts ?? 0) + 1;
    if (attempts > MAX_ATTEMPTS) {
      return fail(`Stopped after ${MAX_ATTEMPTS} tries in a row that were cut off before finishing. The school is left suspended and its data as it stands; put snapshot ${st.preBackupId} back to return it to how it was.`, true);
    }

    try {
      if (st.phase === 'starting') {
        // Freeze the school, then take the copy of exactly what is about to
        // change. Both are idempotent, so a retry after a cut-off step is safe.
        await db.school.update({ where: { id: r.sourceSchoolId }, data: { status: 'SUSPENDED', statusChangedAt: new Date() } });
        await this.rt().forgetSchool(r.sourceSchoolId);
        const scope = scopeKey(st.buckets);
        let pre: { id: string } | null = await db.schoolBackup.findFirst({
          where: { sourceSchoolId: r.sourceSchoolId, reason: 'BEFORE_RESET', scope, createdAt: { gte: r.createdAt } },
          orderBy: { createdAt: 'desc' }, select: { id: true },
        });
        if (!pre) {
          try {
            pre = await this.rt().start(r.sourceSchoolId, 'BEFORE_RESET', r.createdBy, { scope: st.buckets });
          } catch (e) {
            // A nightly snapshot of the same buckets holds the one running-job
            // slot. That is the ordinary case at 3 AM, not an error: wait for it.
            if (e instanceof ApiError && (e.getResponse() as { code?: string }).code === 'BACKUP_RUNNING' && Date.now() - r.createdAt.getTime() < WAIT_FOR_SLOT_MS) {
              await save({ ...st, attempts: 0 });
              return this.get(id);
            }
            throw e;
          }
        }
        await save({ ...st, phase: 'awaiting-backup', preBackupId: pre.id, attempts: 0 });
        return this.get(id);
      }

      if (st.phase === 'awaiting-backup') {
        const pre = await this.rt().step(st.preBackupId!);
        if (pre.status === 'RUNNING') {
          // Waiting on the copy is progress, not a cut-off step: resetting the
          // counter is what lets a big school's copy take as many steps as it needs.
          // Back off for two seconds, recorded in the lease column so that no
          // worker re-checks a copy that is still being written.
          await db.schoolRestore.update({
            where: { id },
            data: {
              state: { ...st, attempts: 0, progress: 0.3 * pre.progress } as unknown as Prisma.InputJsonValue,
              lockedUntil: new Date(Date.now() + 2_000),
            },
          });
          return this.get(id);
        }
        if (pre.status !== 'READY') {
          return fail(`The data being replaced could not be backed up first (${pre.error ?? 'unknown error'}), so nothing was changed. The school is back as it was.`, false);
        }
        if (r.mode === 'RESET') {
          await purgeBucketRows(deps.db, plan, r.sourceSchoolId);
          await this.rt().forgetSchool(r.sourceSchoolId);
          return finish({
            buckets: st.buckets, mode: 'reset', emptied: true,
            note: 'The buckets were emptied. Nothing was put back, and no file was deleted.',
            preBackupId: st.preBackupId,
          });
        }
        const imp = await this.beginImport(deps, r, st);
        await save({ ...st, phase: 'import', import: imp, progress: 0.3, attempts: 0 });
        return this.get(id);
      }

      if (st.phase === 'import' || st.phase === 'rollback') {
        const reader = await this.readerFor(r, st);
        const res = await runBucketImport(deps, reader, st.import!, { deadline: Date.now() + STEP_MS });
        if (!res.done) {
          const base = 0.3;
          const s = res.state;
          const prog = base + (1 - base) * (s.phase === 'rows' ? 0.85 * (s.table / Math.max(1, plan.insertOrder.length)) : 0.9);
          await save({ ...st, import: s, progress: prog, attempts: 0 });
          return this.get(id);
        }
        await this.rt().forgetSchool(r.sourceSchoolId);
        if (st.phase === 'rollback') {
          return fail(`${r.error ?? 'The restore failed'} — the school was put back as it was from snapshot ${st.preBackupId}.`, false);
        }
        return finish(res.report);
      }

      return this.get(id);
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof ImportRefused || e instanceof ImportFailed ? e.message : (e as Error).message;
      this.logger.error(`bucket restore ${id} failed in ${st.phase}: ${msg}`);
      // How far the import got is read from the state the FAILURE carries. The
      // saved copy predates this step, and the emptying happens inside the very
      // step that fails: judging by the saved copy would call a half-replaced
      // school "unchanged".
      const reached = e instanceof ImportFailed ? (e.state as unknown as BucketImportState) : st.import;
      const emptied = !!reached?.purged;
      // Half-replaced is the one state nobody can work with, so the job puts
      // the safety snapshot back itself rather than reporting and walking away.
      if (st.phase === 'import' && st.preBackupId && emptied) {
        try {
          await db.schoolRestore.update({ where: { id }, data: { error: msg.slice(0, 1500) } });
          const back = await this.beginRollback(deps, r, st);
          await save({ ...st, phase: 'rollback', import: back, rollbackOf: st.preBackupId, progress: 0.5, attempts: 0 });
          this.logger.warn(`bucket restore ${id}: putting snapshot ${st.preBackupId} back`);
          return this.get(id);
        } catch (re) {
          this.logger.error(`bucket restore ${id}: could not start putting it back: ${(re as Error).message}`);
          return fail(`${msg} — and the data could not be put back automatically. The school is suspended; put snapshot ${st.preBackupId} back from its Backups tab.`, true);
        }
      }
      return fail(emptied
        ? `${msg} — the school is suspended; put snapshot ${st.preBackupId} back from its Backups tab.`
        : `${msg} — nothing was changed.`, emptied);
    }
  }

  private async readerFor(r: { backupId: string | null; packId: string | null }, st: JobState): Promise<ArchiveReader<Manifest>> {
    const db = getPlatformPrisma();
    const key = st.phase === 'rollback'
      ? (await db.schoolBackup.findUniqueOrThrow({ where: { id: st.preBackupId! } })).storageKey
      : st.packId
        ? (await db.samplePack.findUniqueOrThrow({ where: { id: st.packId } })).storageKey
        : (await db.schoolBackup.findUniqueOrThrow({ where: { id: r.backupId! } })).storageKey;
    return this.rt().reader(key);
  }

  private async beginImport(
    deps: BucketImportDeps,
    r: { backupId: string | null; packId: string | null; sourceSchoolId: string },
    st: JobState,
  ): Promise<BucketImportState> {
    const reader = await this.readerFor(r, st);
    const options = {
      schoolId: r.sourceSchoolId,
      mode: st.mode,
      rehome: st.packId ? { shiftDates: st.shiftDates !== false } : undefined,
    };
    const pre = await preflightBucketImport(deps, reader, options);
    return beginBucketImport(deps, reader, options, pre);
  }

  /** The same thing, aimed at the safety snapshot, after a failure. */
  private async beginRollback(
    deps: BucketImportDeps,
    r: { backupId: string | null; packId: string | null; sourceSchoolId: string },
    st: JobState,
  ): Promise<BucketImportState> {
    const back: JobState = { ...st, phase: 'rollback', packId: null, shiftDates: false };
    const reader = await this.readerFor(r, back);
    const options = { schoolId: r.sourceSchoolId, mode: 'replace' as BucketImportMode };
    const pre = await preflightBucketImport(deps, reader, options);
    return beginBucketImport(deps, reader, options, pre);
  }

  private async restoreStatus(schoolId: string, previous: string | undefined): Promise<void> {
    if (!previous) return;
    await getPlatformPrisma().school.update({
      where: { id: schoolId },
      data: { status: previous as never, statusChangedAt: new Date() },
    });
    await this.rt().forgetSchool(schoolId);
  }

  /**
   * Steps ONE scoped restore that no instance is holding, if there is one.
   * Returns whether it did anything. The cron's single loop calls this beside
   * the backup and whole-school-restore steppers, so all three kinds of job
   * share one time budget instead of each assuming it owns the invocation.
   */
  async stepNext(): Promise<boolean> {
    const db = getPlatformPrisma();
    const now = new Date();
    const next = await db.schoolRestore.findFirst({
      where: { status: 'RUNNING', scope: { not: null }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      orderBy: { createdAt: 'asc' }, select: { id: true },
    });
    if (!next) return false;
    await this.step(next.id);
    return true;
  }

  /** "Reset management data" — empty `setup` and `day`, keep the website. */
  resetManagementData(schoolId: string, actor: string | null): Promise<BucketRestoreView> {
    return this.start({ schoolId, reset: true, buckets: [...DATA_BUCKETS] }, actor);
  }
}

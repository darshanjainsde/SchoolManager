import { Prisma, getPlatformPrisma } from '@skoolos/db';
import { Bucket } from './engine/buckets';
import { Manifest } from './engine/export';

/**
 * WHAT HAPPENS TO A BUCKET SNAPSHOT THE MOMENT IT IS READY.
 *
 * "Back up the settings whenever they change" normally means hooking every
 * write. This does it the other way round: a snapshot is taken on a schedule
 * and then THROWN AWAY when it turns out to hold nothing new. The archive
 * fingerprints its own uncompressed content, so the ordered hash of a bucket's
 * entries IS its version — same hash as the newest one kept, and the new file
 * is dropped and the old row stamped as still current.
 *
 * The write path is never touched, which is the point: no Prisma middleware, no
 * trigger, nothing to go wrong on a request a school is waiting for.
 *
 * How many versions each bucket keeps is a judgement about what a person would
 * ever want back. Settings and the website change rarely and weigh almost
 * nothing, so ten of them cost nothing. `day` is taken every night, and a month
 * is as far back as anyone has ever asked to go.
 */
export const KEEP_VERSIONS: Record<Bucket, number> = {
  school: 10,
  website: 10,
  setup: 10,
  day: 30,
};

export const scopeKey = (buckets: readonly Bucket[]): string => buckets.join(',');

export const parseScope = (scope: string | null | undefined): Bucket[] | null =>
  (scope ? (scope.split(',').filter(Boolean) as Bucket[]) : null);

/** The bucket a snapshot's retention is counted by — the last, widest one. */
export const retentionBucket = (buckets: readonly Bucket[]): Bucket => buckets[buckets.length - 1];

export interface SettleResult {
  /** True when the snapshot held nothing new and was dropped. */
  unchanged: boolean;
  /** The version number this bucket is now at. */
  version: number;
  /** How many older versions were pruned. */
  pruned: number;
  /** The row that is now the current version of this bucket. */
  currentId: string;
}

/**
 * Called once, when a SNAPSHOT backup reaches READY.
 *
 * `expire` removes a kept row's file; it is passed in rather than imported so
 * this stays testable without storage, and so the one place that deletes a
 * backup object remains the service's own.
 */
export async function settleSnapshot(
  backupId: string,
  expire: (id: string, storageKey: string) => Promise<void>,
): Promise<SettleResult | null> {
  const db = getPlatformPrisma();
  const b = await db.schoolBackup.findUnique({ where: { id: backupId } });
  if (!b || b.status !== 'READY' || !b.scope) return null;
  const manifest = b.manifest as unknown as Manifest | null;
  const hash = b.contentHash ?? manifest?.contentHash ?? null;

  const previous = await db.schoolBackup.findFirst({
    where: {
      sourceSchoolId: b.sourceSchoolId, scope: b.scope, reason: 'SNAPSHOT', status: 'READY',
      id: { not: b.id },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Nothing new: keep the version that is already there, and record that it was
  // checked just now — so the console can say "saved 9 days ago, checked today"
  // rather than inventing a version a day for a website nobody edited.
  if (hash && previous && previous.contentHash === hash) {
    await db.schoolBackup.update({ where: { id: previous.id }, data: { lastCheckedAt: new Date() } });
    await expire(b.id, b.storageKey);
    return { unchanged: true, version: previous.version ?? 1, pruned: 0, currentId: previous.id };
  }

  const version = (previous?.version ?? 0) + 1;
  await db.schoolBackup.update({
    where: { id: b.id },
    data: { version, contentHash: hash, lastCheckedAt: new Date() },
  });

  const buckets = parseScope(b.scope)!;
  const keep = KEEP_VERSIONS[retentionBucket(buckets)] ?? 10;
  const old = await db.schoolBackup.findMany({
    where: { sourceSchoolId: b.sourceSchoolId, scope: b.scope, reason: 'SNAPSHOT', status: 'READY' },
    orderBy: { createdAt: 'desc' },
    skip: keep,
  });
  for (const o of old) await expire(o.id, o.storageKey);
  return { unchanged: false, version, pruned: old.length, currentId: b.id };
}

/** One bucket's standing, as the console shows it. */
export interface BucketStanding {
  bucket: Bucket;
  scope: string;
  kept: boolean;
  /** The current version, if this bucket has ever been saved. */
  currentId: string | null;
  version: number | null;
  savedAt: Date | null;
  checkedAt: Date | null;
  rowCount: number | null;
  fileCount: number | null;
  sizeBytes: number | null;
  /** How many versions are on the shelf, and how many it keeps. */
  versions: number;
  keeps: number;
  /** A snapshot of this bucket running right now. */
  runningId: string | null;
  runningProgress: number;
}

export async function bucketStandings(schoolId: string, kept: readonly Bucket[], all: readonly Bucket[]): Promise<BucketStanding[]> {
  const db = getPlatformPrisma();
  const rows = await db.schoolBackup.findMany({
    where: { sourceSchoolId: schoolId, reason: 'SNAPSHOT', scope: { not: null } },
    orderBy: { createdAt: 'desc' },
  });
  const running = await db.schoolBackup.findMany({
    where: { sourceSchoolId: schoolId, status: 'RUNNING', scope: { not: null } },
  });
  return all.map((bucket) => {
    const scope = scopeKey([bucket]);
    const mine = rows.filter((r) => r.scope === scope && r.status === 'READY');
    const current = mine[0] ?? null;
    const job = running.find((r) => r.scope === scope) ?? null;
    const state = job?.state as { progress?: number } | null;
    return {
      bucket,
      scope,
      kept: kept.includes(bucket),
      currentId: current?.id ?? null,
      version: current?.version ?? null,
      savedAt: current?.createdAt ?? null,
      checkedAt: current?.lastCheckedAt ?? null,
      rowCount: current?.rowCount ?? null,
      fileCount: current?.fileCount ?? null,
      sizeBytes: current?.sizeBytes == null ? null : Number(current.sizeBytes),
      versions: mine.length,
      keeps: KEEP_VERSIONS[bucket],
      runningId: job?.id ?? null,
      runningProgress: state?.progress ?? 0,
    };
  });
}

/** Marks a snapshot's row so a reader can tell a dropped duplicate from a loss. */
export const UNCHANGED_NOTE = 'Nothing had changed since the version before it, so this copy was not kept.';

export const noteUnchanged = (id: string) =>
  getPlatformPrisma().schoolBackup.update({
    where: { id },
    data: { error: UNCHANGED_NOTE, state: Prisma.DbNull },
  });

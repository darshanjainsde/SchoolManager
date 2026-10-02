'use client';
import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '@/lib/api';

/** One row of the backup register, as GET /owner/schools/:id/backups returns it. */
export interface BackupRow {
  id: string;
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
  reason: 'MANUAL' | 'BEFORE_DELETE' | 'BEFORE_REPLACE' | 'WEEKLY' | 'UPLOADED' | 'SNAPSHOT' | 'BEFORE_RESET' | 'PACK';
  status: 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  progress: number;
  /** The buckets this archive holds, or null for a whole school. */
  scope: Bucket[] | null;
  version: number | null;
  /** When this version was last confirmed as still current. */
  checkedAt: string | null;
  sizeBytes: number | null;
  rowCount: number | null;
  fileCount: number | null;
  warnings: string[];
  error: string | null;
  deleteSchoolAfter: boolean;
  /** READY, but the school it was taken to delete is not gone yet. */
  deletePending: boolean;
  /** A final backup waiting for the suspended school to go quiet. */
  waiting: boolean;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
}

export interface RestoreRow {
  id: string;
  backupId: string | null;
  schoolId: string;
  targetSlug: string;
  mode: 'RESTORE' | 'REPLACE';
  finalStatus: string;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  phase: 'awaiting-backup' | 'import' | null;
  progress: number;
  preBackupId: string | null;
  report: { rows: number; files: number; slug: string; dropped: { table: string; reason: string; rows: number }[]; cleared: { table: string; column: string; rows: number }[]; warnings: string[] } | null;
  error: string | null;
}

export const REASON_LABEL: Record<BackupRow['reason'], string> = {
  MANUAL: 'Taken by hand',
  WEEKLY: 'Weekly',
  BEFORE_DELETE: 'Final, before delete',
  BEFORE_REPLACE: 'Before a restore replaced it',
  UPLOADED: 'Uploaded file',
  SNAPSHOT: 'Nightly',
  BEFORE_RESET: 'Before the data was replaced',
  PACK: 'Cut as a sample pack',
};

export type Bucket = 'school' | 'website' | 'setup' | 'day';

/** One saved scope of a school, as GET /owner/schools/:id/buckets returns it. */
export interface BucketStanding {
  buckets: Bucket[];
  /** The buckets comma-joined — the id used by every bucket route. */
  scope: string;
  label: string;
  holds: string;
  /** True for the half a data operation never touches. */
  kept: boolean;
  currentId: string | null;
  version: number | null;
  savedAt: string | null;
  checkedAt: string | null;
  rowCount: number | null;
  fileCount: number | null;
  sizeBytes: number | null;
  versions: number;
  keeps: number;
  runningId: string | null;
  runningProgress: number;
}

/** What a restore, a reset or a pack load would change — read before it runs. */
export interface BucketPreflight {
  buckets: Bucket[];
  /** Buckets the request had to widen to, because emptying it would strand them. */
  widenedTo: Bucket[];
  mode: 'replace' | 'merge';
  takenAt: string;
  snapshotRows: number;
  currentRows: number;
  tables: { table: string; snapshot: number; current: number }[];
  pointers: number;
  fromAnotherSchool: boolean;
  shiftWeeks: number;
  filesInArchive: number;
  warnings: string[];
  /** Where the rows are coming from, in words. */
  label: string;
}

export interface BucketRestoreRow {
  id: string;
  schoolId: string;
  mode: 'BUCKET_REPLACE' | 'BUCKET_MERGE' | 'RESET';
  scope: Bucket[] | null;
  packId: string | null;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  phase: 'awaiting-backup' | 'purge' | 'import' | 'rollback' | 'done' | null;
  progress: number;
  preBackupId: string | null;
  report: {
    buckets?: Bucket[];
    mode?: string;
    rows?: number;
    files?: number;
    relinked?: number;
    shiftedWeeks?: number;
    emptied?: boolean;
    note?: string;
    dropped?: { table: string; reason: string; rows: number }[];
    cleared?: { table: string; column: string; rows: number }[];
    warnings?: string[];
  } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** One pack in the library, as GET /owner/sample-packs returns it. */
export interface PackRow {
  id: string;
  name: string;
  notes: string | null;
  scope: string;
  status: 'BUILDING' | 'READY' | 'FAILED';
  version: number;
  rowCount: number | null;
  fileCount: number | null;
  sizeBytes: number | null;
  tableCount: number;
  takenAt: string | null;
  sourceSchoolId: string | null;
  sourceSchoolName: string | null;
  loadCount: number;
  lastLoadedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  buildingBackupId: string | null;
  buildProgress: number;
}

/** How long ago, in the words the console uses everywhere else. */
export function agoLabel(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days > 1 ? 's' : ''} ago`;
  return whenLabel(iso);
}

export const sizeLabel = (n: number | null) =>
  n == null ? '—' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Follows one running job. Each poll ADVANCES it a step (the step endpoints
 * are safe to call any number of times — a lease stops two from working at
 * once), so the job moves even where the background continuation is off.
 * Stops polling the moment the job is no longer running.
 */
export function useJob<T extends { status: string }>(
  api: ApiClient,
  kind: 'backups' | 'restores' | 'bucket-restores' | 'sample-packs',
  id: string | null,
) {
  return useQuery({
    queryKey: ['owner-job', kind, id],
    enabled: !!id,
    queryFn: () => api.post<T>(`/owner/${kind}/${id}/step`),
    // A finished backup that still has a delete to finish keeps being followed.
    refetchInterval: (q) => {
      const d = q.state.data as { status: string; deletePending?: boolean; error?: string | null } | undefined;
      if (!d || d.status === 'RUNNING') return 2000;
      return d.deletePending && !d.error ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });
}

/** A presigned link opens the file; the browser saves it under the backup's own name. */
export function openDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

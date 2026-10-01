'use client';
import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '@/lib/api';

/** One row of the backup register, as GET /owner/schools/:id/backups returns it. */
export interface BackupRow {
  id: string;
  schoolId: string;
  schoolSlug: string;
  schoolName: string;
  reason: 'MANUAL' | 'BEFORE_DELETE' | 'BEFORE_REPLACE' | 'WEEKLY' | 'UPLOADED';
  status: 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';
  progress: number;
  sizeBytes: number | null;
  rowCount: number | null;
  fileCount: number | null;
  warnings: string[];
  error: string | null;
  deleteSchoolAfter: boolean;
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
};

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
export function useJob<T extends { status: string }>(api: ApiClient, kind: 'backups' | 'restores', id: string | null) {
  return useQuery({
    queryKey: ['owner-job', kind, id],
    enabled: !!id,
    queryFn: () => api.post<T>(`/owner/${kind}/${id}/step`),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'RUNNING' ? false : 2000),
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

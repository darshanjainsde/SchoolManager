'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useQueryState } from '@/components/ui/query-state';
import { Overlay } from '@/components/ui/kit';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  BackupRow, REASON_LABEL, RestoreRow, openDownload, sizeLabel, useJob, whenLabel,
} from '../../_lib/backups';

/**
 * Every backup of one school: take one, download it, or put the school back
 * to it. A backup is the whole school — every row and every file — locked with
 * the platform backup password, and it outlives the school.
 */
export function BackupsCard({ school }: { school: { id: string; name: string; slug: string } }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const key = ['owner-backups', school.id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<BackupRow[]>(`/owner/schools/${school.id}/backups`) });
  const running = q.data?.find((b) => b.status === 'RUNNING') ?? null;
  const job = useJob<BackupRow>(api, 'backups', running?.id ?? null);
  const [restoring, setRestoring] = useState<BackupRow | null>(null);

  // When the followed job stops running: one toast, one list refresh.
  const finished = running && job.data && job.data.status !== 'RUNNING' ? job.data : null;
  useEffect(() => {
    if (!finished) return;
    if (finished.status === 'READY') toast.success('Backup ready');
    if (finished.status === 'FAILED') toast.error(finished.error ?? 'The backup failed');
    void qc.invalidateQueries({ queryKey: ['owner-backups', school.id] });
  }, [finished?.id, finished?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const take = useMutation({
    mutationFn: () => api.post<BackupRow>(`/owner/schools/${school.id}/backups`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast.error(e.message),
  });
  const download = useMutation({
    mutationFn: (id: string) => api.get<{ url: string }>(`/owner/backups/${id}/download`),
    onSuccess: (d) => openDownload(d.url),
    onError: (e: Error) => toast.error(e.message),
  });

  const gate = useQueryState(q, 'Loading backups…');
  const live = running ? (job.data ?? running) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Backups</CardTitle>
            <CardDescription>
              The whole school — students, marks, fees, logins, website and every file — in one locked file.
              Kept after the school is deleted. Weekly backups run every Sunday at 3 AM.
            </CardDescription>
          </div>
          <Button onClick={() => take.mutate()} disabled={!!running || take.isPending}>
            {take.isPending ? 'Starting…' : 'Take backup'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {gate}
        {live && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900" role="status">
            <div className="flex items-center justify-between gap-3">
              <span>{live.deleteSchoolAfter ? 'Final backup before delete' : 'Backing up'} — {Math.round(live.progress * 100)}%</span>
              <span className="text-xs text-indigo-700">You can leave this page; it carries on.</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded bg-indigo-100">
              <div className="h-1.5 rounded bg-indigo-600 transition-all" style={{ width: `${Math.max(3, live.progress * 100)}%` }} />
            </div>
          </div>
        )}
        {q.data && q.data.length === 0 && <p className="sk-muted">No backups yet. Take one before any big change.</p>}
        {q.data && q.data.length > 0 && (
          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead>
                <tr>
                  <th>Taken</th>
                  <th>Why</th>
                  <th data-priority="2">Size</th>
                  <th data-priority="2">Rows</th>
                  <th>Status</th>
                  <th className="acts">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((b) => (
                  <tr key={b.id}>
                    <td>{whenLabel(b.createdAt)}</td>
                    <td>{REASON_LABEL[b.reason]}</td>
                    <td data-priority="2">{sizeLabel(b.sizeBytes)}</td>
                    <td data-priority="2">{b.rowCount?.toLocaleString('en-IN') ?? '—'}</td>
                    <td data-wrap="true">
                      {b.status === 'READY' && (
                        <span className="text-emerald-700">
                          Ready{b.warnings.length > 0 && <span className="text-amber-700" title={b.warnings.join('\n')}> · {b.warnings.length} note{b.warnings.length > 1 ? 's' : ''}</span>}
                        </span>
                      )}
                      {b.status === 'RUNNING' && <span className="text-indigo-700">Running</span>}
                      {b.status === 'EXPIRED' && <span className="sk-muted">Expired</span>}
                      {b.status === 'FAILED' && <span className="text-rose-700">Failed — {b.error}</span>}
                    </td>
                    <td className="acts">
                      {b.status === 'READY' && (
                        <span className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(b.id)}>Download</Button>
                          <Button size="sm" variant="outline" onClick={() => setRestoring(b)}>Restore</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {restoring && <ReplaceDialog school={school} backup={restoring} onClose={() => setRestoring(null)} />}
    </Card>
  );
}

/** Putting a school that EXISTS back to an earlier backup. */
function ReplaceDialog({ school, backup, onClose }: {
  school: { id: string; name: string; slug: string }; backup: BackupRow; onClose: () => void;
}) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [finalStatus, setFinalStatus] = useState<'LIVE' | 'SUSPENDED'>('LIVE');
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const job = useJob<RestoreRow>(api, 'restores', restoreId);
  const start = useMutation({
    mutationFn: () => api.post<RestoreRow>('/owner/restores', { backupId: backup.id, mode: 'replace', finalStatus }),
    onSuccess: (r) => setRestoreId(r.id),
    onError: (e: Error) => toast.error(e.message),
  });
  const r = job.data;
  const done = r?.status === 'DONE';
  useEffect(() => {
    if (r && r.status !== 'RUNNING') void qc.invalidateQueries({ queryKey: ['owner-backups', school.id] });
  }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Overlay
      side="center"
      title={`Put ${school.name} back to ${whenLabel(backup.createdAt)}`}
      onClose={onClose}
      footer={
        !restoreId ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={confirm.trim() !== school.slug || start.isPending} onClick={() => start.mutate()}>
              {start.isPending ? 'Starting…' : 'Replace current data'}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end"><Button variant="outline" onClick={onClose}>{done ? 'Close' : 'Hide — it carries on'}</Button></div>
        )
      }
    >
      {!restoreId ? (
        <div className="space-y-3 text-sm">
          <p>This happens in order, and stops safely if any step fails:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>The school is paused and backed up <b>as it is now</b> — so nothing is lost.</li>
            <li>The current data and files are removed.</li>
            <li>The backup from {whenLabel(backup.createdAt)} is put in their place ({backup.rowCount?.toLocaleString('en-IN') ?? '?'} rows).</li>
          </ol>
          <p className="sk-muted">Anything added since {whenLabel(backup.createdAt)} will only be in the step-1 backup.</p>
          <div className="space-y-1.5">
            <Label htmlFor="restore-status">After the restore</Label>
            <Select id="restore-status" value={finalStatus} onChange={(e) => setFinalStatus(e.target.value as 'LIVE' | 'SUSPENDED')}>
              <option value="LIVE">Open the school (Live)</option>
              <option value="SUSPENDED">Keep it paused so I can check first</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="restore-confirm">Type <span className="font-mono font-bold">{school.slug}</span> to confirm</Label>
            <Input id="restore-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={school.slug} />
          </div>
        </div>
      ) : (
        <RestoreProgress r={r} />
      )}
    </Overlay>
  );
}

export function RestoreProgress({ r }: { r: RestoreRow | undefined }) {
  if (!r) return <p className="sk-muted">Starting…</p>;
  if (r.status === 'FAILED') return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{r.error}</p>;
  if (r.status === 'DONE' && r.report) {
    return (
      <div className="space-y-2 text-sm" role="status">
        <p className="text-emerald-700">Done — {r.report.rows.toLocaleString('en-IN')} rows and {r.report.files} files are back.</p>
        {r.report.dropped.map((d) => <p key={d.table + d.reason} className="text-amber-800">Not brought back: {d.rows} × {d.table} — {d.reason}</p>)}
        {r.report.cleared.map((c) => <p key={c.table + c.column} className="text-amber-800">Link cleared: {c.rows} × {c.table}.{c.column}</p>)}
        {r.report.warnings.length > 0 && (
          <details><summary className="cursor-pointer text-amber-800">{r.report.warnings.length} note(s)</summary>
            <ul className="mt-1 list-disc pl-5 text-xs">{r.report.warnings.slice(0, 50).map((w) => <li key={w}>{w}</li>)}</ul>
          </details>
        )}
      </div>
    );
  }
  const label = r.phase === 'awaiting-backup' ? 'Backing up the current copy' : 'Bringing the backup back';
  return (
    <div className="space-y-2 text-sm" role="status">
      <p>{label} — {Math.round(r.progress * 100)}%</p>
      <div className="h-1.5 w-full rounded bg-indigo-100"><div className="h-1.5 rounded bg-indigo-600 transition-all" style={{ width: `${Math.max(3, r.progress * 100)}%` }} /></div>
      <p className="sk-muted">You can close this; it carries on.</p>
    </div>
  );
}

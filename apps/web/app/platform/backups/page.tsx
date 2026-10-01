'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { QueryError } from '@/components/ui/query-state';
import { Overlay } from '@/components/ui/kit';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { BackupRow, REASON_LABEL, RestoreRow, openDownload, sizeLabel, useJob, whenLabel } from '../_lib/backups';
import { RestoreProgress } from '../schools/[id]/backups-card';

/**
 * Schools that are gone, and a way to bring any of them back — from a backup
 * this server kept, or from a .sckools file made on any other machine.
 */
export default function BackupsPage() {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const deleted = useQuery({ queryKey: ['owner-deleted-schools'], queryFn: () => api.get<BackupRow[]>('/owner/deleted-schools') });
  const [restoring, setRestoring] = useState<BackupRow | null>(null);
  const download = useMutation({
    mutationFn: (id: string) => api.get<{ url: string }>(`/owner/backups/${id}/download`),
    onSuccess: (d) => openDownload(d.url),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="sk-own-h1">Backups</h1>
        <p className="sk-muted">Every school can be saved as one locked file and brought back on this server or any other.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Deleted schools</CardTitle>
          <CardDescription>Each one with the last backup it left behind. Restore puts the whole school back — people sign in with their old passwords.</CardDescription>
        </CardHeader>
        <CardContent>
          {deleted.error && <QueryError error={deleted.error} onRetry={deleted.refetch} />}
          {!deleted.data && !deleted.error && <p className="sk-own-state">Loading deleted schools…</p>}
          {deleted.data && deleted.data.length === 0 && <p className="sk-muted">No deleted schools. Backups of live schools are on each school’s page.</p>}
          {deleted.data && deleted.data.length > 0 && (
            <div className="sk-tblwrap">
              <table className="sk-tbl">
                <thead>
                  <tr>
                    <th>School</th>
                    <th>Backup</th>
                    <th data-priority="2">Size</th>
                    <th className="acts">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {deleted.data.map((b) => (
                    <tr key={b.id}>
                      <td data-wrap="true">
                        <div className="font-medium">{b.schoolName}</div>
                        <div className="font-mono text-xs sk-muted">{b.schoolSlug}</div>
                      </td>
                      <td data-wrap="true">{whenLabel(b.createdAt)} · {REASON_LABEL[b.reason]}</td>
                      <td data-priority="2">{sizeLabel(b.sizeBytes)}</td>
                      <td className="acts">
                        <span className="flex gap-2">
                          <Button size="sm" variant="outline" disabled={download.isPending} onClick={() => download.mutate(b.id)}>Download</Button>
                          <Button size="sm" onClick={() => setRestoring(b)}>Restore</Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <UploadCard onRegistered={(b) => setRestoring(b)} />

      {restoring && <RestoreDialog backup={restoring} onClose={() => setRestoring(null)} />}
    </div>
  );
}

/** A .sckools file from a laptop, another server, or a download kept somewhere safe. */
function UploadCard({ onRegistered }: { onRegistered: (b: BackupRow) => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'checking'>('idle');

  const upload = useMutation({
    mutationFn: async (f: File) => {
      setStage('uploading');
      const { key, url } = await api.post<{ key: string; url: string }>('/owner/backups/upload-url');
      // Straight to storage — a school's file is far bigger than an API request may be.
      const put = await fetch(url, { method: 'PUT', body: f, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!put.ok) throw new Error(`The file store refused the upload (${put.status}). For a very large file, use the command line: pnpm school import <file>.`);
      setStage('checking');
      return api.post<BackupRow>('/owner/backups/uploaded', { key });
    },
    onSuccess: (b) => {
      setStage('idle');
      setFile(null);
      void qc.invalidateQueries({ queryKey: ['owner-deleted-schools'] });
      void qc.invalidateQueries({ queryKey: ['owner-backups', b.schoolId] });
      toast.success(`${b.schoolName} — backup of ${whenLabel(b.createdAt)} is ready to restore`);
      onRegistered(b);
    },
    onError: (e: Error) => { setStage('idle'); toast.error(e.message); },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import a backup file</CardTitle>
        <CardDescription>
          Any <span className="font-mono">.sckools</span> file locked with this server’s backup password. A file locked with a
          different password can be imported from the command line instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="backup-file">Backup file</Label>
          <Input id="backup-file" type="file" accept=".sckools" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={upload.isPending} />
        </div>
        <Button disabled={!file || upload.isPending} onClick={() => file && upload.mutate(file)}>
          {stage === 'uploading' ? `Uploading ${file ? sizeLabel(file.size) : ''}…` : stage === 'checking' ? 'Checking the file…' : 'Upload and check'}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Bringing a school back that is NOT on this server (deleted, or from elsewhere). */
function RestoreDialog({ backup, onClose }: { backup: BackupRow; onClose: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [slug, setSlug] = useState(backup.schoolSlug);
  const [finalStatus, setFinalStatus] = useState<'LIVE' | 'SUSPENDED'>('LIVE');
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const job = useJob<RestoreRow>(api, 'restores', restoreId);
  const start = useMutation({
    mutationFn: () => api.post<RestoreRow>('/owner/restores', { backupId: backup.id, mode: 'restore', slug: slug.trim(), finalStatus }),
    onSuccess: (r) => setRestoreId(r.id),
    onError: (e: Error) => toast.error(e.message),
  });
  const r = job.data;
  useEffect(() => {
    if (r?.status === 'DONE') {
      void qc.invalidateQueries({ queryKey: ['owner-deleted-schools'] });
      void qc.invalidateQueries({ queryKey: ['owner-schools'] });
    }
  }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const validSlug = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(slug.trim());

  return (
    <Overlay
      side="center"
      title={`Restore ${backup.schoolName}`}
      subtitle={`From the backup of ${whenLabel(backup.createdAt)} · ${backup.rowCount?.toLocaleString('en-IN') ?? '?'} rows · ${backup.fileCount ?? 0} files`}
      onClose={onClose}
      footer={
        !restoreId ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!validSlug || start.isPending} onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : 'Restore school'}</Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            {r?.status === 'DONE' && <Link className="sk-btn sk-press" href={`/platform/schools/${r.schoolId}`}>Open the school</Link>}
            <Button variant="outline" onClick={onClose}>{r?.status === 'DONE' ? 'Close' : 'Hide — it carries on'}</Button>
          </div>
        )
      }
    >
      {!restoreId ? (
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="restore-slug">Address</Label>
            <Input id="restore-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} aria-describedby="restore-slug-hint" />
            <p id="restore-slug-hint" className="sk-muted text-xs">
              {validSlug ? <>The school opens at <span className="font-mono">{slug.trim()}.</span>this server’s address. Change it only if another school has taken it.</> : 'Use 2–32 lowercase letters, digits or dashes.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="restore-final">After the restore</Label>
            <Select id="restore-final" value={finalStatus} onChange={(e) => setFinalStatus(e.target.value as 'LIVE' | 'SUSPENDED')}>
              <option value="LIVE">Open the school (Live)</option>
              <option value="SUSPENDED">Keep it paused so I can check first</option>
            </Select>
          </div>
          <p className="sk-muted">Links, the school’s address and its saved payment and email passwords are fitted to this server. A custom domain comes back as pending — verify it again on the school’s page.</p>
        </div>
      ) : (
        <RestoreProgress r={r} />
      )}
    </Overlay>
  );
}

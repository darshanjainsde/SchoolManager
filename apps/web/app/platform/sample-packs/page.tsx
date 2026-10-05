'use client';
import { useEffect, useRef, useState } from 'react';
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
import { PackRow, agoLabel, openDownload, sizeLabel, useJob, whenLabel } from '../_lib/backups';

interface SchoolOption { id: string; name: string; slug: string }

/**
 * THE SAMPLE-PACK LIBRARY.
 *
 * A pack is one school's management data under a name, ready to drop into any
 * school so a prospect sees their own website with a believable year of data
 * behind the login. Packs live here, not under a school, so deleting the school
 * a pack was cut from never takes the pack with it.
 */
export default function SamplePacksPage() {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-packs'], queryFn: () => api.get<PackRow[]>('/owner/sample-packs') });
  const [cutting, setCutting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<PackRow | null>(null);
  const [removing, setRemoving] = useState<PackRow | null>(null);

  const building = q.data?.find((p) => p.status === 'BUILDING' && p.buildingBackupId) ?? null;
  const job = useJob<PackRow>(api, 'sample-packs', building?.id ?? null);
  useEffect(() => {
    if (job.data && job.data.status !== 'BUILDING') {
      if (job.data.status === 'READY') toast.success(`“${job.data.name}” is ready`);
      if (job.data.status === 'FAILED') toast.error(job.data.error ?? 'The pack could not be built');
      void qc.invalidateQueries({ queryKey: ['owner-packs'] });
    }
  }, [job.data?.id, job.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = useMutation({
    mutationFn: (id: string) => api.get<{ url: string }>(`/owner/sample-packs/${id}/download`),
    onSuccess: (d) => openDownload(d.url),
    onError: (e: Error) => toast.error(e.message),
  });

  const gate = useQueryState(q, 'Loading the library…');
  const packs = q.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Sample packs</CardTitle>
              <CardDescription>
                A pack is a school’s management data — roster, fee heads, attendance, marks, invoices —
                under a name. Load one into any school to show it the product with believable data
                behind the login; its website and its own settings are never touched. Keep as many as
                you like and pick the one that suits the school in front of you.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setUploading(true)}>Upload a pack</Button>
              <Button onClick={() => setCutting(true)}>New pack from a school…</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {gate}
          {q.data && packs.length === 0 && (
            <div className="rounded-lg border border-dashed px-4 py-6 text-center">
              <p className="font-medium">No packs yet</p>
              <p className="sk-muted mx-auto mt-1 max-w-prose text-sm">
                Set one school up exactly as you want a demo to read — classes, fees, a term of
                attendance and marks — then cut a pack from it. That school stays as it is; the pack is
                a copy you can drop into any number of other schools.
              </p>
              <Button className="mt-3" onClick={() => setCutting(true)}>New pack from a school…</Button>
            </div>
          )}
          {packs.length > 0 && (
            <div className="sk-tblwrap">
              <table className="sk-tbl">
                <thead>
                  <tr>
                    <th>Pack</th>
                    <th data-priority="2">Built from</th>
                    <th data-priority="2">Rows</th>
                    <th>Used</th>
                    <th className="acts">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {packs.map((p) => {
                    const live = p.id === building?.id ? (job.data ?? p) : p;
                    return (
                      <tr key={p.id}>
                        <td data-wrap="true">
                          <span className="font-medium">{p.name}</span>
                          {p.notes && <span className="sk-muted block text-xs">{p.notes}</span>}
                          {live.status === 'BUILDING' && (
                            <span className="block text-xs text-indigo-700">
                              Building — {Math.round((live.buildProgress ?? 0) * 100)}%
                            </span>
                          )}
                          {live.status === 'FAILED' && (
                            <span className="block text-xs text-rose-700">Failed — {live.error}</span>
                          )}
                          {live.status === 'READY' && (
                            <span className="sk-muted block text-xs">
                              v{p.version} · {p.tableCount} tables · {sizeLabel(p.sizeBytes)}
                              {p.takenAt && ` · cut ${agoLabel(p.takenAt)}`}
                            </span>
                          )}
                        </td>
                        <td data-priority="2" data-wrap="true">{p.sourceSchoolName ?? '—'}</td>
                        <td data-priority="2">{p.rowCount?.toLocaleString('en-IN') ?? '—'}</td>
                        <td data-wrap="true">
                          {p.loadCount === 0 ? (
                            <span className="sk-muted">Never</span>
                          ) : (
                            <>
                              {p.loadCount} time{p.loadCount > 1 ? 's' : ''}
                              {p.lastLoadedAt && <span className="sk-muted block text-xs">last {agoLabel(p.lastLoadedAt)}</span>}
                            </>
                          )}
                        </td>
                        <td className="acts">
                          <span className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setEditing(p)}>Rename</Button>
                            <Button
                              size="sm" variant="outline"
                              disabled={p.status !== 'READY' || download.isPending}
                              onClick={() => download.mutate(p.id)}
                            >
                              Download
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRemoving(p)}>Delete</Button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="sk-muted text-xs">
            To load a pack, open the school and use <b>Load a sample pack</b> on its Parts card. A pack
            carries no push tokens, guest links or inbound messages, so nothing in it can reach a real
            person outside the demo.
          </p>
        </CardContent>
      </Card>

      {cutting && <CutDialog onClose={() => setCutting(false)} />}
      {uploading && <UploadDialog onClose={() => setUploading(false)} />}
      {editing && <RenameDialog pack={editing} onClose={() => setEditing(null)} />}
      {removing && <DeleteDialog pack={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}

/** Freezing one school's management data under a name. */
function CutDialog({ onClose }: { onClose: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [schoolId, setSchoolId] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const schools = useQuery({
    queryKey: ['owner-schools-brief'],
    queryFn: () => api.get<SchoolOption[]>('/owner/schools'),
  });
  const create = useMutation({
    mutationFn: () => api.post<PackRow>('/owner/sample-packs', { schoolId, name, notes: notes || undefined }),
    onSuccess: () => {
      toast.success('Building the pack…');
      void qc.invalidateQueries({ queryKey: ['owner-packs'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Overlay
      side="center"
      title="New pack from a school"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!schoolId || name.trim().length < 2 || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Starting…' : 'Cut the pack'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Copies that school’s roster, fee heads, catalogue and everything that has happened into a
          named pack. The school itself is not changed in any way, and its website and settings are not
          part of the pack.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="pack-school">School to copy</Label>
          <Select id="pack-school" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            <option value="">Choose a school…</option>
            {(schools.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.slug})</option>)}
          </Select>
          {schools.isError && <p className="text-xs text-rose-700">Could not load the school list.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pack-name">Name</Label>
          <Input id="pack-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CBSE mid-size" />
          <p className="sk-muted text-xs">What you will pick from the list later — say the shape of the school.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pack-notes">Notes (optional)</Label>
          <Input id="pack-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="540 students, Nursery–12, fees + marks + diary" />
        </div>
      </div>
    </Overlay>
  );
}

/** A pack file built on another machine. */
function UploadDialog({ onClose }: { onClose: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const { key, url } = await api.post<{ key: string; url: string }>('/owner/sample-packs/upload-url');
      const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!put.ok) throw new Error(`The upload was refused (${put.status}). Check the bucket’s CORS rules.`);
      await api.post<PackRow>('/owner/sample-packs/uploaded', { key, name, notes: notes || undefined });
      toast.success('Pack added');
      void qc.invalidateQueries({ queryKey: ['owner-packs'] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay
      side="center"
      title="Upload a pack"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!file || name.trim().length < 2 || busy} onClick={() => void send()}>
            {busy ? 'Uploading…' : 'Add to the library'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          A <span className="font-mono">.sckools</span> pack file made on another machine — your laptop,
          or staging. It must be a management-data pack, not a whole-school backup, and it must be
          locked with this server’s backup password.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="pack-file">Pack file</Label>
          <input
            id="pack-file"
            ref={input}
            type="file"
            accept=".sckools"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <p className="sk-muted text-xs">{file.name} · {sizeLabel(file.size)}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="up-name">Name</Label>
          <Input id="up-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Small school" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="up-notes">Notes (optional)</Label>
          <Input id="up-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Overlay>
  );
}

function RenameDialog({ pack, onClose }: { pack: PackRow; onClose: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [name, setName] = useState(pack.name);
  const [notes, setNotes] = useState(pack.notes ?? '');
  const save = useMutation({
    mutationFn: () => api.patch<PackRow>(`/owner/sample-packs/${pack.id}`, { name, notes }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['owner-packs'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Overlay
      side="center"
      title={`Rename “${pack.name}”`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="rn-name">Name</Label>
          <Input id="rn-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rn-notes">Notes</Label>
          <Input id="rn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <p className="sk-muted">The schools this pack was loaded into are not affected by a rename.</p>
      </div>
    </Overlay>
  );
}

function DeleteDialog({ pack, onClose }: { pack: PackRow; onClose: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const remove = useMutation({
    mutationFn: () => api.del<{ ok: true }>(`/owner/sample-packs/${pack.id}`),
    onSuccess: () => {
      toast.success('Pack deleted');
      void qc.invalidateQueries({ queryKey: ['owner-packs'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Overlay
      side="center"
      title={`Delete “${pack.name}”`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={confirm.trim() !== pack.name || remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Deleting…' : 'Delete the pack'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          The pack and its file go for good. Schools it was already loaded into keep their data — they
          have their own copy of it.
        </p>
        {pack.loadCount > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
            Loaded {pack.loadCount} time{pack.loadCount > 1 ? 's' : ''}
            {pack.lastLoadedAt && `, last ${whenLabel(pack.lastLoadedAt)}`}.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="del-confirm">Type <span className="font-mono font-bold">{pack.name}</span> to confirm</Label>
          <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={pack.name} />
        </div>
      </div>
    </Overlay>
  );
}

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
  BackupRow, BucketPreflight, BucketRestoreRow, BucketStanding, PackRow,
  agoLabel, sizeLabel, useJob, whenLabel,
} from '../../_lib/backups';

type School = { id: string; name: string; slug: string };

/**
 * The four things a school is, each saved and put back on its own.
 *
 * The two kept rows (School settings, Website) are built from a school's real
 * details and are never touched by a data operation. The two swappable rows
 * are the management data: what a sample pack replaces, what a reset empties,
 * and what a rollback puts back.
 */
export function BucketsCard({ school }: { school: School }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const key = ['owner-buckets', school.id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<BucketStanding[]>(`/owner/schools/${school.id}/buckets`),
  });
  const restoresKey = ['owner-bucket-restores', school.id];
  const rq = useQuery({
    queryKey: restoresKey,
    queryFn: () => api.get<BucketRestoreRow[]>(`/owner/schools/${school.id}/bucket-restores`),
  });

  const [history, setHistory] = useState<BucketStanding | null>(null);
  const [job, setJob] = useState<{ id: string; title: string } | null>(null);
  const [plan, setPlan] = useState<Act | null>(null);

  const running = q.data?.find((b) => b.runningId) ?? null;
  const follow = useJob<BackupRow>(api, 'backups', running?.runningId ?? null);
  const live = follow.data;
  useEffect(() => {
    if (live && live.status !== 'RUNNING') void qc.invalidateQueries({ queryKey: key });
  }, [live?.id, live?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRestore = rq.data?.find((r) => r.status === 'RUNNING') ?? null;
  useEffect(() => {
    if (openRestore && !job) setJob({ id: openRestore.id, title: 'Putting data back' });
  }, [openRestore?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (scope?: string) =>
      api.post<{ started: BackupRow[]; skipped: { bucket: string; why: string }[] }>(
        `/owner/schools/${school.id}/buckets/save`,
        scope ? { buckets: scope.split(',') } : {},
      ),
    onSuccess: (r) => {
      if (r.started.length === 0 && r.skipped.length > 0) toast.error(r.skipped[0].why);
      else toast.success(r.started.length === 1 ? 'Saving…' : `Saving ${r.started.length} parts…`);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const gate = useQueryState(q, 'Loading the school’s parts…');

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Parts of this school</CardTitle>
            <CardDescription>
              Each part is saved and put back on its own. The website and the school’s own settings are
              built from its real details, so no data operation ever touches them. Saved every night —
              a part that has not changed is recognised and not kept twice.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => save.mutate(undefined)} disabled={save.isPending || !!running}>
            {save.isPending ? 'Starting…' : 'Save all now'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {gate}
        {live && live.status === 'RUNNING' && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900" role="status">
            <div className="flex items-center justify-between gap-3">
              <span>Saving {live.scope?.join(' + ') ?? 'the school'} — {Math.round(live.progress * 100)}%</span>
              <span className="text-xs text-indigo-700">You can leave this page; it carries on.</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded bg-indigo-100">
              <div className="h-1.5 rounded bg-indigo-600 transition-all" style={{ width: `${Math.max(3, live.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {q.data && (
          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead>
                <tr>
                  <th>Part</th>
                  <th data-priority="2">Rows</th>
                  <th>Saved</th>
                  <th className="acts">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((b) => (
                  <tr key={b.scope}>
                    <td data-wrap="true">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: b.kept ? 'var(--sk-good)' : 'var(--sk-amber)' }}
                        />
                        {b.label}
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-normal"
                          style={{
                            background: b.kept ? 'var(--sk-good-tint)' : 'var(--sk-amber-tint)',
                            color: b.kept ? 'var(--sk-good)' : 'var(--sk-amber-ink)',
                          }}
                        >
                          {b.kept ? 'kept' : 'swappable'}
                        </span>
                      </span>
                      <span className="sk-muted block text-xs">{b.holds}</span>
                    </td>
                    <td data-priority="2">{b.rowCount?.toLocaleString('en-IN') ?? '—'}</td>
                    <td data-wrap="true">
                      {b.runningId ? (
                        <span className="text-indigo-700">Saving — {Math.round(b.runningProgress * 100)}%</span>
                      ) : b.savedAt ? (
                        <>
                          <span>v{b.version} · {agoLabel(b.savedAt)}</span>
                          <span className="sk-muted block text-xs">
                            {b.versions} of {b.keeps} kept
                            {b.checkedAt && b.checkedAt !== b.savedAt && ` · checked ${agoLabel(b.checkedAt)}`}
                            {b.sizeBytes != null && ` · ${sizeLabel(b.sizeBytes)}`}
                          </span>
                        </>
                      ) : (
                        <span className="sk-muted">Not saved yet</span>
                      )}
                    </td>
                    <td className="acts">
                      <span className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => save.mutate(b.scope)} disabled={!!b.runningId || save.isPending}>
                          Save now
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setHistory(b)} disabled={b.versions === 0}>
                          History
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <DangerZone school={school} onAct={setPlan} />

        {rq.data && rq.data.length > 0 && (
          <details className="text-sm">
            <summary className="sk-muted cursor-pointer">What has been put back ({rq.data.length})</summary>
            <ul className="mt-2 space-y-1">
              {rq.data.slice(0, 8).map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-2">
                  <span>{whenLabel(r.createdAt)}</span>
                  <span className="sk-muted">{MODE_LABEL[r.mode]} · {r.scope?.join(' + ')}</span>
                  <span className={r.status === 'FAILED' ? 'text-rose-700' : r.status === 'DONE' ? 'text-emerald-700' : 'text-indigo-700'}>
                    {r.status === 'DONE' ? 'done' : r.status === 'FAILED' ? 'failed' : 'running'}
                  </span>
                  {r.status === 'FAILED' && r.error && <span className="sk-muted text-xs">{r.error}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>

      {history && <HistoryDialog school={school} standing={history} onClose={() => setHistory(null)} onRestore={(b) => { setHistory(null); setPlan({ kind: 'restore', standing: history, backup: b }); }} />}
      {plan && <ActDialog school={school} act={plan} onClose={() => setPlan(null)} onStarted={(id, title) => { setPlan(null); setJob({ id, title }); }} />}
      {job && (
        <Overlay side="center" title={job.title} onClose={() => setJob(null)} footer={<div className="flex justify-end"><Button variant="outline" onClick={() => setJob(null)}>Hide — it carries on</Button></div>}>
          <JobProgress id={job.id} onFinished={() => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: restoresKey }); }} />
        </Overlay>
      )}
    </Card>
  );
}

const MODE_LABEL: Record<BucketRestoreRow['mode'], string> = {
  BUCKET_REPLACE: 'Put back',
  BUCKET_MERGE: 'Settings put back',
  RESET: 'Emptied',
};

/** What the operator is about to do, before it is confirmed. */
type Act =
  | { kind: 'restore'; standing: BucketStanding; backup: BackupRow }
  | { kind: 'reset' }
  | { kind: 'pack'; pack: PackRow };

function DangerZone({ school, onAct }: { school: School; onAct: (a: Act) => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const packs = useQuery({ queryKey: ['owner-packs'], queryFn: () => api.get<PackRow[]>('/owner/sample-packs') });
  const ready = (packs.data ?? []).filter((p) => p.status === 'READY');
  const [picked, setPicked] = useState('');

  return (
    <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-rose-900">Load a sample pack</p>
          <p className="text-xs text-rose-800/80">
            Replaces the management data with a pack from the library, for a demo. The website and the
            school’s settings are not touched.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Sample pack"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            disabled={ready.length === 0}
            className="max-w-[16rem]"
          >
            <option value="">{ready.length === 0 ? 'No packs in the library' : 'Choose a pack…'}</option>
            {ready.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.rowCount?.toLocaleString('en-IN') ?? '?'} rows</option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="outline"
            className="border-rose-300 text-rose-800"
            disabled={!picked}
            onClick={() => {
              const pack = ready.find((p) => p.id === picked);
              if (pack) onAct({ kind: 'pack', pack });
            }}
          >
            Load…
          </Button>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rose-200/70 pt-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-rose-900">Reset management data</p>
          <p className="text-xs text-rose-800/80">
            Empties the roster and everything that happened, leaving a working school with no data — what
            you do at go-live, before the real roll goes in through Onboarding.
          </p>
        </div>
        <Button size="sm" variant="outline" className="border-rose-300 text-rose-800" onClick={() => onAct({ kind: 'reset' })}>
          Reset…
        </Button>
      </div>
      <p className="text-xs text-rose-800/80">
        Both pause {school.name} while they run, take a copy of exactly what they replace first, and put
        that copy back by themselves if anything fails. No file is ever deleted.
      </p>
    </div>
  );
}

/** The kept versions of one part, newest first. */
function HistoryDialog({ school, standing, onClose, onRestore }: {
  school: School; standing: BucketStanding; onClose: () => void; onRestore: (b: BackupRow) => void;
}) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const q = useQuery({
    queryKey: ['owner-bucket-versions', school.id, standing.scope],
    queryFn: () => api.get<BackupRow[]>(`/owner/schools/${school.id}/buckets/${standing.scope}/versions`),
  });
  const gate = useQueryState(q, 'Loading versions…');
  return (
    <Overlay side="center" title={`${standing.label} — ${standing.versions} kept`} onClose={onClose}
      footer={<div className="flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>}
    >
      <div className="space-y-3 text-sm">
        <p className="sk-muted">{standing.holds}. The newest {standing.keeps} are kept.</p>
        {gate}
        {q.data && q.data.length === 0 && <p className="sk-muted">Nothing saved yet.</p>}
        {q.data && q.data.length > 0 && (
          <div className="sk-tblwrap">
            <table className="sk-tbl">
              <thead><tr><th>Saved</th><th data-priority="2">Rows</th><th>Status</th><th className="acts">&nbsp;</th></tr></thead>
              <tbody>
                {q.data.map((b) => (
                  <tr key={b.id}>
                    <td data-wrap="true">
                      {b.version ? `v${b.version} · ` : ''}{whenLabel(b.createdAt)}
                      {b.checkedAt && b.checkedAt !== b.createdAt && (
                        <span className="sk-muted block text-xs">still current as of {agoLabel(b.checkedAt)}</span>
                      )}
                    </td>
                    <td data-priority="2">{b.rowCount?.toLocaleString('en-IN') ?? '—'}</td>
                    <td data-wrap="true">
                      {b.status === 'READY' && <span className="text-emerald-700">Ready</span>}
                      {b.status === 'RUNNING' && <span className="text-indigo-700">Saving</span>}
                      {b.status === 'EXPIRED' && <span className="sk-muted">{b.error ?? 'Removed'}</span>}
                      {b.status === 'FAILED' && <span className="text-rose-700">Failed — {b.error}</span>}
                    </td>
                    <td className="acts">
                      {b.status === 'READY' && (
                        <Button size="sm" variant="outline" onClick={() => onRestore(b)}>Put back…</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Overlay>
  );
}

/**
 * One dialog for all three destructive acts, because all three answer the same
 * question first: what exactly changes, and what is left alone. The numbers
 * come from the server's own preflight, not from this page's guesses.
 */
function ActDialog({ school, act, onClose, onStarted }: {
  school: School; act: Act; onClose: () => void; onStarted: (id: string, title: string) => void;
}) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const [confirm, setConfirm] = useState('');
  const [shiftDates, setShiftDates] = useState(true);

  const body = act.kind === 'restore'
    ? { buckets: act.standing.buckets, backupId: act.backup.id }
    : act.kind === 'reset'
      ? { buckets: ['setup', 'day'], reset: true }
      : { buckets: ['setup', 'day'], packId: act.pack.id, shiftDates };

  const pre = useQuery({
    queryKey: ['owner-bucket-preflight', school.id, JSON.stringify(body)],
    queryFn: () => api.post<BucketPreflight>(`/owner/schools/${school.id}/buckets/preflight`, body),
    retry: false,
  });

  const go = useMutation({
    mutationFn: () => api.post<BucketRestoreRow>(`/owner/schools/${school.id}/buckets/restore`, body),
    onSuccess: (r) => onStarted(r.id, TITLE[act.kind]),
    onError: (e: Error) => toast.error(e.message),
  });

  const p = pre.data;
  const title = act.kind === 'restore'
    ? `Put ${act.standing.label} back to ${whenLabel(act.backup.createdAt)}`
    : act.kind === 'reset'
      ? `Reset ${school.name}’s management data`
      : `Load “${act.pack.name}” into ${school.name}`;

  return (
    <Overlay side="center" title={title} onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!p || confirm.trim() !== school.slug || go.isPending}
            onClick={() => go.mutate()}
          >
            {go.isPending ? 'Starting…' : ACTION[act.kind]}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {pre.isPending && <p className="sk-muted">Working out what would change…</p>}
        {pre.error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800" role="alert">{(pre.error as Error).message}</p>
        )}
        {p && (
          <>
            {p.widenedTo.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                This also replaces <b>{p.widenedTo.join(' and ')}</b>: {p.widenedTo.includes('day') ? 'every mark and invoice hangs off the roster, so the two can only move together' : 'rows outside the part would otherwise be stranded'}.
              </p>
            )}
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
              <dt className="sk-muted">Replaces</dt>
              <dd>
                {p.currentRows.toLocaleString('en-IN')} rows in {p.buckets.join(' + ')}
                {p.snapshotRows > 0 && <> → {p.snapshotRows.toLocaleString('en-IN')} rows from {p.label}</>}
              </dd>
              <dt className="sk-muted">Keeps</dt>
              <dd>The website, the school’s settings and its admin logins — and every file.</dd>
              {p.shiftWeeks !== 0 && (
                <>
                  <dt className="sk-muted">Dates</dt>
                  <dd>Moved forward {p.shiftWeeks} week{p.shiftWeeks === 1 ? '' : 's'}, so the data reads as this session and every register keeps its weekday.</dd>
                </>
              )}
              {p.pointers > 0 && (
                <>
                  <dt className="sk-muted">Website links</dt>
                  <dd>{p.pointers} card{p.pointers > 1 ? 's' : ''} pointing at a teacher or student {act.kind === 'restore' ? 'will be re-linked' : 'will be left blank, because a pack’s people are different rows'}.</dd>
                </>
              )}
            </dl>
            {p.warnings.length > 0 && (
              <details>
                <summary className="cursor-pointer text-amber-800">{p.warnings.length} note(s) from the copy</summary>
                <ul className="mt-1 list-disc pl-5 text-xs">{p.warnings.slice(0, 20).map((w) => <li key={w}>{w}</li>)}</ul>
              </details>
            )}
            {act.kind === 'pack' && (
              <label className="flex items-start gap-2">
                <input
                  id="shift-dates"
                  type="checkbox"
                  className="mt-0.5"
                  checked={shiftDates}
                  onChange={(e) => setShiftDates(e.target.checked)}
                />
                <span>Shift the dates so the data reads as the current session</span>
              </label>
            )}
            <p className="sk-muted">
              {school.name} is paused while this runs, a copy of exactly what is being replaced is taken
              first, and that copy is put back automatically if anything fails.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="bucket-confirm">Type <span className="font-mono font-bold">{school.slug}</span> to confirm</Label>
              <Input id="bucket-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={school.slug} />
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}

const TITLE: Record<Act['kind'], string> = {
  restore: 'Putting it back',
  reset: 'Emptying the management data',
  pack: 'Loading the sample pack',
};
const ACTION: Record<Act['kind'], string> = {
  restore: 'Put it back',
  reset: 'Empty it',
  pack: 'Replace the data',
};

/** Follows one scoped job to the end, in the words of what it is doing. */
function JobProgress({ id, onFinished }: { id: string; onFinished: () => void }) {
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const job = useJob<BucketRestoreRow>(api, 'bucket-restores', id);
  const r = job.data;
  useEffect(() => {
    if (r && r.status !== 'RUNNING') onFinished();
  }, [r?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!r) return <p className="sk-muted">Starting…</p>;
  if (r.status === 'FAILED') {
    return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{r.error}</p>;
  }
  if (r.status === 'DONE') {
    const rep = r.report ?? {};
    return (
      <div className="space-y-2 text-sm" role="status">
        <p className="text-emerald-700">
          {rep.emptied
            ? `Done — ${r.scope?.join(' and ')} is empty. The website and the settings are untouched.`
            : `Done — ${(rep.rows ?? 0).toLocaleString('en-IN')} rows are in place.`}
        </p>
        {rep.note && <p className="sk-muted">{rep.note}</p>}
        {!!rep.relinked && <p className="sk-muted">{rep.relinked} website card{rep.relinked > 1 ? 's' : ''} re-linked.</p>}
        {!!rep.shiftedWeeks && <p className="sk-muted">Dates moved forward {rep.shiftedWeeks} week(s).</p>}
        {(rep.dropped ?? []).map((d) => (
          <p key={d.table + d.reason} className="text-amber-800">Not brought back: {d.rows} × {d.table} — {d.reason}</p>
        ))}
        {(rep.cleared ?? []).map((c) => (
          <p key={c.table + c.column} className="text-amber-800">Link cleared: {c.rows} × {c.table}.{c.column}</p>
        ))}
        {(rep.warnings ?? []).length > 0 && (
          <details>
            <summary className="cursor-pointer text-amber-800">{rep.warnings!.length} note(s)</summary>
            <ul className="mt-1 list-disc pl-5 text-xs">{rep.warnings!.slice(0, 50).map((w) => <li key={w}>{w}</li>)}</ul>
          </details>
        )}
      </div>
    );
  }
  const label = r.phase === 'awaiting-backup'
    ? 'Copying what is about to be replaced'
    : r.phase === 'rollback'
      ? 'Something failed — putting the school back as it was'
      : 'Putting the rows in';
  return (
    <div className="space-y-2 text-sm" role="status">
      <p className={r.phase === 'rollback' ? 'text-amber-800' : undefined}>{label} — {Math.round(r.progress * 100)}%</p>
      <div className="h-1.5 w-full rounded bg-indigo-100">
        <div className="h-1.5 rounded bg-indigo-600 transition-all" style={{ width: `${Math.max(3, r.progress * 100)}%` }} />
      </div>
      <p className="sk-muted">You can close this; it carries on.</p>
    </div>
  );
}

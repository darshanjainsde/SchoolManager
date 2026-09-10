'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SPORTS_PERMS, SPORTS_PERM_LABELS, type SportsPerm } from '@skoolos/types';
import { Card, CardBody, CardHead, EmptyRow, Pill, useDesk, type CoachRow } from './ui';

/**
 * Admin → Sports → Teachers. The JOB (Staff.role = SPORTS) is set on the
 * Staff page like any other job; this is where the admin decides what each
 * sports teacher may do on the desk. The API is the gate — this only shows
 * the choice.
 */
export default function TeachersTab({ base: _base }: { base: string }) {
  const { api, host } = useDesk();
  const qc = useQueryClient();
  const coaches = useQuery({ queryKey: ['sports-coaches', host], enabled: !!host, queryFn: () => api.get<CoachRow[]>('/sports/admin/coaches') });
  return (
    <div className="sk-sp-stack">
      <Card>
        <CardHead>
          <h3>Sports teachers</h3>
          <p>Everyone whose job on the <Link href="/app/staff">Staff page</Link> is “Sports teacher”. They sign in as staff and land on the desk; tick what each may do.</p>
        </CardHead>
        <CardBody>
          {coaches.isLoading ? <EmptyRow>Looking…</EmptyRow> : null}
          {coaches.data?.length === 0 ? <EmptyRow>No sports teacher yet. On the Staff page, set a staff member’s job to Sports teacher and create their login; they appear here.</EmptyRow> : null}
          {coaches.data?.map((c) => <CoachCard key={c.id} c={c} onSaved={() => qc.invalidateQueries({ queryKey: ['sports-coaches'] })} />)}
        </CardBody>
      </Card>
      <Card>
        <CardHead><h3>What each right means</h3></CardHead>
        <CardBody>
          <div className="sk-sp-kv">
            <div><b>Enter results and marks</b><span className="sk-muted">Score matches, type heat marks, log record claims.</span></div>
            <div><b>Verify records</b><span className="sk-muted">Sign a record into the book, type in the old register, void one.</span></div>
            <div><b>Create and schedule tournaments</b><span className="sk-muted">The wizard, rain delays, moving slots, finishing a meet.</span></div>
            <div><b>Publish to students</b><span className="sk-muted">Make a meet visible and send first-slot notices. Settings can reserve this for the admin.</span></div>
            <div><b>Houses and points</b><span className="sk-muted">Add houses, put children in them, award or correct points.</span></div>
            <div><b>Sports settings</b><span className="sk-muted">Bands or age groups, the points table, who may publish.</span></div>
          </div>
          <p className="sk-muted">A new sports teacher starts with the first, second, third and fifth. The admin always holds all six.</p>
        </CardBody>
      </Card>
    </div>
  );
}

function CoachCard({ c, onSaved }: { c: CoachRow; onSaved: () => void }) {
  const { api } = useDesk();
  const [perms, setPerms] = useState<SportsPerm[]>(c.perms);
  const dirty = perms.length !== c.perms.length || perms.some((p) => !c.perms.includes(p));
  const save = useMutation({
    mutationFn: () => api.patch(`/sports/admin/coaches/${c.id}`, { sportsPerms: perms }),
    onSuccess: () => { onSaved(); toast.success(`Saved for ${c.name} — applies on their next request.`); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div className="sk-sp-eventrow">
      <div className="sk-sp-eventhead">
        <span className="nm">{c.name}</span>
        {c.isActive ? null : <Pill tone="bad">Inactive</Pill>}
        {c.hasLogin ? <Pill tone="good">Has a login</Pill> : <Pill tone="amber">No login yet</Pill>}
        {!c.stored ? <Pill tone="muted">Default rights</Pill> : null}
        <span style={{ flex: 1 }} />
        <button type="button" className="sk-btn" data-size="sm" data-variant="primary" disabled={!dirty || perms.length === 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>
      </div>
      <div className="sk-sp-perms">
        {SPORTS_PERMS.map((p) => (
          <label key={p}>
            <input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
            {SPORTS_PERM_LABELS[p]}
          </label>
        ))}
      </div>
      {perms.length === 0 ? <p className="sk-muted">Keep at least one right, or change the job on the Staff page instead.</p> : null}
    </div>
  );
}

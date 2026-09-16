'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bracket } from '@/components/sports/bracket';
import { DayPicker } from '@/components/sports/day-picker';
import { NextUp, stepsOf } from '@/components/sports/next-up';
import { PlanBoard, type PlanActions } from '@/components/sports/plan-board';
import { Programme, type ProgrammeActions } from '@/components/sports/programme';
import { Timetable, type TimetableActions } from '@/components/sports/timetable';
import { HeatSheet } from '@/components/sports/heat-sheet';
import { ScoreBox } from '@/components/sports/score-box';
import { clashesOf, dayIndexOf, daySpanOf, eventLabel, slotsOf, type Slot } from '@/components/sports/model';
import { hhmm } from '@skoolos/types';
import { Card, CardBody, CardHead, EmptyRow, Pill, STATUS_LABEL, TONE, fmtDay, useDesk, type MatchRow, type TournamentDetail } from './ui';
import { QueryError } from '@/components/ui/query-state';

type View = 'schedule' | 'day' | 'plan' | 'events' | 'clashes';

type PlanJob =
  | { kind: 'update'; body: { endsOn?: string; dayStartMin?: number; dayEndMin?: number; restMin?: number } }
  | { kind: 'addVenue'; name: string }
  | { kind: 'removeVenue'; venueId: string }
  | { kind: 'pin'; eventId: string; dayIdx: number | null }
  | { kind: 'refit' };

type BoardJob =
  | { kind: 'move'; slot: Slot; venueId: string; atMin: number }
  | { kind: 'moveGroup'; eventId: string; groupLabel: string; deltaMin: number }
  | { kind: 'hold'; eventIds: string[]; dayIdx: number | null }
  | { kind: 'clearVenue'; venueId: string };

/** The inverse of the last move, so one press puts it back. */
type Undo = { label: string; job: BoardJob };

const PLAN_SAID: Record<PlanJob['kind'], string> = {
  update: 'The meet changed shape — every unplayed slot has been laid out again.',
  addVenue: 'Venue added. Every event that belongs on it now has it, and the plan is re-laid.',
  removeVenue: 'Venue removed. What stood on it has been moved to the others.',
  pin: 'Event held to its day. The rest of the plan filled in around it.',
  refit: 'Laid out again on the days and courts the meet has now.',
};

/**
 * One tournament, one payload, every desk. The board, the brackets, the heat
 * sheets and the clash list are all derived from `/sports/tournaments/:id`
 * with the shared maths; while the meet is live the page refetches every 15 s
 * so a second phone sees a result the moment the first one saves it.
 */
export default function TournamentView({ base, id }: { base: string; id: string }) {
  const { api, host, can, isAdmin, ready } = useDesk();
  const qc = useQueryClient();
  const router = useRouter();
  const [view, setView] = useState<View>('schedule');
  const [day, setDay] = useState(0);
  const [eventId, setEventId] = useState<string | null>(null);
  const [selected, setSelected] = useState<MatchRow | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'finish' | null>(null);
  const [delay, setDelay] = useState('30');

  const q = useQuery({
    queryKey: ['sports-tournament', host, id], enabled: !!host,
    queryFn: () => api.get<TournamentDetail>(`/sports/tournaments/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'LIVE' ? 15_000 : false),
  });
  const t = q.data;
  const clashes = useMemo(() => (t ? clashesOf(t) : []), [t]);
  const span = t ? daySpanOf(t) : { booked: 1, used: 1, over: false };
  const days = useMemo(() => (t ? dayIndexOf(t) : []), [t]);
  useEffect(() => { if (t && !eventId && t.events[0]) setEventId(t.events[0].id); }, [t, eventId]);
  useEffect(() => {
    // keep the open scoresheet in step with a reload
    if (!t || !selected) return;
    const fresh = t.events.flatMap((e) => e.matches).find((m) => m.id === selected.id);
    if (fresh && fresh.version !== selected.version) setSelected(fresh);
  }, [t, selected]);

  const act = useMutation({
    mutationFn: (what: 'publish' | 'finish' | 'delete' | 'shift') => {
      if (what === 'delete') return api.del(`/sports/tournaments/${id}`);
      if (what === 'shift') return api.post(`/sports/tournaments/${id}/shift`, { deltaMin: Number(delay) || 0 });
      return api.post(`/sports/tournaments/${id}/${what}`, {});
    },
    onSuccess: (r, what) => {
      setConfirm(null);
      if (what === 'delete') { toast.success('Draft deleted.'); router.push(base); return; }
      qc.invalidateQueries({ queryKey: ['sports-tournament', host, id] });
      qc.invalidateQueries({ queryKey: ['sports-tournaments'] });
      if (what === 'publish') toast.success(`Published. ${(r as { notified: number }).notified} students told their first slot.`);
      if (what === 'finish') toast.success('Finished. The results and the house points stand.');
      if (what === 'shift') toast.success(`Moved ${(r as { matches: number }).matches} matches and ${(r as { heats: number }).heats} heats by ${delay} minutes.`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const plan = useMutation({
    mutationFn: (job: PlanJob) => {
      if (job.kind === 'update') return api.patch(`/sports/tournaments/${id}`, job.body);
      if (job.kind === 'addVenue') return api.post(`/sports/tournaments/${id}/venues`, { name: job.name });
      if (job.kind === 'removeVenue') return api.del(`/sports/tournaments/${id}/venues/${job.venueId}`);
      if (job.kind === 'pin') return api.patch(`/sports/tournaments/${id}/events/${job.eventId}/day`, { dayIdx: job.dayIdx });
      return api.post(`/sports/tournaments/${id}/refit`, {});
    },
    onSuccess: (fresh, job) => {
      qc.setQueryData(['sports-tournament', host, id], fresh);
      qc.invalidateQueries({ queryKey: ['sports-tournaments'] });
      toast.success(PLAN_SAID[job.kind]);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const [undo, setUndo] = useState<Undo | null>(null);
  const board = useMutation({
    mutationFn: (job: BoardJob) => {
      if (job.kind === 'move') return api.patch(`/sports/tournaments/${id}/${job.slot.kind === 'match' ? 'matches' : 'heats'}/${job.slot.id}/slot`, { venueId: job.venueId, atMin: job.atMin });
      if (job.kind === 'moveGroup') return api.post(`/sports/tournaments/${id}/move-group`, { eventId: job.eventId, groupLabel: job.groupLabel, deltaMin: job.deltaMin });
      if (job.kind === 'hold') return api.patch(`/sports/tournaments/${id}/events/day`, { eventIds: job.eventIds, dayIdx: job.dayIdx });
      return api.post(`/sports/tournaments/${id}/venues/${job.venueId}/clear`, {});
    },
    onSuccess: (fresh, job) => {
      if (job.kind === 'move') qc.invalidateQueries({ queryKey: ['sports-tournament', host, id] });
      else qc.setQueryData(['sports-tournament', host, id], fresh);
      if (job.kind === 'move') toast.success(`${job.slot.event.sportName} ${job.slot.short} moved to ${t?.venues.find((v) => v.id === job.venueId)?.name ?? 'its new court'} at ${hhmm(job.atMin)}.`);
      if (job.kind === 'moveGroup') toast.success(`${job.groupLabel} moved ${Math.abs(job.deltaMin)} minutes ${job.deltaMin < 0 ? 'earlier' : 'later'}. Anything played stayed where it was.`);
      if (job.kind === 'hold') toast.success(job.dayIdx == null ? 'Freed — those events fall wherever they fit.' : 'Held to that day. The rest of the plan filled in around them.');
      if (job.kind === 'clearVenue') toast.success('Cleared. Everything unplayed has been re-laid on the other venues.');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const run = (job: BoardJob, back: Undo | null) => { setUndo(back); board.mutate(job); };
  const boardActs: TimetableActions = {
    move: (slot, venueId, atMin) => run(
      { kind: 'move', slot, venueId, atMin },
      { label: `${slot.event.sportName} ${slot.short} back to ${hhmm(slot.atMin)}`, job: { kind: 'move', slot, venueId: slot.venueId, atMin: slot.atMin } },
    ),
    clearVenue: (venueId) => run({ kind: 'clearVenue', venueId }, null),
    refuse: (why) => toast.error(why),
  };
  const progActs: ProgrammeActions = {
    moveGroup: (eventId, groupLabel, deltaMin) => run(
      { kind: 'moveGroup', eventId, groupLabel, deltaMin },
      { label: `${groupLabel} back`, job: { kind: 'moveGroup', eventId, groupLabel, deltaMin: -deltaMin } },
    ),
    hold: (eventIds, dayIdx) => run({ kind: 'hold', eventIds, dayIdx }, null),
  };

  const planActs: PlanActions = {
    update: (body) => plan.mutate({ kind: 'update', body }),
    addVenue: (name) => plan.mutate({ kind: 'addVenue', name }),
    removeVenue: (venueId) => plan.mutate({ kind: 'removeVenue', venueId }),
    pin: (eventId, dayIdx) => plan.mutate({ kind: 'pin', eventId, dayIdx }),
    refit: () => plan.mutate({ kind: 'refit' }),
  };

  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="" />;
  if (q.isLoading || !t) return <p className="sk-state">Opening the tournament…</p>;
  const live = t.status === 'LIVE';
  const event = t.events.find((e) => e.id === eventId) ?? t.events[0];
  const canRun = ready && can('CREATE') && t.status !== 'DONE';
  const openSlot = (s: Slot) => { setEventId(s.eventId); setView('events'); if (s.kind === 'match') { const m = s.event.matches.find((x) => x.id === s.id); if (m) setSelected(m); } };

  return (
    <div className="sk-sp-stack">
      <Card>
        <CardHead>
          <h3>{t.name}</h3>
          <Pill tone={TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
          {t.status === 'DRAFT' ? <Pill tone="amber">Not visible to students</Pill> : null}
          {clashes.length ? <Pill tone="bad">{clashes.length} clash{clashes.length === 1 ? '' : 'es'}</Pill> : null}
          <span className="sp" />
          <Link className="sk-btn" data-size="sm" href={base}>All tournaments</Link>
        </CardHead>
        <CardBody>
          <div className="sk-sp-kv">
            <div><span className="sk-lab">Days</span><b>{fmtDay(t.startsOn)}{span.booked > 1 ? ` – ${fmtDay(t.endsOn)}` : ''}</b></div>
            <div><span className="sk-lab">Hours</span><b>{hhmm(t.dayStartMin)}–{hhmm(t.dayEndMin)}</b></div>
            <div><span className="sk-lab">Venues</span><b>{t.venues.map((v) => v.name).join(', ')}</b></div>
            <div><span className="sk-lab">Events</span><b>{t.events.length}</b></div>
          </div>
          {ready ? (
            <div className="sk-sp-actions">
              {t.status !== 'DONE' && !t.published && can('PUBLISH') ? <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={act.isPending} onClick={() => act.mutate('publish')}>Publish to students</button> : null}
              {live && can('CREATE') ? (
                confirm === 'finish'
                  ? <><button type="button" className="sk-btn" data-variant="primary" onClick={() => act.mutate('finish')}>Yes, finish it</button><button type="button" className="sk-btn" onClick={() => setConfirm(null)}>Keep going</button></>
                  : <button type="button" className="sk-btn" onClick={() => setConfirm('finish')}>Finish tournament</button>
              ) : null}
              {t.status === 'DRAFT' && can('CREATE') ? (
                confirm === 'delete'
                  ? <><button type="button" className="sk-btn" data-tone="bad" data-icon="" onClick={() => act.mutate('delete')}>Yes, delete the draft</button><button type="button" className="sk-btn" onClick={() => setConfirm(null)}>Keep it</button></>
                  : <button type="button" className="sk-btn" onClick={() => setConfirm('delete')}>Delete draft</button>
              ) : null}
              {live && can('CREATE') ? (
                <span className="sk-sp-pointsrow">
                  <span className="sk-muted">Rain delay:</span>
                  <input className="sk-input" inputMode="numeric" aria-label="Delay in minutes" value={delay} onChange={(e) => setDelay(e.target.value)} />
                  <button type="button" className="sk-btn" data-size="sm" disabled={act.isPending || !Number(delay)} onClick={() => act.mutate('shift')}>Push unplayed slots</button>
                </span>
              ) : null}
              {!t.published && !can('PUBLISH') ? <span className="sk-muted">{isAdmin ? '' : 'Publishing needs the PUBLISH permission or the admin.'}</span> : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <NextUp steps={stepsOf(t, clashes.length)} onGo={(to) => setView(to === 'programme' ? 'schedule' : to)} />

      <div className="sk-seg sk-sp-views" role="tablist" aria-label="Tournament views">
        <button type="button" role="tab" aria-selected={view === 'schedule'} onClick={() => setView('schedule')}>Programme</button>
        <button type="button" role="tab" aria-selected={view === 'day'} onClick={() => setView('day')}>Timetable</button>
        <button type="button" role="tab" aria-selected={view === 'plan'} onClick={() => setView('plan')}>Days &amp; courts{span.over ? ' ⚠' : ''}</button>
        <button type="button" role="tab" aria-selected={view === 'events'} onClick={() => setView('events')}>Events & results</button>
        <button type="button" role="tab" aria-selected={view === 'clashes'} onClick={() => setView('clashes')}>Clashes{clashes.length ? ` (${clashes.length})` : ''}</button>
      </div>

      {view === 'schedule' ? (
        <Card>
          <CardHead>
            <h3>Programme</h3>
            <span className="sp" />
            {undo ? <button type="button" className="sk-btn" data-size="sm" disabled={board.isPending} onClick={() => { const u = undo; setUndo(null); board.mutate(u.job); }}>Put {undo.label}</button> : null}
          </CardHead>
          <CardBody>
            <Programme t={t} canEdit={canRun} busy={board.isPending} act={progActs} onOpen={openSlot} />
          </CardBody>
        </Card>
      ) : null}

      {view === 'day' ? (
        <Card>
          <CardHead>
            <h3>Timetable</h3>
            <span className="sp" />
            {undo ? <button type="button" className="sk-btn" data-size="sm" disabled={board.isPending} onClick={() => { const u = undo; setUndo(null); board.mutate(u.job); }}>Put {undo.label}</button> : null}
            <DayPicker startsOn={t.startsOn} days={days} day={day} onDay={setDay} />
          </CardHead>
          <CardBody>
            <Timetable t={t} day={day} clashes={clashes} canEdit={canRun} busy={board.isPending} act={boardActs} onOpen={openSlot} />
          </CardBody>
        </Card>
      ) : null}

      {view === 'plan' ? (
        <Card>
          <CardHead><h3>Days &amp; courts</h3><span className="sp" />{plan.isPending ? <Pill tone="brand">Re-laying the plan…</Pill> : null}</CardHead>
          <CardBody>
            <PlanBoard t={t} canEdit={ready && can('CREATE') && t.status !== 'DONE'} busy={plan.isPending} act={planActs} onOpenDay={(d) => { setDay(d); setView('day'); }} />
          </CardBody>
        </Card>
      ) : null}

      {view === 'events' && event ? (
        <Card>
          <CardHead>
            <h3>Events & results</h3>
            <span className="sp" />
            <select className="sk-input" aria-label="Event" value={event.id} onChange={(e) => { setEventId(e.target.value); setSelected(null); }}>
              {t.events.map((e) => <option key={e.id} value={e.id}>{eventLabel(e)}</option>)}
            </select>
          </CardHead>
          <CardBody>
            {!live ? <p className="sk-muted">{t.status === 'DRAFT' ? 'Publish the tournament to enter results.' : 'This tournament is finished — results are read-only.'}</p> : null}
            {event.kind === 'MATCH' ? (
              <>
                <Bracket t={t} event={event} selectedId={selected?.id ?? null} canScore={live && can('ENTER')} onSelect={(m) => setSelected(selected?.id === m.id ? null : m)} />
                {selected && selected.aSide && selected.bSide ? <ScoreBox t={t} m={selected} scoring={event.scoring} onClose={() => setSelected(null)} /> : null}
                {event.structure === 'CLASS' && !event.matches.some((m) => m.stage === 'FINAL') ? <p className="sk-muted">The band final appears here on its own once every class has a champion.</p> : null}
              </>
            ) : event.scoring.type === 'MARK' ? (
              <div className="sk-sp-stack">
                {event.heats.map((h) => <HeatSheet key={h.id} t={t} heat={h} scoring={event.scoring.type === 'MARK' ? event.scoring : { type: 'MARK', label: 'Mark', unit: 'pts', lowerIsBetter: false, precision: 1 }} canEnter={can('ENTER')} live={live} />)}
                {event.heats.length > 1 && !event.heats.some((h) => h.kind === 'FINAL') ? <p className="sk-muted">The final heat appears here on its own once every heat is ranked — the best {event.lanes} marks go through.</p> : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {view === 'clashes' ? (
        <Card>
          <CardHead><h3>Clashes</h3></CardHead>
          <CardBody>
            {clashes.length === 0 ? <EmptyRow>No clashes — nobody is booked in two places at once and no venue holds two slots together.</EmptyRow> : null}
            {clashes.map((c, i) => {
              const s = slotsOf(t);
              const a = s.find((x) => x.id === c.first);
              const b = s.find((x) => x.id === c.second);
              const who = c.kind === 'VENUE' ? (t.venues.find((v) => v.id === c.who)?.name ?? 'Venue') : (t.sideNames[`s:${c.who}`] ?? 'A student');
              return (
                <div key={i} className="sk-row">
                  <div className="sp">
                    <div className="nm">{who} — {c.kind === 'VENUE' ? 'two slots at the same time' : 'booked in two places at once'}</div>
                    <div className="meta">{a ? `${hhmm(a.atMin)} ${a.title}` : c.first} · {b ? `${hhmm(b.atMin)} ${b.title}` : c.second}</div>
                  </div>
                  {a ? <button type="button" className="sk-btn" data-size="sm" onClick={() => openSlot(a)}>Open</button> : null}
                </div>
              );
            })}
            {clashes.length ? <p className="sk-muted">Use the rain-delay control above to push a whole block, or delete the draft and add a venue.</p> : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

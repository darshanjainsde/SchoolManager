'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { SCORING_PRESETS, SPORT_CATEGORIES, customSport, sidesAreSections, sportsByGroup, type Sport, type SportCategory } from '@skoolos/types';
import { Card, CardBody, CardHead, EmptyRow, Pill, useDebounced, useDesk, type RosterStudent, type SettingsView } from './ui';
import {
  daysOf, eligible, emptyState, groupOptions, hhmmToMin, meetYearOf, minToHhmm, newEvent, nextUid, problems, sideCount, toDto, type WizardEvent, type WizardState,
} from './wizard-model';

const STEPS = ['The meet', 'Sports', 'Events', 'Players', 'Review & create'];
const QUICK_VENUES = ['Court 1', 'Court 2', 'Field', 'Track', 'Pool', 'Hall'];

/**
 * Five steps, one POST. Everything is checked as you go (`problems`), so the
 * Create button is never a surprise, and the whole meet is one transaction on
 * the API — venues, events, entries, class draws, heats and every slot on a
 * venue come back together or not at all.
 */
export default function Wizard({ base, onClose }: { base: string; onClose: () => void }) {
  const { api, host } = useDesk();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(() => emptyState(new Date().toISOString().slice(0, 10)));

  const settings = useQuery({ queryKey: ['sports-settings', host], enabled: !!host, queryFn: () => api.get<SettingsView>('/sports/settings') });
  const roster = useQuery({ queryKey: ['sports-roster', host], enabled: !!host, staleTime: 60_000, queryFn: () => api.get<RosterStudent[]>('/sports/roster') });
  const grouping = settings.data?.grouping ?? 'BANDS';
  const bands = settings.data?.bands ?? [];
  const groups = useMemo(() => groupOptions(grouping, bands), [grouping, bands]);
  const meetYear = meetYearOf(state.startsOn);
  const issues = problems(state, roster.data ?? []);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; days: number; daysNeeded: number; warnings: string[] }>('/sports/tournaments', toDto(state)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sports-tournaments'] });
      toast.success('Tournament created — every match and heat has a court and a time.');
      for (const w of r.warnings) toast.warning(w, { duration: 9000 });
      router.push(`${base}/tournaments/${r.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  const patchEvent = (uid: string, p: Partial<WizardEvent>) => setState((s) => ({ ...s, events: s.events.map((e) => (e.uid === uid ? { ...e, ...p } : e)) }));
  const toggleSport = (sport: Sport) => {
    setState((s) => {
      const has = s.events.some((e) => e.sport.key === sport.key);
      return { ...s, events: has ? s.events.filter((e) => e.sport.key !== sport.key) : [...s.events, newEvent(sport, groups, s.venues.length)] };
    });
  };

  return (
    <Card>
      <CardHead>
        <h3>New tournament</h3>
        <span className="sp" />
        <button type="button" className="sk-btn" data-size="sm" onClick={onClose}>Cancel</button>
      </CardHead>
      <div className="sk-steps" role="tablist" aria-label="New tournament steps">
        {STEPS.map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={step === i} onClick={() => setStep(i)}>
            <span className="n">{i + 1}</span>{label}
          </button>
        ))}
      </div>
      <CardBody>
        {step === 0 ? <MeetStep state={state} patch={patch} /> : null}
        {step === 1 ? <SportsStep state={state} toggle={toggleSport} /> : null}
        {step === 2 ? <EventsStep state={state} groups={groups} patchEvent={patchEvent} setState={setState} /> : null}
        {step === 3 ? <PlayersStep state={state} roster={roster.data ?? []} grouping={grouping} bands={bands} meetYear={meetYear} patchEvent={patchEvent} loading={roster.isLoading} /> : null}
        {step === 4 ? <ReviewStep state={state} roster={roster.data ?? []} issues={issues} busy={create.isPending} onCreate={() => create.mutate()} /> : null}
        <div className="sk-sp-actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="sk-btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="sk-btn" data-variant="primary" onClick={() => setStep(step + 1)}>Next: {STEPS[step + 1]}</button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

function MeetStep({ state, patch }: { state: WizardState; patch: (p: Partial<WizardState>) => void }) {
  const [venue, setVenue] = useState('');
  const add = (name: string) => {
    const n = name.trim();
    if (!n || state.venues.some((v) => v.toLowerCase() === n.toLowerCase())) return;
    patch({ venues: [...state.venues, n] });
    setVenue('');
  };
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-fieldrow">
        <label className="sk-sp-field" data-grow="">
          <span className="sk-lab">Name</span>
          <input className="sk-input" value={state.name} placeholder="Annual Sports Meet 2026" onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="sk-sp-field"><span className="sk-lab">First day</span><input className="sk-input" type="date" value={state.startsOn} onChange={(e) => patch({ startsOn: e.target.value, endsOn: state.endsOn < e.target.value ? e.target.value : state.endsOn })} /></label>
        <label className="sk-sp-field"><span className="sk-lab">Last day</span><input className="sk-input" type="date" value={state.endsOn} min={state.startsOn} onChange={(e) => patch({ endsOn: e.target.value })} /></label>
        <label className="sk-sp-field"><span className="sk-lab">Day starts</span><input className="sk-input" type="time" value={minToHhmm(state.dayStartMin)} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) patch({ dayStartMin: m }); }} /></label>
        <label className="sk-sp-field"><span className="sk-lab">Day ends</span><input className="sk-input" type="time" value={minToHhmm(state.dayEndMin)} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) patch({ dayEndMin: m }); }} /></label>
      </div>
      <p className="sk-muted">{daysOf(state) > 0 ? `${daysOf(state)} day${daysOf(state) === 1 ? '' : 's'}, ${minToHhmm(state.dayStartMin)}–${minToHhmm(state.dayEndMin)} each day.` : 'Pick the days.'}</p>
      <div>
        <p className="sk-lab" style={{ marginBottom: 7 }}>Venues — every court, field, track or pool that runs at the same time</p>
        <div className="sk-sp-chips" style={{ marginBottom: 8 }}>
          {state.venues.map((v) => (
            <span key={v} className="sk-chip" aria-pressed="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {v}
              <button type="button" aria-label={`Remove ${v}`} onClick={() => patch({ venues: state.venues.filter((x) => x !== v) })} style={{ display: 'inline-flex', background: 'none', border: 0, cursor: 'pointer', color: 'inherit', padding: 0 }}><X size={12} /></button>
            </span>
          ))}
          {state.venues.length === 0 ? <span className="sk-muted">None yet.</span> : null}
        </div>
        <div className="sk-sp-fieldrow">
          <input className="sk-input" placeholder="Court 3" value={venue} aria-label="New venue" onChange={(e) => setVenue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(venue); } }} />
          <button type="button" className="sk-btn" onClick={() => add(venue)}>Add venue</button>
          <div className="sk-sp-chips">
            {QUICK_VENUES.filter((q) => !state.venues.includes(q)).map((q) => (
              <button key={q} type="button" className="sk-chip" onClick={() => add(q)}>+ {q}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SportsStep({ state, toggle }: { state: WizardState; toggle: (s: Sport) => void }) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(SCORING_PRESETS[0].key);
  const [team, setTeam] = useState(1);
  const picked = new Set(state.events.map((e) => e.sport.key));
  const addCustom = () => {
    const s = customSport(name, preset, team);
    if (!s) { toast.error('Give the sport a name.'); return; }
    if (!picked.has(s.key)) toggle(s);
    setName('');
  };
  return (
    <div className="sk-sp-stack">
      <p className="sk-muted">Press every sport in the meet. Each becomes an event on the next step; you can add a second group or category there.</p>
      {sportsByGroup().map((g) => (
        <div key={g.group} className="sk-sp-group">
          <p className="sk-lab">{g.group}</p>
          <div className="sk-sp-sportgrid">
            {g.sports.map((s) => (
              <button key={s.key} type="button" className="sk-sp-sport" aria-pressed={picked.has(s.key)} onClick={() => toggle(s)}>
                <span className="nm">{s.name}</span>
                <span className="meta">{s.kind === 'MATCH' ? (s.teamSize > 1 ? `Team of ${s.teamSize} · ${scoringWord(s)}` : scoringWord(s)) : s.kind === 'MEASURED' ? `${s.scoring.label} · ${s.lanes} per heat` : 'Judged'}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="sk-sp-group">
        <p className="sk-lab">Your own sport</p>
        <div className="sk-sp-fieldrow">
          <label className="sk-sp-field" data-grow=""><span className="sk-lab">Name</span><input className="sk-input" value={name} placeholder="Tug of war" onChange={(e) => setName(e.target.value)} /></label>
          <label className="sk-sp-field"><span className="sk-lab">Scored as</span>
            <select className="sk-input" value={preset} onChange={(e) => setPreset(e.target.value)}>{SCORING_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Players a side</span><input className="sk-input" type="number" min={1} max={20} value={team} style={{ width: '6em' }} onChange={(e) => setTeam(Number(e.target.value) || 1)} /></label>
          <button type="button" className="sk-btn" onClick={addCustom}>Add sport</button>
        </div>
        {state.events.filter((e) => e.sport.key.startsWith('custom:')).length ? (
          <div className="sk-sp-chips">{state.events.filter((e) => e.sport.key.startsWith('custom:')).map((e) => <span key={e.uid} className="sk-chip" aria-pressed="true">{e.sport.name}</span>)}</div>
        ) : null}
      </div>
    </div>
  );
}

function scoringWord(s: Sport): string {
  if (s.scoring.type === 'GAMES') return `Best of ${s.scoring.bestOf} to ${s.scoring.to}`;
  if (s.scoring.type === 'SINGLE') return `${s.scoring.label}, ${s.scoring.decider.toLowerCase()} if level`;
  return s.scoring.label;
}

function EventsStep({ state, groups, patchEvent, setState }: { state: WizardState; groups: { id: string; label: string }[]; patchEvent: (uid: string, p: Partial<WizardEvent>) => void; setState: (f: (s: WizardState) => WizardState) => void }) {
  if (state.events.length === 0) return <EmptyRow>No sport picked yet — go back a step and press a few.</EmptyRow>;
  return (
    <div className="sk-sp-stack">
      {state.events.map((ev) => (
        <div key={ev.uid} className="sk-sp-eventrow">
          <div className="sk-sp-eventhead">
            <span className="nm">{ev.sport.name}</span>
            <Pill tone="muted">{ev.sport.kind === 'MATCH' ? 'Matches' : ev.sport.kind === 'MEASURED' ? 'Heats' : 'Judged'}</Pill>
            <span className="sp" style={{ flex: 1 }} />
            <button type="button" className="sk-btn" data-size="sm" onClick={() => setState((s) => ({ ...s, events: [...s.events, { ...ev, uid: nextUid(), studentIds: [] }] }))}>+ Another group or category</button>
            <button type="button" className="sk-btn" data-size="sm" data-icon="" data-tone="bad" aria-label={`Remove ${ev.sport.name}`} onClick={() => setState((s) => ({ ...s, events: s.events.filter((e) => e.uid !== ev.uid) }))}><X size={14} /></button>
          </div>
          <div className="sk-sp-fieldrow">
            <div className="sk-sp-field"><span className="sk-lab">Group</span>
              <div className="sk-seg">{groups.map((g) => <button key={g.id} type="button" aria-pressed={ev.groupKey === g.id} onClick={() => patchEvent(ev.uid, { groupKey: g.id, studentIds: [] })}>{g.label}</button>)}</div>
            </div>
            <div className="sk-sp-field"><span className="sk-lab">Category</span>
              <div className="sk-seg">{SPORT_CATEGORIES.map((c) => <button key={c} type="button" aria-pressed={ev.category === c} onClick={() => patchEvent(ev.uid, { category: c as SportCategory, studentIds: [] })}>{c}</button>)}</div>
            </div>
            {ev.sport.kind === 'MATCH' ? (
              <div className="sk-sp-field"><span className="sk-lab">Structure</span>
                <div className="sk-seg">
                  <button type="button" aria-pressed={ev.structure === 'CLASS'} onClick={() => patchEvent(ev.uid, { structure: 'CLASS' })}>Class rounds → final</button>
                  <button type="button" aria-pressed={ev.structure === 'DRAW'} onClick={() => patchEvent(ev.uid, { structure: 'DRAW' })}>One draw</button>
                </div>
              </div>
            ) : null}
            <label className="sk-sp-field"><span className="sk-lab">Minutes a {ev.sport.kind === 'MATCH' ? 'match' : 'heat'}</span><input className="sk-input" type="number" min={5} max={240} value={ev.slotMin} style={{ width: '6em' }} onChange={(e) => patchEvent(ev.uid, { slotMin: Number(e.target.value) || ev.sport.slotMin })} /></label>
            {ev.sport.kind === 'MEASURED' ? <label className="sk-sp-field"><span className="sk-lab">Lanes</span><input className="sk-input" type="number" min={1} max={16} value={ev.lanes} style={{ width: '5em' }} onChange={(e) => patchEvent(ev.uid, { lanes: Number(e.target.value) || 6 })} /></label> : null}
          </div>
          <div className="sk-sp-field"><span className="sk-lab">Venues</span>
            <div className="sk-sp-chips">
              {state.venues.map((v, i) => (
                <button key={v} type="button" className="sk-chip" aria-pressed={ev.venueIdx.includes(i)} onClick={() => patchEvent(ev.uid, { venueIdx: ev.venueIdx.includes(i) ? ev.venueIdx.filter((x) => x !== i) : [...ev.venueIdx, i].sort() })}>{v}</button>
              ))}
              {state.venues.length === 0 ? <span className="sk-muted">Add venues on the first step.</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayersStep({ state, roster, grouping, bands, meetYear, patchEvent, loading }: { state: WizardState; roster: RosterStudent[]; grouping: 'BANDS' | 'AGE'; bands: SettingsView['bands']; meetYear: number; patchEvent: (uid: string, p: Partial<WizardEvent>) => void; loading: boolean }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q).trim().toLowerCase();
  if (loading) return <EmptyRow>Opening the roll…</EmptyRow>;
  if (state.events.length === 0) return <EmptyRow>No sport picked yet.</EmptyRow>;
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-fieldrow">
        <input className="sk-input" placeholder="Find a name…" aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sk-muted">{grouping === 'AGE' ? `Age groups as on 31 Dec ${meetYear}.` : 'Bands by class.'} Only children in the event’s group and category are listed.</span>
      </div>
      {state.events.map((ev) => {
        const pool = eligible(roster, ev, grouping, bands, meetYear);
        const shown = query ? pool.filter((s) => s.name.toLowerCase().includes(query)) : pool;
        const chosen = new Set(ev.studentIds);
        const byStd = new Map<number, RosterStudent[]>();
        for (const s of shown) byStd.set(s.std, [...(byStd.get(s.std) ?? []), s]);
        const team = sidesAreSections(ev.sport);
        const set = (ids: string[]) => patchEvent(ev.uid, { studentIds: ids });
        return (
          <div key={ev.uid} className="sk-sp-eventrow" data-bad={ev.sport.kind === 'MATCH' && sideCount(ev, roster) < 2}>
            <div className="sk-sp-eventhead">
              <span className="nm">{ev.sport.name}</span>
              <Pill tone="muted">{bands.find((b) => b.id === ev.groupKey)?.label ?? ev.groupKey} · {ev.category}</Pill>
              <span className="sp" style={{ flex: 1 }} />
              <span className="sk-muted">{team ? `${sideCount(ev, roster)} section${sideCount(ev, roster) === 1 ? '' : 's'} · ${ev.studentIds.length} players` : `${ev.studentIds.length} chosen`}</span>
              <button type="button" className="sk-btn" data-size="sm" onClick={() => set([...new Set([...ev.studentIds, ...pool.map((s) => s.id)])])}>Add everyone</button>
              <button type="button" className="sk-btn" data-size="sm" onClick={() => set([])}>Clear</button>
            </div>
            {team ? <p className="sk-muted">A team sport: sides are sections. Every section with at least one player entered is a team — enter the squad of each section.</p> : null}
            <div className="sk-sp-roster">
              {pool.length === 0 ? <EmptyRow>Nobody on the roll fits this group and category.</EmptyRow> : null}
              {[...byStd.entries()].sort((a, b) => a[0] - b[0]).map(([std, kids]) => (
                <div key={std}>
                  <div className="sk-sp-classhead">
                    Class {std}
                    <span style={{ flex: 1 }} />
                    <button type="button" className="sk-btn" data-size="sm" onClick={() => set([...new Set([...ev.studentIds, ...kids.map((s) => s.id)])])}>Add class {std}</button>
                  </div>
                  {kids.map((s) => (
                    <label key={s.id}>
                      <input type="checkbox" checked={chosen.has(s.id)} onChange={(e) => set(e.target.checked ? [...ev.studentIds, s.id] : ev.studentIds.filter((x) => x !== s.id))} />
                      {s.name}
                      <span className="meta">{s.std} {s.section}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewStep({ state, roster, issues, busy, onCreate }: { state: WizardState; roster: RosterStudent[]; issues: string[]; busy: boolean; onCreate: () => void }) {
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-kv">
        <div><span className="sk-lab">Meet</span><b>{state.name.trim() || '—'}</b></div>
        <div><span className="sk-lab">Days</span><b>{daysOf(state) || '—'}</b></div>
        <div><span className="sk-lab">Hours</span><b>{minToHhmm(state.dayStartMin)}–{minToHhmm(state.dayEndMin)}</b></div>
        <div><span className="sk-lab">Venues</span><b>{state.venues.join(', ') || '—'}</b></div>
      </div>
      <div className="sk-tblwrap">
        <table className="sk-tbl">
          <thead><tr><th>Event</th><th>Group · category</th><th>Structure</th><th>Venues</th><th>Entered</th></tr></thead>
          <tbody>
            {state.events.map((ev) => (
              <tr key={ev.uid}>
                <td>{ev.sport.name}</td>
                <td>{ev.groupKey} · {ev.category}</td>
                <td>{ev.sport.kind === 'MATCH' ? (ev.structure === 'CLASS' ? 'Class rounds → final' : 'One draw') : ev.sport.kind === 'MEASURED' ? `Heats of ${ev.lanes}` : 'One panel round'}</td>
                <td>{ev.venueIdx.map((i) => state.venues[i]).join(', ') || '—'}</td>
                <td>{sidesAreSections(ev.sport) ? `${sideCount(ev, roster)} sections` : `${ev.studentIds.length}`}</td>
              </tr>
            ))}
            {state.events.length === 0 ? <tr><td colSpan={5}><span className="sk-muted">No events.</span></td></tr> : null}
          </tbody>
        </table>
      </div>
      {issues.length ? (
        <div className="sk-notice"><div className="nt">Before you create</div><div className="nd">{issues.map((p) => <div key={p}>{p}</div>)}</div></div>
      ) : (
        <p className="sk-muted">Draws are made blind, byes go to the top of the draw, and every match and heat gets a venue and a time. You can still delete a draft and start again.</p>
      )}
      <div>
        <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={issues.length > 0 || busy} onClick={onCreate}>{busy ? 'Creating…' : 'Create tournament'}</button>
      </div>
    </div>
  );
}

'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { SCORING_PRESETS, SPORT_CATEGORIES, VENUE_TYPES, VENUE_TYPE_LABEL, customSport, sportsByGroup, type Sport, type SportCategory, type TeamBasis, type VenueType } from '@skoolos/types';
import { Card, CardBody, CardHead, EmptyRow, Pill, useDebounced, useDesk, type RosterStudent, type SettingsView } from './ui';
import {
  TEAM_BASIS_WORD, basisOf, daysOf, eligible, emptyState, fixBasis, groupOptions, hhmmToMin, isTeam, lineLabel, makeVenue, meetYearOf, minToHhmm, problems, resolved, sideCount, singleSectionClasses, teamCounts, toDto, toggleSport,
  type WizardEvent, type WizardState,
} from './wizard-model';

const STEPS = ['The meet', 'Sports & events', 'Players', 'Review & create'];
const QUICK_VENUES = ['Court 1', 'Court 2', 'Field', 'Track', 'Pool', 'Hall', 'Table 1'];
const BASIS_LABEL: Record<TeamBasis, string> = { SECTIONS: 'Sections (9 A v 9 B)', CLASSES: 'Classes (9 v 10)', HOUSES: 'Houses' };

/**
 * Four steps, one POST. The defaults bar decides what nearly every event
 * shares; pressing a sport IS creating its events; venues bind from the
 * sport; players are ticked once against every event of a group; a team
 * sport says what a team is. Everything is checked as you go (`problems`), so
 * Create is never a surprise, and the whole meet is one transaction on the
 * API — with every child's diary kept clear.
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
  const bands = useMemo(() => settings.data?.bands ?? [], [settings.data]);
  const groups = useMemo(() => groupOptions(grouping, bands), [grouping, bands]);
  const meetYear = meetYearOf(state.startsOn);
  const rosterRows = roster.data ?? [];
  // the defaults bar's group is the first group until the office picks one
  const st = state.defaults.groupKey || !groups.length ? state : { ...state, defaults: { ...state.defaults, groupKey: groups[0].id } };
  const issues = problems(st, rosterRows, groups);

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; days: number; daysNeeded: number; warnings: string[] }>('/sports/tournaments', toDto(st, rosterRows)),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sports-tournaments'] });
      toast.success('Tournament created — every match and heat has a venue and a time, and nobody is in two places at once.');
      for (const w of r.warnings) toast.warning(w, { duration: 9000 });
      router.push(`${base}/tournaments/${r.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));
  const patchEvent = (uid: string, p: Partial<WizardEvent>) => setState((s) => ({ ...s, events: s.events.map((e) => (e.uid === uid ? { ...e, ...p } : e)) }));

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
        {step === 0 ? <MeetStep state={st} patch={patch} /> : null}
        {step === 1 ? <SportsStep state={st} groups={groups} patch={patch} patchEvent={patchEvent} /> : null}
        {step === 2 ? <PlayersStep state={st} roster={rosterRows} grouping={grouping} bands={bands} meetYear={meetYear} groups={groups} patchEvent={patchEvent} loading={roster.isLoading} /> : null}
        {step === 3 ? <ReviewStep state={st} roster={rosterRows} groups={groups} issues={issues} busy={create.isPending} onCreate={() => create.mutate()} /> : null}
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

function VenueChips({ state, patch }: { state: WizardState; patch: (p: Partial<WizardState>) => void }) {
  const cycle = (i: number) => {
    const v = state.venues[i];
    const next = VENUE_TYPES[(VENUE_TYPES.indexOf(v.type) + 1) % VENUE_TYPES.length];
    patch({ venues: state.venues.map((x, j) => (j === i ? { ...x, type: next } : x)) });
  };
  return (
    <div className="sk-sp-chips">
      {state.venues.map((v, i) => (
        <span key={v.name} className="sk-chip" aria-pressed="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {v.name}
          <button type="button" className="sk-sp-vbadge" title="Press to change the type" aria-label={`${v.name}: ${VENUE_TYPE_LABEL[v.type]}, press to change`} onClick={() => cycle(i)} style={{ border: 0, cursor: 'pointer', font: 'inherit', fontSize: 10 }}>{v.type}</button>
          <button type="button" aria-label={`Remove ${v.name}`} onClick={() => patch({ venues: state.venues.filter((x) => x.name !== v.name) })} style={{ display: 'inline-flex', background: 'none', border: 0, cursor: 'pointer', color: 'inherit', padding: 0 }}><X size={12} /></button>
        </span>
      ))}
      {state.venues.length === 0 ? <span className="sk-muted">None yet.</span> : null}
    </div>
  );
}

function MeetStep({ state, patch }: { state: WizardState; patch: (p: Partial<WizardState>) => void }) {
  const [venue, setVenue] = useState('');
  const add = (name: string) => {
    const n = name.trim();
    if (!n || state.venues.some((v) => v.name.toLowerCase() === n.toLowerCase())) return;
    patch({ venues: [...state.venues, makeVenue(n)] });
    setVenue('');
  };
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-fieldrow">
        <label className="sk-sp-field" data-grow=""><span className="sk-lab">Name</span><input className="sk-input" value={state.name} placeholder="Annual Sports Meet 2026" onChange={(e) => patch({ name: e.target.value })} /></label>
        <label className="sk-sp-field"><span className="sk-lab">First day</span><input className="sk-input" type="date" value={state.startsOn} onChange={(e) => patch({ startsOn: e.target.value, endsOn: state.endsOn < e.target.value ? e.target.value : state.endsOn })} /></label>
        <label className="sk-sp-field"><span className="sk-lab">Last day</span><input className="sk-input" type="date" value={state.endsOn} min={state.startsOn} onChange={(e) => patch({ endsOn: e.target.value })} /></label>
        <label className="sk-sp-field"><span className="sk-lab">Day starts</span><input className="sk-input" type="time" value={minToHhmm(state.dayStartMin)} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) patch({ dayStartMin: m }); }} /></label>
        <label className="sk-sp-field"><span className="sk-lab">Day ends</span><input className="sk-input" type="time" value={minToHhmm(state.dayEndMin)} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) patch({ dayEndMin: m }); }} /></label>
        <label className="sk-sp-field"><span className="sk-lab">Rest between a child’s slots</span><input className="sk-input" type="number" min={0} max={120} value={state.restMin} style={{ width: '6em' }} onChange={(e) => patch({ restMin: Math.max(0, Number(e.target.value) || 0) })} /></label>
      </div>
      <p className="sk-muted">{daysOf(state) > 0 ? `${daysOf(state)} day${daysOf(state) === 1 ? '' : 's'}, ${minToHhmm(state.dayStartMin)}–${minToHhmm(state.dayEndMin)} each day. A child gets ${state.restMin} minutes between two of their own slots.` : 'Pick the days.'}</p>
      <div className="sk-sp-field">
        <span className="sk-lab">Venues — every court, field, track, table or hall that runs at the same time. The type is read from the name; press it to change.</span>
        <VenueChips state={state} patch={patch} />
        <div className="sk-sp-fieldrow">
          <input className="sk-input" placeholder="Badminton court 3" value={venue} aria-label="New venue" onChange={(e) => setVenue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(venue); } }} />
          <button type="button" className="sk-btn" onClick={() => add(venue)}>Add venue</button>
          <div className="sk-sp-chips">{QUICK_VENUES.filter((q) => !state.venues.some((v) => v.name === q)).map((q) => <button key={q} type="button" className="sk-chip" onClick={() => add(q)}>+ {q}</button>)}</div>
        </div>
        <p className="sk-muted">Name a venue after a sport — “Badminton court 3”, “TT table” — and only that sport takes it.</p>
      </div>
    </div>
  );
}

function VenueBadge({ how }: { how: 'named' | 'type' | 'fallback' | 'none' | 'chosen' }) {
  if (how === 'type') return null;
  const tone = how === 'named' || how === 'chosen' ? 'good' : how === 'fallback' ? 'warn' : 'bad';
  return <span className="sk-sp-vbadge" data-tone={tone}>{how === 'none' ? 'no venue' : how}</span>;
}

function SportsStep({ state, groups, patch, patchEvent }: { state: WizardState; groups: { id: string; label: string }[]; patch: (p: Partial<WizardState>) => void; patchEvent: (uid: string, p: Partial<WizardEvent>) => void }) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [custom, setCustom] = useState({ name: '', preset: SCORING_PRESETS[0].key, team: 1, venue: 'hall' as VenueType });
  const query = useDebounced(q).trim().toLowerCase();
  const picked = new Set(state.events.map((e) => e.sport.key));
  const setDefaults = (p: Partial<WizardState['defaults']>) => patch({ defaults: { ...state.defaults, ...p } });
  const toggleCat = (c: SportCategory) => {
    const cats = state.defaults.categories.includes(c) ? state.defaults.categories.filter((x) => x !== c) : [...state.defaults.categories, c];
    if (!cats.length) return;
    setDefaults({ categories: cats });
  };
  const addCustom = () => {
    const s = customSport(custom.name, custom.preset, custom.team, custom.venue);
    if (!s) { toast.error('Give the sport a name.'); return; }
    if (!picked.has(s.key)) patch(toggleSport(state, s));
    setCustom({ ...custom, name: '' });
  };
  const editingEv = state.events.find((e) => e.uid === editing) ?? null;
  const bad = state.events.filter((e) => resolved(state, e).venues.idx.length === 0).length;
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-defaults">
        <div className="sk-sp-field"><span className="sk-lab">Group for every event</span><div className="sk-seg">{groups.map((g) => <button key={g.id} type="button" aria-pressed={state.defaults.groupKey === g.id} onClick={() => setDefaults({ groupKey: g.id })}>{g.label}</button>)}</div></div>
        <div className="sk-sp-field"><span className="sk-lab">Run each sport for</span><div className="sk-sp-chips">{SPORT_CATEGORIES.map((c) => <button key={c} type="button" className="sk-chip" aria-pressed={state.defaults.categories.includes(c)} onClick={() => toggleCat(c)}>{c}</button>)}</div></div>
        <div className="sk-sp-field"><span className="sk-lab">Match sports play</span><div className="sk-seg"><button type="button" aria-pressed={state.defaults.structure === 'CLASS'} onClick={() => setDefaults({ structure: 'CLASS' })}>Class rounds → final</button><button type="button" aria-pressed={state.defaults.structure === 'DRAW'} onClick={() => setDefaults({ structure: 'DRAW' })}>One draw</button></div></div>
        <div className="sk-sp-field"><span className="sk-lab">Minutes and lanes</span><span className="sk-muted">From the catalogue per sport. Change on a line only if you must.</span></div>
      </div>

      <div className="sk-sp-field">
        <div className="sk-sp-fieldrow"><span className="sk-lab">Sports — press to add, press again to remove</span><input className="sk-input" placeholder="Find a sport…" aria-label="Find a sport" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} /></div>
        {sportsByGroup().map((g) => {
          const list = query ? g.sports.filter((s) => s.name.toLowerCase().includes(query)) : g.sports;
          if (!list.length) return null;
          return (
            <div key={g.group} className="sk-sp-chips" style={{ alignItems: 'center' }}>
              <span className="sk-lab" style={{ minWidth: 86 }}>{g.group}</span>
              {list.map((s) => <button key={s.key} type="button" className="sk-chip" aria-pressed={picked.has(s.key)} onClick={() => { patch(toggleSport(state, s)); }}>{s.name}</button>)}
            </div>
          );
        })}
      </div>

      <div className="sk-tblwrap">
        <table className="sk-tbl sk-sp-evtable">
          <thead><tr><th>Event</th><th>Group · category</th><th>Plays as</th><th>Venues</th><th>Min</th><th></th></tr></thead>
          <tbody>
            {state.events.length === 0 ? <tr><td colSpan={6}><span className="sk-muted">Press a sport above — every line it needs is filled in from the defaults.</span></td></tr> : null}
            {state.events.map((ev) => {
              const r = resolved(state, ev);
              return (
                <tr key={ev.uid} data-bad={r.venues.idx.length === 0}>
                  <td className="nm">{ev.sport.name} <span className="sk-muted">{ev.sport.kind === 'MEASURED' ? 'heats' : ev.sport.kind === 'JUDGED' ? 'judged' : isTeam(ev) ? 'team' : 'matches'}</span></td>
                  <td>{groups.find((g) => g.id === r.group)?.label ?? '—'} · {ev.category}</td>
                  <td>{ev.sport.kind === 'MEASURED' ? `Heats of ${r.lanes}` : ev.sport.kind === 'JUDGED' ? 'One panel round' : r.structure === 'CLASS' ? 'Class rounds → final' : 'One draw'}</td>
                  <td>{r.venues.idx.map((i) => state.venues[i]?.name).filter(Boolean).join(', ') || <span className="sk-muted">add a {r.venues.want}</span>}<VenueBadge how={r.venues.how} /></td>
                  <td className="mono">{r.slotMin}</td>
                  <td><button type="button" className="sk-btn" data-size="sm" aria-pressed={editing === ev.uid} onClick={() => setEditing(editing === ev.uid ? null : ev.uid)}>Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="sk-muted">{state.events.length} event{state.events.length === 1 ? '' : 's'} from {picked.size} sport{picked.size === 1 ? '' : 's'}{bad ? ` · ${bad} without a venue — add one on step 1 or tick a venue with Edit` : ''}</p>

      {editingEv ? (
        <div className="sk-sp-scorebox" role="region" aria-label={`Edit ${lineLabel(editingEv)}`}>
          <div className="sk-sp-eventhead"><span className="nm">{lineLabel(editingEv)}</span><Pill tone="muted">exception to the defaults</Pill><span style={{ flex: 1 }} /><button type="button" className="sk-btn" data-size="sm" onClick={() => setEditing(null)}>Done</button></div>
          <div className="sk-sp-fieldrow">
            <div className="sk-sp-field"><span className="sk-lab">Group</span><div className="sk-seg">{groups.map((g) => <button key={g.id} type="button" aria-pressed={resolved(state, editingEv).group === g.id} onClick={() => patchEvent(editingEv.uid, { groupKey: g.id, studentIds: [] })}>{g.label}</button>)}</div></div>
            {editingEv.sport.kind === 'MATCH' ? <div className="sk-sp-field"><span className="sk-lab">Plays as</span><div className="sk-seg"><button type="button" aria-pressed={resolved(state, editingEv).structure === 'CLASS'} onClick={() => patchEvent(editingEv.uid, { structure: 'CLASS' })}>Class rounds → final</button><button type="button" aria-pressed={resolved(state, editingEv).structure === 'DRAW'} onClick={() => patchEvent(editingEv.uid, { structure: 'DRAW' })}>One draw</button></div></div> : null}
            <label className="sk-sp-field"><span className="sk-lab">Minutes</span><input className="sk-input" type="number" min={5} max={240} value={resolved(state, editingEv).slotMin} style={{ width: '6em' }} onChange={(e) => patchEvent(editingEv.uid, { slotMin: Number(e.target.value) || undefined })} /></label>
            {editingEv.sport.kind === 'MEASURED' ? <label className="sk-sp-field"><span className="sk-lab">Lanes</span><input className="sk-input" type="number" min={1} max={16} value={resolved(state, editingEv).lanes} style={{ width: '5em' }} onChange={(e) => patchEvent(editingEv.uid, { lanes: Number(e.target.value) || undefined })} /></label> : null}
          </div>
          <div className="sk-sp-field"><span className="sk-lab">Venues for this event</span>
            <div className="sk-sp-chips">
              {state.venues.map((v, i) => { const on = resolved(state, editingEv).venues.idx.includes(i); return <button key={v.name} type="button" className="sk-chip" aria-pressed={on} onClick={() => { const cur = new Set(resolved(state, editingEv).venues.idx); on ? cur.delete(i) : cur.add(i); patchEvent(editingEv.uid, { venueIdx: [...cur].sort((a, b) => a - b) }); }}>{v.name}</button>; })}
              {editingEv.venueIdx ? <button type="button" className="sk-btn" data-size="sm" onClick={() => patchEvent(editingEv.uid, { venueIdx: undefined })}>Back to the sport’s own</button> : null}
            </div>
          </div>
          <div className="sk-sp-actions"><button type="button" className="sk-btn" data-size="sm" data-icon="" data-tone="bad" onClick={() => { patch({ events: state.events.filter((e) => e.uid !== editingEv.uid) }); setEditing(null); }}>Remove this line</button></div>
        </div>
      ) : null}

      <div className="sk-sp-group">
        <p className="sk-lab">Your own sport</p>
        <div className="sk-sp-fieldrow">
          <label className="sk-sp-field" data-grow=""><span className="sk-lab">Name</span><input className="sk-input" value={custom.name} placeholder="Tug of war" onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></label>
          <label className="sk-sp-field"><span className="sk-lab">Scored as</span><select className="sk-input" value={custom.preset} onChange={(e) => setCustom({ ...custom, preset: e.target.value })}>{SCORING_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
          <label className="sk-sp-field"><span className="sk-lab">Players a side</span><input className="sk-input" type="number" min={1} max={20} value={custom.team} style={{ width: '6em' }} onChange={(e) => setCustom({ ...custom, team: Number(e.target.value) || 1 })} /></label>
          <label className="sk-sp-field"><span className="sk-lab">Played on</span><select className="sk-input" value={custom.venue} onChange={(e) => setCustom({ ...custom, venue: e.target.value as VenueType })}>{VENUE_TYPES.map((t) => <option key={t} value={t}>{VENUE_TYPE_LABEL[t]}</option>)}</select></label>
          <button type="button" className="sk-btn" onClick={addCustom}>Add sport</button>
        </div>
      </div>
    </div>
  );
}

function PlayersStep({ state, roster, grouping, bands, meetYear, groups, patchEvent, loading }: { state: WizardState; roster: RosterStudent[]; grouping: 'BANDS' | 'AGE'; bands: SettingsView['bands']; meetYear: number; groups: { id: string; label: string }[]; patchEvent: (uid: string, p: Partial<WizardEvent>) => void; loading: boolean }) {
  const [q, setQ] = useState('');
  const query = useDebounced(q).trim().toLowerCase();
  const pairs = useMemo(() => {
    const seen = new Map<string, { groupKey: string; category: SportCategory; events: WizardEvent[] }>();
    for (const ev of state.events) { const g = resolved(state, ev).group; const k = `${g}|${ev.category}`; const cur = seen.get(k) ?? { groupKey: g, category: ev.category, events: [] }; cur.events.push(ev); seen.set(k, cur); }
    return [...seen.values()];
  }, [state]);
  const [pairKey, setPairKey] = useState<string | null>(null);
  const pair = pairs.find((p) => `${p.groupKey}|${p.category}` === pairKey) ?? pairs[0];
  if (loading) return <EmptyRow>Opening the roll…</EmptyRow>;
  if (!pair) return <EmptyRow>No sport picked yet — go back a step and press a few.</EmptyRow>;
  const pool = eligible(roster, pair.groupKey, pair.category, grouping, bands, meetYear);
  const shown = query ? pool.filter((s) => s.name.toLowerCase().includes(query)) : pool;
  const byStd = new Map<number, RosterStudent[]>();
  for (const s of shown) byStd.set(s.std, [...(byStd.get(s.std) ?? []), s]);
  const set = (ev: WizardEvent, ids: string[]) => patchEvent(ev.uid, { studentIds: ids });
  const tick = (ev: WizardEvent, id: string, on: boolean) => set(ev, on ? [...new Set([...ev.studentIds, id])] : ev.studentIds.filter((x) => x !== id));
  const teamEvents = pair.events.filter((e) => isTeam(e));
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-fieldrow">
        {pairs.length > 1 ? <div className="sk-seg">{pairs.map((p) => { const k = `${p.groupKey}|${p.category}`; return <button key={k} type="button" aria-pressed={pair === p} onClick={() => setPairKey(k)}>{groups.find((g) => g.id === p.groupKey)?.label ?? p.groupKey} · {p.category}</button>; })}</div> : <Pill tone="brand">{groups.find((g) => g.id === pair.groupKey)?.label ?? pair.groupKey} · {pair.category}</Pill>}
        <input className="sk-input" placeholder="Find a name…" aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sk-muted">{grouping === 'AGE' ? `Age groups as on 31 Dec ${meetYear}.` : 'Bands by class.'} Tick a child once per event; a team sport enters their whole side.</span>
      </div>
      <div className="sk-tblwrap">
        <table className="sk-tbl sk-sp-matrix">
          <thead>
            <tr>
              <th>Child</th>
              {pair.events.map((ev) => <th key={ev.uid}>{ev.sport.name}<br /><span className="sk-muted" style={{ fontWeight: 400 }}>{ev.studentIds.length} entered</span></th>)}
              <th>All</th>
            </tr>
          </thead>
          <tbody>
            {pool.length === 0 ? <tr><td colSpan={pair.events.length + 2}><span className="sk-muted">Nobody on the roll fits this group and category.</span></td></tr> : null}
            {[...byStd.entries()].sort((a, b) => a[0] - b[0]).map(([std, kids]) => (
              <FragmentRows key={std} std={std} kids={kids} events={pair.events} set={set} tick={tick} />
            ))}
          </tbody>
        </table>
      </div>
      {teamEvents.map((ev) => {
        const basis = basisOf(ev, roster);
        const counts = teamCounts(ev, roster);
        const n = counts[basis];
        const fix = fixBasis(ev, roster);
        const walkovers = basis === 'SECTIONS' && resolved(state, ev).structure === 'CLASS' ? singleSectionClasses(ev, roster) : [];
        const shortOf = `Only ${n} team${n === 1 ? '' : 's'} under ${TEAM_BASIS_WORD[basis]}`;
        return (
          <div key={ev.uid} className="sk-sp-field">
            <span className="sk-lab">{ev.sport.name} · {ev.category} — a team is</span>
            <div className="sk-sp-chips">
              {(['SECTIONS', 'CLASSES', 'HOUSES'] as TeamBasis[]).map((b) => (
                <button key={b} type="button" className="sk-chip" aria-pressed={basis === b} onClick={() => patchEvent(ev.uid, { teamBasis: b })}>
                  {`${BASIS_LABEL[b]}${!ev.teamBasis && basis === b ? ' · suggested' : ''}${ev.studentIds.length ? ` · ${counts[b]}` : ''}`}
                </button>
              ))}
            </div>
            {ev.studentIds.length === 0 ? <p className="sk-sp-problem"><span>⚠</span><span>Tick the players first — every child of a section, class or house you tick makes that team.</span></p>
              : n < 2 ? (
                <p className="sk-sp-problem"><span>⚠</span><span>
                  <b>{shortOf}</b>{fix ? '. ' : ', so there is nobody to play. Tick children from another class or section, or put them in houses first.'}
                  {fix ? <button type="button" className="sk-btn" data-size="sm" onClick={() => patchEvent(ev.uid, { teamBasis: fix })}>{`Make the teams ${TEAM_BASIS_WORD[fix]}`}</button> : null}
                </span></p>
              ) : (
                <p className="sk-sp-problem" data-ok="true"><span>✓</span><span>
                  <b>{`${n} teams from ${ev.studentIds.length} players`}</b>{` under ${TEAM_BASIS_WORD[basis]}.`}
                  {walkovers.length ? ` Class${walkovers.length > 1 ? 'es' : ''} ${walkovers.join(', ')} ha${walkovers.length > 1 ? 've' : 's'} one section, so ${walkovers.length > 1 ? 'they walk' : 'it walks'} over into the final.` : ''}
                </span></p>
              )}
          </div>
        );
      })}
    </div>
  );
}

function FragmentRows({ std, kids, events, set, tick }: { std: number; kids: RosterStudent[]; events: WizardEvent[]; set: (ev: WizardEvent, ids: string[]) => void; tick: (ev: WizardEvent, id: string, on: boolean) => void }) {
  return (
    <>
      <tr className="cls"><td>Class {std}</td>{events.map((ev) => <td key={ev.uid}><button type="button" className="sk-btn" data-size="sm" onClick={() => set(ev, [...new Set([...ev.studentIds, ...kids.map((k) => k.id)])])}>Enter class {std}</button></td>)}<td /></tr>
      {kids.map((s) => {
        const n = events.filter((ev) => ev.studentIds.includes(s.id)).length;
        const all = n === events.length;
        return (
          <tr key={s.id}>
            <td>{s.name} <span className="sk-muted">{s.std} {s.section}</span>{n > 3 ? <Pill tone="amber">{n} events</Pill> : null}</td>
            {events.map((ev) => <td key={ev.uid}><input type="checkbox" aria-label={`${s.name} in ${ev.sport.name} ${ev.category}`} checked={ev.studentIds.includes(s.id)} onChange={(e) => tick(ev, s.id, e.target.checked)} /></td>)}
            <td><button type="button" className="sk-chip" onClick={() => events.forEach((ev) => tick(ev, s.id, !all))}>{all ? 'None' : 'All'}</button></td>
          </tr>
        );
      })}
    </>
  );
}

function ReviewStep({ state, roster, groups, issues, busy, onCreate }: { state: WizardState; roster: RosterStudent[]; groups: { id: string; label: string }[]; issues: string[]; busy: boolean; onCreate: () => void }) {
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-kv">
        <div><span className="sk-lab">Meet</span><b>{state.name.trim() || '—'}</b></div>
        <div><span className="sk-lab">Days</span><b>{daysOf(state) || '—'}</b></div>
        <div><span className="sk-lab">Hours</span><b>{minToHhmm(state.dayStartMin)}–{minToHhmm(state.dayEndMin)}</b></div>
        <div><span className="sk-lab">Rest gap</span><b>{state.restMin} min</b></div>
        <div><span className="sk-lab">Venues</span><b>{state.venues.map((v) => v.name).join(', ') || '—'}</b></div>
      </div>
      <div className="sk-tblwrap">
        <table className="sk-tbl">
          <thead><tr><th>Event</th><th>Group · category</th><th>Plays as</th><th>Teams</th><th>Venues</th><th>Entered</th></tr></thead>
          <tbody>
            {state.events.map((ev) => { const r = resolved(state, ev); return (
              <tr key={ev.uid}>
                <td>{ev.sport.name}</td>
                <td>{groups.find((g) => g.id === r.group)?.label ?? r.group} · {ev.category}</td>
                <td>{ev.sport.kind === 'MATCH' ? (r.structure === 'CLASS' ? 'Class rounds → final' : 'One draw') : ev.sport.kind === 'MEASURED' ? `Heats of ${r.lanes}` : 'One panel round'}</td>
                <td>{isTeam(ev) ? BASIS_LABEL[basisOf(ev, roster)] : '—'}</td>
                <td>{r.venues.idx.map((i) => state.venues[i]?.name).join(', ') || '—'}</td>
                <td>{isTeam(ev) ? `${sideCount(ev, roster)} teams · ${ev.studentIds.length} players` : `${ev.studentIds.length}`}</td>
              </tr>
            ); })}
            {state.events.length === 0 ? <tr><td colSpan={6}><span className="sk-muted">No events.</span></td></tr> : null}
          </tbody>
        </table>
      </div>
      {issues.length ? (
        <div className="sk-notice"><div className="nt">Before you create</div><div className="nd">{issues.map((p) => <div key={p}>{p}</div>)}</div></div>
      ) : (
        <p className="sk-muted">Draws are made blind, byes go to the top of the draw, every match and heat gets a venue and a time, and no child is booked in two places at once. You can still delete a draft and start again.</p>
      )}
      <div>
        <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={issues.length > 0 || busy} onClick={onCreate}>{busy ? 'Creating…' : 'Create tournament'}</button>
      </div>
    </div>
  );
}

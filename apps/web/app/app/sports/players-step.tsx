'use client';
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { SportCategory, StageShape, TeamBasis } from '@skoolos/types';
import { EmptyRow, Pill, dayOfMeet, useDebounced, type RosterStudent, type SettingsView } from './ui';
import {
  TEAM_BASIS_WORD, basisOf, costOf, daysOf, eligible, fixBasis, funnelOf, isTeam, resolved, singleSectionClasses, teamCounts,
  type WizardEvent, type WizardState,
} from './wizard-model';

const BASIS_LABEL: Record<TeamBasis, string> = { SECTIONS: 'Sections (9 A v 9 B)', CLASSES: 'Classes (9 v 10)', HOUSES: 'Houses' };
const SHAPES: { id: StageShape; label: string; note: string }[] = [
  { id: 'CLASS_QUAL', label: 'Class heats first', note: 'Every class races its own heats; the best of each class meet in the band final. Fairest when a whole year group enters.' },
  { id: 'OPEN_QUAL', label: 'Open qualifying', note: 'Everyone races mixed heats; the fastest marks go through, whatever class they came from.' },
  { id: 'STRAIGHT', label: 'Heats → final', note: 'One round of heats, then a final of the fastest. Best for a small field.' },
];

type Pair = { groupKey: string; category: SportCategory; events: WizardEvent[] };

/**
 * Who is in. A meet of 1,800 children is entered here, so nothing on this
 * screen asks for one tick per child unless the office wants one: classes
 * arrive shut, a chip enters a whole class in a sport, and the bar at the top
 * enters everybody eligible. The cost line under it answers the only question
 * that mass entry raises — whether the days and courts hold what was just
 * entered — and the funnel card says how a field of hundreds narrows to a
 * final before anyone runs.
 */
export function PlayersStep({ state, roster, grouping, bands, meetYear, groups, patch, patchEvent, patchAll, loading }: {
  state: WizardState; roster: RosterStudent[]; grouping: 'BANDS' | 'AGE'; bands: SettingsView['bands']; meetYear: number;
  groups: { id: string; label: string }[];
  patch: (p: Partial<WizardState>) => void;
  patchEvent: (uid: string, p: Partial<WizardEvent>) => void;
  patchAll: (map: (ev: WizardEvent) => Partial<WizardEvent> | null) => void;
  loading: boolean;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const query = useDebounced(q).trim().toLowerCase();
  const pairs = useMemo(() => {
    const seen = new Map<string, Pair>();
    for (const ev of state.events) {
      const g = resolved(state, ev).group;
      const k = `${g}|${ev.category}`;
      const cur = seen.get(k) ?? { groupKey: g, category: ev.category, events: [] };
      cur.events.push(ev);
      seen.set(k, cur);
    }
    return [...seen.values()];
  }, [state]);
  const [pairKey, setPairKey] = useState<string | null>(null);
  const pair = pairs.find((p) => `${p.groupKey}|${p.category}` === pairKey) ?? pairs[0];

  const pool = useMemo(
    () => (pair ? eligible(roster, pair.groupKey, pair.category, grouping, bands, meetYear) : []),
    [pair, roster, grouping, bands, meetYear],
  );
  const classes = useMemo(() => {
    const byStd = new Map<number, RosterStudent[]>();
    for (const s of pool) byStd.set(s.std, [...(byStd.get(s.std) ?? []), s]);
    return [...byStd.entries()].sort((a, b) => a[0] - b[0]).map(([std, kids]) => ({ std, kids }));
  }, [pool]);

  if (loading) return <EmptyRow>Opening the roll…</EmptyRow>;
  if (!pair) return <EmptyRow>No sport picked yet — go back a step and press a few.</EmptyRow>;

  const groupLabel = (k: string) => groups.find((g) => g.id === k)?.label ?? k;
  const set = (ev: WizardEvent, ids: string[]) => patchEvent(ev.uid, { studentIds: ids });
  const tick = (ev: WizardEvent, id: string, on: boolean) => set(ev, on ? [...new Set([...ev.studentIds, id])] : ev.studentIds.filter((x) => x !== id));
  const add = (ev: WizardEvent, ids: string[]) => set(ev, [...new Set([...ev.studentIds, ...ids])]);
  const drop = (ev: WizardEvent, ids: string[]) => { const gone = new Set(ids); return set(ev, ev.studentIds.filter((x) => !gone.has(x))); };
  const enteredIn = (ev: WizardEvent, kids: RosterStudent[]) => kids.reduce((a, k) => a + (ev.studentIds.includes(k.id) ? 1 : 0), 0);
  const poolIds = pool.map((s) => s.id);

  /** Every eligible child of every group and category, into every event of theirs. */
  const enterEverybody = () => patchAll((ev) => {
    const r = resolved(state, ev);
    const ids = eligible(roster, r.group, ev.category, grouping, bands, meetYear).map((s) => s.id);
    return { studentIds: [...new Set([...ev.studentIds, ...ids])] };
  });

  const entered = pair.events.reduce((a, ev) => a + ev.studentIds.length, 0);
  const teamEvents = pair.events.filter((e) => isTeam(e));
  const measured = pair.events.filter((e) => e.sport.kind === 'MEASURED');

  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-fieldrow">
        {pairs.length > 1
          ? <div className="sk-seg">{pairs.map((p) => { const k = `${p.groupKey}|${p.category}`; return <button key={k} type="button" aria-pressed={pair === p} onClick={() => { setPairKey(k); setOpen(new Set()); }}>{groupLabel(p.groupKey)} · {p.category}</button>; })}</div>
          : <Pill tone="brand">{groupLabel(pair.groupKey)} · {pair.category}</Pill>}
        <input className="sk-input" placeholder="Find a name…" aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="sk-muted">{grouping === 'AGE' ? `Age groups as on 31 Dec ${meetYear}.` : 'Bands by class.'} {pool.length} children fit this group.</span>
      </div>

      <CostLine state={state} roster={roster} patch={patch} />

      <div className="sk-sp-mass">
        <span className="sk-lab">Enter every child of every class</span>
        <div className="sk-sp-chips">
          {pair.events.map((ev) => {
            const all = pool.length > 0 && enteredIn(ev, pool) === pool.length;
            return (
              <button key={ev.uid} type="button" className="sk-chip" aria-pressed={all} onClick={() => (all ? drop(ev, poolIds) : add(ev, poolIds))}>
                {all ? `Take all out of ${ev.sport.name}` : `All ${pool.length} into ${ev.sport.name}`}
              </button>
            );
          })}
          {pair.events.length > 1 ? (
            <button type="button" className="sk-chip" data-strong="true" onClick={() => pair.events.forEach((ev) => add(ev, poolIds))}>
              All {pool.length} into every one of the {pair.events.length} events
            </button>
          ) : null}
          {pairs.length > 1 ? (
            <button type="button" className="sk-chip" data-strong="true" onClick={enterEverybody}>
              Every eligible child into all {state.events.length} events of the meet
            </button>
          ) : null}
          {entered > 0 ? <button type="button" className="sk-btn" data-size="sm" data-tone="bad" onClick={() => pair.events.forEach((ev) => set(ev, []))}>Clear this group</button> : null}
        </div>
        <span className="sk-muted">A team sport enters the whole side; an athletics event enters each child on their own. You can still untick anybody below.</span>
      </div>

      <div className="sk-sp-classlist">
        <div className="sk-sp-classbar">
          <b>{classes.length} class{classes.length === 1 ? '' : 'es'}</b>
          <span className="sk-muted">{pool.length} children on the roll · {entered} entries so far</span>
          <span className="sp" />
          <button type="button" className="sk-btn" data-size="sm" onClick={() => setOpen(open.size ? new Set() : new Set(classes.map((c) => c.std)))}>{open.size ? 'Shut every class' : 'Open every class'}</button>
        </div>
        {classes.length === 0 ? <p className="sk-state">Nobody on the roll fits this group and category.</p> : null}
        {classes.map(({ std, kids }) => (
          <ClassRow
            key={std} std={std} kids={kids} events={pair.events} query={query}
            open={open.has(std) || (!!query && kids.some((k) => k.name.toLowerCase().includes(query)))}
            onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(std)) n.delete(std); else n.add(std); return n; })}
            enteredIn={enteredIn} add={add} drop={drop} tick={tick}
          />
        ))}
      </div>

      {measured.map((ev) => <StageCard key={ev.uid} state={state} ev={ev} roster={roster} patchEvent={patchEvent} />)}
      {teamEvents.map((ev) => <TeamCard key={ev.uid} state={state} ev={ev} roster={roster} patchEvent={patchEvent} />)}
    </div>
  );
}

/** What the meet as entered would cost, and the one press that makes it fit. */
function CostLine({ state, roster, patch }: { state: WizardState; roster: RosterStudent[]; patch: (p: Partial<WizardState>) => void }) {
  const c = costOf(state, roster);
  const have = daysOf(state);
  if (c.entries === 0) return null;
  const hours = Math.floor(c.minutes / 60);
  const mins = c.minutes % 60;
  return (
    <section className="sk-sp-cost" data-fits={c.fits} aria-label="What the meet needs">
      <div><span className="sk-lab">Entries</span><b>{c.entries}</b></div>
      <div><span className="sk-lab">Matches & heats</span><b>{c.slots}</b></div>
      <div><span className="sk-lab">Time on the venues</span><b>{hours ? `${hours} h ` : ''}{mins ? `${mins} min` : hours ? '' : '0 min'}</b></div>
      <div><span className="sk-lab">Days</span><b>{c.daysNeeded} needed · {have} booked</b></div>
      <span className="sp" />
      {c.fits
        ? <span className="sk-sp-vbadge" data-tone="good">It all fits</span>
        : (
          <span className="sk-sp-pointsrow">
            <span className="sk-sp-vbadge" data-tone="warn">Over by {c.daysNeeded - have} day{c.daysNeeded - have === 1 ? '' : 's'}</span>
            <button type="button" className="sk-btn" data-size="sm" onClick={() => patch({ endsOn: dayOfMeet(state.startsOn, c.daysNeeded - 1) })}>Make it {c.daysNeeded} days</button>
            <span className="sk-muted">or add a court on step 1.</span>
          </span>
        )}
    </section>
  );
}

/** A class, shut. The chips enter or empty the whole class without opening it. */
function ClassRow({ std, kids, events, query, open, onToggle, enteredIn, add, drop, tick }: {
  std: number; kids: RosterStudent[]; events: WizardEvent[]; query: string; open: boolean; onToggle: () => void;
  enteredIn: (ev: WizardEvent, kids: RosterStudent[]) => number;
  add: (ev: WizardEvent, ids: string[]) => void;
  drop: (ev: WizardEvent, ids: string[]) => void;
  tick: (ev: WizardEvent, id: string, on: boolean) => void;
}) {
  const ids = kids.map((k) => k.id);
  const shown = query ? kids.filter((k) => k.name.toLowerCase().includes(query)) : kids;
  const total = events.reduce((a, ev) => a + enteredIn(ev, kids), 0);
  return (
    <section className="sk-sp-class" data-open={open} aria-label={`Class ${std}`}>
      <div className="hd">
        <button type="button" className="tog" aria-expanded={open} onClick={onToggle}>
          <ChevronRight size={14} aria-hidden />
          <span className="nm">Class {std}</span>
          <span className="meta">{kids.length} children{total ? ` · ${total} entries` : ''}</span>
        </button>
        <div className="sk-sp-chips">
          {events.map((ev) => {
            const n = enteredIn(ev, kids);
            const all = n === kids.length;
            return (
              <button key={ev.uid} type="button" className="sk-chip" aria-pressed={all} title={`${all ? 'Take class' : 'Enter class'} ${std} ${all ? 'out of' : 'in'} ${ev.sport.name}`} onClick={() => (all ? drop(ev, ids) : add(ev, ids))}>
                {ev.sport.name} <span className="sk-sp-count">{n}/{kids.length}</span>
              </button>
            );
          })}
        </div>
      </div>
      {open ? (
        <div className="sk-tblwrap">
          <table className="sk-tbl sk-sp-matrix">
            <thead><tr><th>Child</th>{events.map((ev) => <th key={ev.uid}>{ev.sport.name}</th>)}<th>All</th></tr></thead>
            <tbody>
              {shown.length === 0 ? <tr><td colSpan={events.length + 2}><span className="sk-muted">No name in class {std} matches.</span></td></tr> : null}
              {shown.map((s) => {
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
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** How a field of hundreds reaches a final — chosen before anybody runs. */
function StageCard({ state, ev, roster, patchEvent }: { state: WizardState; ev: WizardEvent; roster: RosterStudent[]; patchEvent: (uid: string, p: Partial<WizardEvent>) => void }) {
  const r = resolved(state, ev);
  const steps = funnelOf(state, ev, roster);
  const shape = SHAPES.find((s) => s.id === r.stageShape) ?? SHAPES[0];
  return (
    <div className="sk-sp-field">
      <span className="sk-lab">{ev.sport.name} · {ev.category} — how {ev.studentIds.length} athletes reach a final</span>
      <div className="sk-sp-chips">
        {SHAPES.map((s) => <button key={s.id} type="button" className="sk-chip" aria-pressed={r.stageShape === s.id} onClick={() => patchEvent(ev.uid, { stageShape: s.id })}>{s.label}</button>)}
      </div>
      <p className="sk-muted">{shape.note}</p>
      {steps.length === 0 ? <p className="sk-sp-problem"><span>⚠</span><span>Nobody entered yet, so there is no field to narrow.</span></p> : (
        <ol className="sk-sp-funnel">
          {steps.map((st, i) => (
            <li key={st.kind + i}>
              <b>{st.label}</b>
              <span>{st.field} athlete{st.field === 1 ? '' : 's'} · {st.slots} {st.slots === 1 ? 'race' : 'races'} of {r.lanes}</span>
            </li>
          ))}
        </ol>
      )}
      {r.stageShape !== 'STRAIGHT' ? (
        <div className="sk-sp-pointsrow">
          {r.stageShape === 'CLASS_QUAL'
            ? <label className="sk-sp-field"><span className="sk-lab">Through from each class</span><input className="sk-input" type="number" min={1} max={8} value={r.advancePerClass} onChange={(e) => patchEvent(ev.uid, { advancePerClass: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} /></label>
            : <label className="sk-sp-field"><span className="sk-lab">Finalists</span><input className="sk-input" type="number" min={2} max={12} value={r.finalists} onChange={(e) => patchEvent(ev.uid, { finalists: Math.max(2, Math.min(12, Number(e.target.value) || 2)) })} /></label>}
          <span className="sk-muted">Only the first round is timetabled now — each later round is drawn the moment the one before it is ranked.</span>
        </div>
      ) : null}
    </div>
  );
}

/** A team sport: what a side is, and whether that yields anybody to play. */
function TeamCard({ state, ev, roster, patchEvent }: { state: WizardState; ev: WizardEvent; roster: RosterStudent[]; patchEvent: (uid: string, p: Partial<WizardEvent>) => void }) {
  const basis = basisOf(ev, roster);
  const counts = teamCounts(ev, roster);
  const n = counts[basis];
  const fix = fixBasis(ev, roster);
  const walkovers = basis === 'SECTIONS' && resolved(state, ev).structure === 'CLASS' ? singleSectionClasses(ev, roster) : [];
  return (
    <div className="sk-sp-field">
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
            <b>{`Only ${n} team${n === 1 ? '' : 's'} under ${TEAM_BASIS_WORD[basis]}`}</b>{fix ? '. ' : ', so there is nobody to play. Tick children from another class or section, or put them in houses first.'}
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
}

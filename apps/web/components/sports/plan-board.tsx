'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import { MAX_MEET_DAYS, hhmm } from '@skoolos/types';
import { dayOfMeet, fmtDay, type TournamentDetail } from '@/app/app/sports/ui';
import { daySpanOf, eventLabel, loadOf } from './model';

const hhmmToMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export interface PlanActions {
  update: (p: { endsOn?: string; dayStartMin?: number; dayEndMin?: number; restMin?: number; gapMin?: number }) => void;
  addVenue: (name: string) => void;
  removeVenue: (venueId: string) => void;
  pin: (eventId: string, dayIdx: number | null) => void;
  refit: () => void;
}

/**
 * The shape of the meet, and what that shape holds. Days and courts are the
 * two things an office actually changes once a big meet is laid out, so both
 * are pressable here, and every change re-lays only the unplayed slots — what
 * has been played keeps its time and its place in each child's diary.
 */
export function PlanBoard({ t, canEdit, busy: busyNow, act, onOpenDay }: { t: TournamentDetail; canEdit: boolean; busy: boolean; act: PlanActions; onOpenDay: (day: number) => void }) {
  const [venue, setVenue] = useState('');
  const [allDays, setAllDays] = useState(false);
  const span = daySpanOf(t);
  const days = Math.max(span.booked, span.used);
  const load = loadOf(t, days);
  const window = t.dayEndMin - t.dayStartMin;
  const draft = t.status === 'DRAFT';
  const pinnedNowhere = t.events.filter((e) => e.dayIdx == null);
  // Why the plan wants the days it wants. A number of days is a symptom; the
  // arithmetic behind it is the only thing the office can act on.
  const perVenue = t.venues
    .map((v) => ({ name: v.name, min: load.reduce((a, d) => a + (d.byVenue[v.id]?.min ?? 0), 0) }))
    .sort((a, b) => b.min - a.min);
  const busy = perVenue.filter((v) => v.min > 0);
  const idle = perVenue.filter((v) => v.min === 0);
  const worst = busy[0];
  const hours = (min: number) => (min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`);
  // A meet is as long as the office said it is, so the day list has to stay
  // readable at any length: days that hold something, and a line for the rest.
  const holds = load.filter((d) => d.events.length > 0);
  const bare = load.length - holds.length;
  const shown = allDays || bare === 0 ? load : holds;

  return (
    <div className="sk-sp-stack">
      {span.over ? (
        <div className="sk-notice">
          <div className="nt">The plan runs past the last day</div>
          <div className="nd">
            <span className="sk-sp-why">
              {`Slots have rolled onto day ${span.used}, which the meet is not booked for.`}
              {worst ? <><br />{`${hours(worst.min)} of it is on ${worst.name} alone, and a day holds ${Math.floor(window / 60)} h — so ${worst.name} by itself needs ${Math.ceil(worst.min / Math.max(1, window))} day${Math.ceil(worst.min / Math.max(1, window)) === 1 ? '' : 's'}.`}</> : null}
              {idle.length ? <><br />{`${idle.length} venue${idle.length === 1 ? '' : 's'} hold${idle.length === 1 ? 's' : ''} nothing at all — ${idle.map((v) => v.name).join(', ')}. An event bound to ${worst?.name ?? 'the busy one'} cannot use them unless it is the right kind of place for that sport.`}</> : null}
              <br />{`Book the days, add a venue of the kind ${worst?.name ?? 'the busy one'} is, or shorten the slots.`}
            </span>
            {canEdit ? <><br /><button type="button" className="sk-btn" data-size="sm" data-variant="primary" disabled={busyNow} onClick={() => act.update({ endsOn: dayOfMeet(t.startsOn, Math.min(span.used, MAX_MEET_DAYS) - 1) })}>{`Book ${Math.min(span.used, MAX_MEET_DAYS)} days`}</button></> : null}
          </div>
        </div>
      ) : null}

      <section className="sk-sp-plangrid" aria-label="Each day of the meet">
        <div className="sk-sp-planday sk-sp-planhead">
          <span className="d">Day</span>
          {t.venues.map((v) => (
            <span key={v.id} className="v">
              {v.name}
              {canEdit && draft && t.venues.length > 1 ? <button type="button" aria-label={`Remove ${v.name}`} title={`Remove ${v.name}`} disabled={busyNow} onClick={() => act.removeVenue(v.id)}><X size={11} /></button> : null}
            </span>
          ))}
          <span className="tot">Ends</span>
        </div>
        {shown.map((d) => {
          const beyond = d.day >= span.booked;
          return (
            <div key={d.day} className="sk-sp-planday" data-beyond={beyond}>
              <button type="button" className="d" onClick={() => onOpenDay(d.day)} title="Open this day on the board">
                <b>{fmtDay(dayOfMeet(t.startsOn, d.day), false)}</b>
                <span className="sk-muted">{d.events.length ? `${d.events.length} event${d.events.length === 1 ? '' : 's'}` : 'Nothing on'}{beyond ? ' · not booked' : ''}</span>
              </button>
              {t.venues.map((v) => {
                const cell = d.byVenue[v.id];
                const pct = cell ? Math.min(100, Math.round((cell.min / Math.max(1, window)) * 100)) : 0;
                return (
                  <span key={v.id} className="v" title={cell ? `${cell.slots} slots, ${cell.min} minutes of ${window}` : 'Free all day'}>
                    <span className="bar"><i style={{ width: `${pct}%` }} data-full={pct >= 95} /></span>
                    <span className="n">{cell ? `${pct}%` : '—'}</span>
                  </span>
                );
              })}
              <span className="tot">{d.endsAt == null ? <span className="sk-muted">—</span> : <b data-late={d.endsAt > t.dayEndMin}>{hhmm(d.endsAt)}</b>}</span>
            </div>
          );
        })}
      </section>
      <p className="sk-muted">
        Each bar is how much of the {Math.floor(window / 60)}-hour day that court is booked for. Press a day to see it slot by slot.
        {bare ? <> {allDays ? `All ${load.length} days are listed.` : `${bare} booked day${bare === 1 ? ' holds' : 's hold'} nothing and ${bare === 1 ? 'is' : 'are'} not listed.`} <button type="button" className="sk-btn" data-size="sm" onClick={() => setAllDays(!allDays)}>{allDays ? 'Hide the empty days' : `Show all ${load.length} days`}</button></> : null}
      </p>

      {canEdit ? (
        <div className="sk-sp-shape">
          <label className="sk-sp-field"><span className="sk-lab">Last day</span>
            <input className="sk-input" type="date" value={t.endsOn} min={t.startsOn} max={dayOfMeet(t.startsOn, MAX_MEET_DAYS - 1)} disabled={busyNow} onChange={(e) => e.target.value && act.update({ endsOn: e.target.value })} />
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Day starts</span>
            <input className="sk-input" type="time" value={hhmm(t.dayStartMin)} disabled={busyNow || !draft} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) act.update({ dayStartMin: m }); }} />
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Day ends</span>
            <input className="sk-input" type="time" value={hhmm(t.dayEndMin)} disabled={busyNow || !draft} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) act.update({ dayEndMin: m }); }} />
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Break between slots on a court</span>
            <span className="sk-sp-unit">
              <input className="sk-input" type="number" aria-label="Break between slots on a court" min={0} max={60} step={5} value={t.gapMin} disabled={busyNow || !draft} onChange={(e) => act.update({ gapMin: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />
              <span>min</span>
            </span>
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Rest between a child&apos;s own slots</span>
            <span className="sk-sp-unit">
              <input className="sk-input" type="number" aria-label="Rest between a child&apos;s own slots" min={0} max={120} step={5} value={t.restMin} disabled={busyNow || !draft} onChange={(e) => act.update({ restMin: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} />
              <span>min</span>
            </span>
          </label>
          <div className="sk-sp-field" data-wide><span className="sk-lab">Add a court, table, pool or field</span>
            <span className="sk-sp-unit">
              <input className="sk-input" placeholder="Badminton court 3" value={venue} disabled={busyNow} onChange={(e) => setVenue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && venue.trim()) { act.addVenue(venue.trim()); setVenue(''); } }} />
              <button type="button" className="sk-btn" disabled={busyNow || !venue.trim()} onClick={() => { act.addVenue(venue.trim()); setVenue(''); }}>Add</button>
            </span>
          </div>
          <div className="sk-sp-field" data-wide><span className="sk-lab">&nbsp;</span>
            <button type="button" className="sk-btn sk-press" disabled={busyNow} onClick={act.refit}>Lay the plan out again</button>
          </div>
        </div>
      ) : null}
      {canEdit && !draft ? <p className="sk-muted">The tournament is live, so the hours and the rest gap are fixed. A day or a court can still be added, and only unplayed slots move.</p> : null}

      <div className="sk-tblwrap">
        <table className="sk-tbl">
          <thead><tr><th>Event</th><th>Matches &amp; heats</th><th>Runs on</th><th>Held to a day</th></tr></thead>
          <tbody>
            {t.events.map((e) => {
              const on = load.filter((d) => d.events.some((x) => x.id === e.id)).map((d) => d.day);
              return (
                <tr key={e.id}>
                  <td>{eventLabel(e)}</td>
                  <td>{e.matches.length + e.heats.length}</td>
                  <td>{on.length === 0 ? <span className="sk-muted">Not timetabled</span> : on.map((d) => fmtDay(dayOfMeet(t.startsOn, d), false)).join(', ')}</td>
                  <td>
                    {canEdit ? (
                      <select className="sk-input" aria-label={`Day for ${eventLabel(e)}`} value={e.dayIdx == null ? '' : String(e.dayIdx)} disabled={busyNow} onChange={(ch) => act.pin(e.id, ch.target.value === '' ? null : Number(ch.target.value))}>
                        <option value="">Wherever it fits</option>
                        {Array.from({ length: span.booked }, (_, i) => <option key={i} value={i}>{fmtDay(dayOfMeet(t.startsOn, i), false)}</option>)}
                      </select>
                    ) : e.dayIdx == null ? <span className="sk-muted">Wherever it fits</span> : fmtDay(dayOfMeet(t.startsOn, e.dayIdx), false)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && pinnedNowhere.length < t.events.length ? <p className="sk-muted">A held event is laid out on its day first; everything else fills the room left over.</p> : null}
    </div>
  );
}

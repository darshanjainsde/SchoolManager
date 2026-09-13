'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import { hhmm } from '@skoolos/types';
import { dayOfMeet, fmtDay, type TournamentDetail } from '@/app/app/sports/ui';
import { daySpanOf, eventLabel, loadOf } from './model';

const hhmmToMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

export interface PlanActions {
  update: (p: { endsOn?: string; dayStartMin?: number; dayEndMin?: number; restMin?: number }) => void;
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
export function PlanBoard({ t, canEdit, busy, act, onOpenDay }: { t: TournamentDetail; canEdit: boolean; busy: boolean; act: PlanActions; onOpenDay: (day: number) => void }) {
  const [venue, setVenue] = useState('');
  const span = daySpanOf(t);
  const days = Math.max(span.booked, span.used);
  const load = loadOf(t, days);
  const window = t.dayEndMin - t.dayStartMin;
  const draft = t.status === 'DRAFT';
  const pinnedNowhere = t.events.filter((e) => e.dayIdx == null);

  return (
    <div className="sk-sp-stack">
      {span.over ? (
        <div className="sk-notice">
          <div className="nt">The plan runs past the last day</div>
          <div className="nd">
            {`Slots have rolled onto day ${span.used}, which the meet is not booked for. Book the extra day${span.used - span.booked > 1 ? 's' : ''} or add a court, then the plan re-lays itself.`}
            {canEdit ? <><br /><button type="button" className="sk-btn" data-size="sm" data-variant="primary" disabled={busy} onClick={() => act.update({ endsOn: dayOfMeet(t.startsOn, span.used - 1) })}>{`Book ${span.used} days`}</button></> : null}
          </div>
        </div>
      ) : null}

      <section className="sk-sp-plangrid" aria-label="Each day of the meet">
        <div className="sk-sp-planday sk-sp-planhead">
          <span className="d">Day</span>
          {t.venues.map((v) => (
            <span key={v.id} className="v">
              {v.name}
              {canEdit && draft && t.venues.length > 1 ? <button type="button" aria-label={`Remove ${v.name}`} title={`Remove ${v.name}`} disabled={busy} onClick={() => act.removeVenue(v.id)}><X size={11} /></button> : null}
            </span>
          ))}
          <span className="tot">Ends</span>
        </div>
        {load.map((d) => {
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
      <p className="sk-muted">Each bar is how much of the {Math.floor(window / 60)}-hour day that court is booked for. Press a day to see it slot by slot.</p>

      {canEdit ? (
        <div className="sk-sp-fieldrow">
          <label className="sk-sp-field"><span className="sk-lab">Last day</span>
            <input className="sk-input" type="date" value={t.endsOn} min={t.startsOn} disabled={busy} onChange={(e) => e.target.value && act.update({ endsOn: e.target.value })} />
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Day starts</span>
            <input className="sk-input" type="time" value={hhmm(t.dayStartMin)} disabled={busy || !draft} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) act.update({ dayStartMin: m }); }} />
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Day ends</span>
            <input className="sk-input" type="time" value={hhmm(t.dayEndMin)} disabled={busy || !draft} onChange={(e) => { const m = hhmmToMin(e.target.value); if (m != null) act.update({ dayEndMin: m }); }} />
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Rest between a child&apos;s slots</span>
            <input className="sk-input" type="number" min={0} max={120} step={5} style={{ width: '6em' }} value={t.restMin} disabled={busy || !draft} onChange={(e) => act.update({ restMin: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} />
          </label>
          <div className="sk-sp-field" data-grow><span className="sk-lab">Add a court, table, pool or field</span>
            <div className="sk-sp-pointsrow">
              <input className="sk-input" placeholder="Court 3" value={venue} disabled={busy} onChange={(e) => setVenue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && venue.trim()) { act.addVenue(venue.trim()); setVenue(''); } }} />
              <button type="button" className="sk-btn" disabled={busy || !venue.trim()} onClick={() => { act.addVenue(venue.trim()); setVenue(''); }}>Add venue</button>
            </div>
          </div>
          <button type="button" className="sk-btn sk-press" disabled={busy} onClick={act.refit}>Lay the plan out again</button>
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
                      <select className="sk-input" aria-label={`Day for ${eventLabel(e)}`} value={e.dayIdx == null ? '' : String(e.dayIdx)} disabled={busy} onChange={(ch) => act.pin(e.id, ch.target.value === '' ? null : Number(ch.target.value))}>
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

'use client';
import { useState } from 'react';
import { hhmm, minuteOfDay, type Clash } from '@skoolos/types';
import { EmptyRow, type TournamentDetail } from '@/app/app/sports/ui';
import { timetableOf, type Slot } from './model';

/**
 * One day as a timetable, not as a list of times. A column per place that has
 * something on it, the hours ruled down the side, and every match or heat a
 * block whose height IS its length — so a full track, a gap after lunch and
 * two things clashing are all visible without reading a single figure.
 *
 * The scale bends to the day: five-minute heats get enough pixels to read and
 * the page scrolls, rather than a day of unreadable slivers.
 */
export function Timetable({ t, day, clashes, onOpen }: { t: TournamentDetail; day: number; clashes: Clash[]; onOpen: (slot: Slot) => void }) {
  const [everyVenue, setEveryVenue] = useState(false);
  const tt = timetableOf(t, day, everyVenue);
  const clashIds = new Set(clashes.flatMap((c) => [c.first, c.second]));
  const height = Math.round((tt.toMin - tt.fromMin) * tt.pxPerMin);
  const top = (min: number) => Math.round((minuteOfDay(min) - tt.fromMin) * tt.pxPerMin);

  if (!tt.columns.length) {
    return <EmptyRow>Nothing is on this day. {tt.idle.length ? `${tt.idle.length === 1 ? 'The venue is' : `All ${tt.idle.length} venues are`} free.` : ''}</EmptyRow>;
  }
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-tt" role="group" aria-label="Timetable grid" style={{ ['--tt-h' as string]: `${height}px` }}>
        <div className="hours">
          <div className="vh" />
          <div className="track">
            {tt.hours.map((h) => <span key={h} className="hr" style={{ top: `${Math.round((h - tt.fromMin) * tt.pxPerMin)}px` }}>{hhmm(h)}</span>)}
          </div>
        </div>
        <div className="cols">
          {tt.columns.map((c) => (
            <div key={c.venueId} className="col">
              <div className="vh"><span className="nm">{c.name}</span><span className="sk-sp-count">{c.slots.length ? `${Math.floor(c.min / 60)}h ${c.min % 60}m` : 'free'}</span></div>
              <div className="track">
                {tt.hours.map((h) => <span key={h} className="rule" style={{ top: `${Math.round((h - tt.fromMin) * tt.pxPerMin)}px` }} />)}
                {c.slots.map((s) => {
                  const h = Math.max(16, Math.round(s.slotMin * tt.pxPerMin) - 2);
                  // A five-minute heat is one line tall. Stacking three lines
                  // into it clips the two that say WHICH heat it is, which is
                  // the only thing the column does not already tell you.
                  const tight = h < 34;
                  return (
                    <button
                      key={s.id} type="button" className="blk"
                      data-state={clashIds.has(s.id) ? 'clash' : s.state}
                      data-tone={tt.tones.get(s.event.sportKey) ?? 0}
                      data-tight={tight}
                      style={{ top: `${top(s.atMin)}px`, height: `${h}px` }}
                      title={`${hhmm(s.atMin)} · ${s.slotMin} min · ${s.event.sportName} ${s.short} · ${s.who}`}
                      onClick={() => onOpen(s)}
                    >
                      <span className="t">{hhmm(s.atMin)}</span>
                      <span className="w">{tight ? s.short : `${s.event.sportName} · ${s.short}`}</span>
                      {tight ? null : <span className="who">{s.who}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {tt.idle.length ? (
        <p className="sk-muted">
          {everyVenue ? 'Showing every venue. ' : `${tt.idle.map((v) => v.name).join(', ')} ${tt.idle.length === 1 ? 'has' : 'have'} nothing on this day, so ${tt.idle.length === 1 ? 'it is' : 'they are'} not given a column. `}
          <button type="button" className="sk-btn" data-size="sm" onClick={() => setEveryVenue(!everyVenue)}>{everyVenue ? 'Hide the empty ones' : `Show all ${t.venues.length} venues`}</button>
        </p>
      ) : null}
    </div>
  );
}

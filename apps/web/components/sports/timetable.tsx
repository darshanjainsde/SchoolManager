'use client';
import { useRef, useState } from 'react';
import { hhmm, minuteOfDay, sayProblem, whyNot, type Clash } from '@skoolos/types';
import { EmptyRow, type TournamentDetail } from '@/app/app/sports/ui';
import { placementsOf, problemNames, timetableOf, type Slot } from './model';

const SNAP = 5;

export interface TimetableActions {
  /** Put one slot on a venue at a minute of the meet. */
  move: (slot: Slot, venueId: string, atMin: number) => void;
  /** Everything unplayed comes off a venue and is re-laid on the others. */
  clearVenue: (venueId: string) => void;
  /** Say why a drop was refused, without asking the server. */
  refuse: (why: string) => void;
}

/**
 * One day as a timetable, and — because it already draws where everything is —
 * the place you move it from. Drag a block to another court or another time.
 *
 * The drop is judged by the SAME rule the API enforces (`whyNot`), run here
 * first so a bad drag is refused under the finger with a sentence rather than
 * a round trip. The API checks again on arrival; this is not the only client.
 */
export function Timetable({ t, day, clashes, canEdit, busy, act, onOpen }: {
  t: TournamentDetail; day: number; clashes: Clash[]; canEdit: boolean; busy: boolean; act: TimetableActions; onOpen: (slot: Slot) => void;
}) {
  const [everyVenue, setEveryVenue] = useState(false);
  const [held, setHeld] = useState<{ id: string; venueId: string; atMin: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const tt = timetableOf(t, day, everyVenue);
  const clashIds = new Set(clashes.flatMap((c) => [c.first, c.second]));
  const height = Math.round((tt.toMin - tt.fromMin) * tt.pxPerMin);
  const topOf = (min: number) => Math.round((minuteOfDay(min) - tt.fromMin) * tt.pxPerMin);

  /** Where the pointer is, as a venue and a minute of this day. */
  function aim(x: number, y: number): { venueId: string; atMin: number } | null {
    const col = document.elementsFromPoint(x, y).map((e) => (e as HTMLElement).closest?.('[data-venue]')).find(Boolean) as HTMLElement | undefined;
    if (!col) return null;
    const track = col.querySelector('.track');
    if (!track) return null;
    const rel = y - track.getBoundingClientRect().top;
    const min = tt.fromMin + Math.round(rel / tt.pxPerMin / SNAP) * SNAP;
    return { venueId: col.dataset.venue!, atMin: day * 1440 + Math.max(0, min) };
  }

  function onDown(e: React.PointerEvent, slot: Slot) {
    if (!canEdit || busy) return;
    const p = placementsOf(t).find((x) => x.id === slot.id);
    if (p?.played) { act.refuse(sayProblem({ kind: 'PLAYED' }, problemNames(t))); return; }
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setHeld({ id: slot.id, venueId: slot.venueId, atMin: slot.atMin });
  }
  function onMove(e: React.PointerEvent) {
    if (!held) return;
    const at = aim(e.clientX, e.clientY);
    if (at) setHeld({ ...held, ...at });
  }
  function onUp(e: React.PointerEvent, slot: Slot) {
    if (!held || held.id !== slot.id) { setHeld(null); return; }
    const at = aim(e.clientX, e.clientY);
    setHeld(null);
    if (!at || (at.venueId === slot.venueId && at.atMin === slot.atMin)) return;
    const all = placementsOf(t);
    const me = all.find((x) => x.id === slot.id);
    if (!me) return;
    const no = whyNot({ ...me, venueId: at.venueId, atMin: at.atMin }, all, t);
    if (no) { act.refuse(sayProblem(no, problemNames(t))); return; }
    act.move(slot, at.venueId, at.atMin);
  }

  if (!tt.columns.length) {
    return <EmptyRow>Nothing is on this day. {tt.idle.length ? `${tt.idle.length === 1 ? 'The venue is' : `All ${tt.idle.length} venues are`} free.` : ''}</EmptyRow>;
  }
  return (
    <div className="sk-sp-stack">
      <div className="sk-sp-tt" role="group" aria-label="Timetable grid" ref={box} style={{ ['--tt-h' as string]: `${height}px` }}>
        <div className="hours">
          <div className="vh" />
          <div className="track">
            {tt.hours.map((h) => <span key={h} className="hr" style={{ top: `${Math.round((h - tt.fromMin) * tt.pxPerMin)}px` }}>{hhmm(h)}</span>)}
          </div>
        </div>
        <div className="cols">
          {tt.columns.map((c) => (
            <div key={c.venueId} className="col" data-venue={c.venueId} data-aim={held?.venueId === c.venueId}>
              <div className="vh">
                <span className="nm">{c.name}</span>
                <span className="sk-sp-count">{c.slots.length ? `${Math.floor(c.min / 60)}h ${c.min % 60}m` : 'free'}</span>
                {canEdit && c.slots.some((s) => s.state !== 'done') && tt.columns.length > 1 ? (
                  <button type="button" className="off" disabled={busy} title={`Move everything unplayed off ${c.name}`} onClick={() => act.clearVenue(c.venueId)}>Clear</button>
                ) : null}
              </div>
              <div className="track">
                {tt.hours.map((h) => <span key={h} className="rule" style={{ top: `${Math.round((h - tt.fromMin) * tt.pxPerMin)}px` }} />)}
                {c.slots.map((s) => {
                  const drag = held?.id === s.id;
                  const at = drag ? held! : { venueId: s.venueId, atMin: s.atMin };
                  if (drag && at.venueId !== c.venueId) return null;
                  const h = Math.max(16, Math.round(s.slotMin * tt.pxPerMin) - 2);
                  // A five-minute heat is one line tall. Stacking three lines
                  // into it clips the two that say WHICH heat it is.
                  const tight = h < 34;
                  return (
                    <button
                      key={s.id} type="button" className="blk"
                      data-state={clashIds.has(s.id) ? 'clash' : s.state}
                      data-tone={tt.tones.get(s.event.sportKey) ?? 0}
                      data-tight={tight}
                      data-held={drag}
                      data-move={canEdit && s.state !== 'done'}
                      style={{ top: `${topOf(at.atMin)}px`, height: `${h}px` }}
                      title={`${hhmm(s.atMin)} · ${s.slotMin} min · ${s.event.sportName} ${s.short} · ${s.who}`}
                      onPointerDown={(e) => onDown(e, s)}
                      onPointerMove={onMove}
                      onPointerUp={(e) => onUp(e, s)}
                      onPointerCancel={() => setHeld(null)}
                      onClick={() => { if (!held) onOpen(s); }}
                    >
                      <span className="t">{hhmm(drag ? at.atMin : s.atMin)}</span>
                      <span className="w">{tight ? s.short : `${s.event.sportName} · ${s.short}`}</span>
                      {tight ? null : <span className="who">{s.who}</span>}
                    </button>
                  );
                })}
                {held && held.venueId === c.venueId && !c.slots.some((s) => s.id === held.id) ? <span className="aim" style={{ top: `${topOf(held.atMin)}px` }} /> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="sk-muted">
        {canEdit ? 'Drag a block to another court or another time. A played slot stays where it happened, and a drop that clashes is refused before it lands. ' : ''}
        {tt.idle.length ? (
          <>
            {everyVenue ? 'Showing every venue. ' : `${tt.idle.map((v) => v.name).join(', ')} ${tt.idle.length === 1 ? 'has' : 'have'} nothing on this day, so ${tt.idle.length === 1 ? 'it is' : 'they are'} not given a column. `}
            <button type="button" className="sk-btn" data-size="sm" onClick={() => setEveryVenue(!everyVenue)}>{everyVenue ? 'Hide the empty ones' : `Show all ${t.venues.length} venues`}</button>
          </>
        ) : null}
      </p>
    </div>
  );
}

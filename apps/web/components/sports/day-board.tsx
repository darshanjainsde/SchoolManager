'use client';
import { dayOf, hhmm, type Clash } from '@skoolos/types';
import type { TournamentDetail } from '@/app/app/sports/ui';
import { slotsOf, type Slot } from './model';

/** One column per venue, the day's slots in time order. A red edge is a clash. */
export function DayBoard({ t, day, clashes, onOpen }: { t: TournamentDetail; day: number; clashes: Clash[]; onOpen: (slot: Slot) => void }) {
  const clashIds = new Set(clashes.flatMap((c) => [c.first, c.second]));
  const slots = slotsOf(t).filter((s) => dayOf(s.atMin) === day);
  return (
    <div className="sk-sp-board">
      {t.venues.map((v) => {
        const mine = slots.filter((s) => s.venueId === v.id);
        return (
          <div key={v.id} className="sk-sp-venue">
            <div className="h">{v.name}</div>
            {mine.length === 0 ? <p className="sk-state">Free all day.</p> : null}
            {mine.map((s) => (
              <button key={s.id} type="button" className="sk-sp-slotcard" data-state={clashIds.has(s.id) ? 'clash' : s.state} onClick={() => onOpen(s)} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
                <span className="t">{hhmm(s.atMin)} · {s.slotMin} min</span>
                <span className="w">{s.title}</span>
                <span className="who">{s.who}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

'use client';
import { MAX_MEET_DAYS } from '@skoolos/types';
import { dayOfMeet, type RosterStudent } from './ui';
import { costOf, daysOf, type WizardState } from './wizard-model';

/** What the meet as entered would cost, and the one press that makes it fit. */
export function CostLine({ state, roster, patch }: { state: WizardState; roster: RosterStudent[]; patch: (p: Partial<WizardState>) => void }) {
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
            <button type="button" className="sk-btn" data-variant="primary" data-size="sm" onClick={() => patch({ endsOn: dayOfMeet(state.startsOn, Math.min(c.daysNeeded, MAX_MEET_DAYS) - 1) })}>
              Make it {Math.min(c.daysNeeded, MAX_MEET_DAYS)} days
            </button>
            <span className="sk-muted">
              {c.daysNeeded > MAX_MEET_DAYS
                ? `— though ${c.slots} slots over ${Math.floor((state.dayEndMin - state.dayStartMin) / 60)} hours a day is more than a meet can hold. Add venues on step 1, or run fewer events.`
                : `or add a venue on step 1 — the same work on twice the venues takes half the days.`}
            </span>
          </span>
        )}
    </section>
  );
}

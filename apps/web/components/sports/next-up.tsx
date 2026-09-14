'use client';
import { MAX_MEET_DAYS } from '@skoolos/types';
import { Pill, type TournamentDetail } from '@/app/app/sports/ui';
import { daySpanOf, eventLabel, loadOf, slotsOf } from './model';

export interface Step {
  /** What is left, in the words the office would use. */
  what: string;
  /** Why it matters, or what to do about it. */
  how: string;
  state: 'done' | 'now' | 'later' | 'blocked';
  /** The view that fixes it. */
  go?: { label: string; to: 'programme' | 'day' | 'plan' | 'events' | 'clashes' };
}

/**
 * What is left, in order. A meet is a long job with a lot of screens, and the
 * question a head of sport actually has when they open it is not "what is on
 * court 2" — it is "am I ready, and if not, what is the next thing I touch".
 * Every line names the move and the view that makes it.
 */
export function stepsOf(t: TournamentDetail, clashes: number): Step[] {
  const slots = slotsOf(t);
  const span = daySpanOf(t);
  const load = loadOf(t, Math.max(span.booked, span.used));
  const noVenue = t.events.filter((e) => e.venueIds.length === 0);
  const untimed = t.events.filter((e) => !slots.some((s) => s.eventId === e.id));
  const played = slots.filter((s) => s.state === 'done').length;
  const empty = t.venues.filter((v) => !load.some((d) => d.byVenue[v.id]));
  const out: Step[] = [];

  out.push({ what: `${t.events.length} event${t.events.length === 1 ? '' : 's'} drawn`, how: `${slots.length} matches and heats have a time and a place.`, state: 'done' });

  if (noVenue.length) out.push({
    what: `${noVenue.length} event${noVenue.length === 1 ? ' has' : 's have'} nowhere to play`,
    how: `${noVenue.map(eventLabel).join(', ')}. Add the right kind of venue, then lay the plan out again.`,
    state: 'blocked', go: { label: 'Days & courts', to: 'plan' },
  });
  if (untimed.length && !noVenue.length) out.push({
    what: `${untimed.length} event${untimed.length === 1 ? ' is' : 's are'} not timetabled`,
    how: `${untimed.map(eventLabel).join(', ')}. Lay the plan out again to place them.`,
    state: 'blocked', go: { label: 'Days & courts', to: 'plan' },
  });
  if (span.over) out.push({
    what: `The plan needs ${span.used} days and ${span.booked} ${span.booked === 1 ? 'is' : 'are'} booked`,
    how: span.used <= MAX_MEET_DAYS
      ? `Book the extra day${span.used - span.booked === 1 ? '' : 's'}, or add a court so the same work fits into fewer.`
      : `A meet runs for at most ${MAX_MEET_DAYS} days. Add venues of the kind the busy one is, or shorten the slots — see Days & courts for the arithmetic.`,
    state: 'blocked', go: { label: 'Days & courts', to: 'plan' },
  });
  if (clashes) out.push({
    what: `${clashes} clash${clashes === 1 ? '' : 'es'} to clear`,
    how: 'A child is in two places at once, or a venue holds two slots. Move one of them.',
    state: 'blocked', go: { label: 'See the clashes', to: 'clashes' },
  });
  if (empty.length) out.push({
    what: `${empty.length} venue${empty.length === 1 ? ' holds' : 's hold'} nothing`,
    how: `${empty.map((v) => v.name).join(', ')} ${empty.length === 1 ? 'is' : 'are'} booked but never used. Remove ${empty.length === 1 ? 'it' : 'them'}, or give an event that venue.`,
    state: 'later', go: { label: 'Days & courts', to: 'plan' },
  });

  const blocked = out.some((s) => s.state === 'blocked');
  if (!t.published) out.push({
    what: 'Publish to students',
    how: blocked ? 'Clear what is blocked above first — publishing tells every entered child their first slot.' : 'Every entered child with a login is told their first slot. Nobody is told twice.',
    state: blocked ? 'later' : 'now',
  });
  else if (t.status === 'LIVE') out.push({
    what: played === slots.length ? 'Every result is in' : `${slots.length - played} of ${slots.length} still to play`,
    how: played === slots.length ? 'Finish the tournament to stand the results and the house points.' : 'Enter each result as it happens; the next round is drawn the moment the one before it is ranked.',
    state: 'now', go: { label: 'Events & results', to: 'events' },
  });
  else if (t.status === 'DONE') out.push({ what: 'Finished', how: 'The results and the house points stand.', state: 'done' });
  return out;
}

const TONE: Record<Step['state'], 'good' | 'brand' | 'amber' | 'bad'> = { done: 'good', now: 'brand', later: 'amber', blocked: 'bad' };
const WORD: Record<Step['state'], string> = { done: 'Done', now: 'Next', later: 'Later', blocked: 'Blocked' };

export function NextUp({ steps, onGo }: { steps: Step[]; onGo: (to: NonNullable<Step['go']>['to']) => void }) {
  const left = steps.filter((s) => s.state === 'blocked').length;
  return (
    <div className="sk-sp-next" role="group" aria-label="Where this meet is">
      <div className="hd">
        <b>Where this meet is</b>
        <span className="sk-muted">{left ? `${left} thing${left === 1 ? '' : 's'} to clear before it can run` : 'Nothing is in the way.'}</span>
      </div>
      <ol>
        {steps.map((s) => (
          <li key={s.what} data-state={s.state}>
            <Pill tone={TONE[s.state]}>{WORD[s.state]}</Pill>
            <span className="w">
              <b>{s.what}</b>
              <span className="how">{s.how}</span>
            </span>
            {s.go ? <button type="button" className="sk-btn" data-size="sm" onClick={() => onGo(s.go!.to)}>{s.go.label}</button> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

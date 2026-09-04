/**
 * How the order desk colours its queue.
 *
 * Kept out of the page so the mapping can be tested without rendering, and so
 * the card stripe and the status pill are guaranteed to agree — they read the
 * same function rather than each deciding by eye.
 */

/** The tabs, in the order the operator works them: earn, chase, make, ship. */
export const FILTERS = [
  { key: 'REQUESTED', label: 'Needs quote' },
  { key: 'QUOTED', label: 'Awaiting school' },
  { key: 'CONFIRMED', label: 'To print' },
  { key: 'PRINTING', label: 'On the press' },
  { key: 'DISPATCHED', label: 'Dispatched' },
  { key: '', label: 'Everything' },
] as const;

/**
 * Only the five tones `.sk-pill` and `.sk-own-order` actually define. Inventing
 * a sixth ("late", "lock") is how a chip ends up rendering as bare unstyled
 * text — the attribute is accepted by the DOM and matches no rule.
 */
export type QueueTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

/**
 * Lateness outranks status: an order that is three days past the date we
 * promised is a problem whatever stage it has reached. Pass `daysLate: null`
 * to ask for the status colour alone — the pill says what stage it is at, the
 * card edge says whether it needs rescuing.
 */
export function queueTone(status: string, daysLate: number | null): QueueTone {
  if (daysLate !== null && daysLate > 0) return 'bad';
  switch (status) {
    case 'REQUESTED': return 'info';      // ours to price — the pile that earns
    case 'QUOTED': return 'warn';         // the school's move, not ours
    case 'CONFIRMED':
    case 'PRINTING':
    case 'DISPATCHED': return 'info';     // in flight
    case 'DELIVERED': return 'good';
    case 'DECLINED':
    case 'CANCELLED': return 'neutral';
    default: return 'neutral';            // an unmapped status must still read
  }
}

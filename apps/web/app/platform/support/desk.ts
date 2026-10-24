import type { SupportStatus } from '@skoolos/types';

/**
 * How the support desk colours its board and list.
 *
 * Kept out of the pages so the mapping can be tested without rendering, and
 * so the row stripe and the status pill are guaranteed to agree — they read
 * the same function rather than each deciding by eye.
 */

/** Only the five tones `.sk-pill` and `.sk-sup-row` actually define. */
export type DeskTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

/** Hours past since an ISO stamp; never negative. */
export function hoursSince(iso: string, now = Date.now()): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 3_600_000);
}

/**
 * Lateness outranks status: a ticket the school has waited on for more than a
 * day is a problem whatever stage it reached. Pass `unansweredHours: null`
 * for the status colour alone — the pill says what stage it is at, the stripe
 * says whether it needs rescuing.
 */
export function ticketTone(status: string, unansweredHours: number | null): DeskTone {
  if (unansweredHours !== null && unansweredHours > 24) return 'bad';
  switch (status) {
    case 'WAITING_ON_SCHOOL': return 'warn';   // their move
    case 'RESOLVED': return 'good';
    case 'CLOSED': return 'neutral';
    case 'OPEN':
    case 'ACKNOWLEDGED':
    case 'IN_PROGRESS': return 'info';         // ours
    default: return 'neutral';
  }
}

/** "40 m", "5 h", "3 d" — how long, as the owner reads it across a board. */
export function ageLabel(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} m`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}

/**
 * Mirrors OWNER_MOVES in apps/api/src/modules/support/support-status.ts. The
 * desk offers only these, and the API refuses anything else (409), so a stale
 * screen cannot push a closed ticket back into the queue.
 */
export const OWNER_MOVES: Record<SupportStatus, SupportStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING_ON_SCHOOL', 'RESOLVED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'WAITING_ON_SCHOOL', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_ON_SCHOOL', 'RESOLVED'],
  WAITING_ON_SCHOOL: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

/** The list filter, in the order the owner works it: what is live, what waits on them, what is settled. */
export const STATUS_FILTERS = [
  { key: '', label: 'Open' },
  { key: 'WAITING_ON_SCHOOL', label: 'Waiting on school' },
  { key: 'RESOLVED', label: 'Resolved' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'ALL', label: 'Everything' },
] as const;

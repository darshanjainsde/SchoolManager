import {
  SUPPORT_AUTO_CLOSE_DAYS,
  SUPPORT_REOPEN_DAYS,
  type SupportStatus,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';

/**
 * THE TICKET'S LIFE, as a pure table. The desk only offers these moves, and
 * the service refuses anything else, so a stale screen cannot push a closed
 * ticket back into the queue.
 *
 *  OPEN ──► ACKNOWLEDGED ──► IN_PROGRESS ◄──► WAITING_ON_SCHOOL
 *   │              │              │                   │
 *   └──────────────┴──────────────┴───────► RESOLVED ◄┘
 *                                             │   ▲
 *                                   CLOSED ◄──┘   └── (owner may pull it back)
 *
 * The school's own moves live in the service: a reply while WAITING_ON_SCHOOL
 * flips it to IN_PROGRESS, "confirm" closes a RESOLVED ticket, "reopen" sends
 * a RESOLVED or CLOSED one back to OPEN inside the window.
 */
export const OWNER_MOVES: Record<SupportStatus, SupportStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'IN_PROGRESS', 'WAITING_ON_SCHOOL', 'RESOLVED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'WAITING_ON_SCHOOL', 'RESOLVED'],
  IN_PROGRESS: ['WAITING_ON_SCHOOL', 'RESOLVED'],
  WAITING_ON_SCHOOL: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

const DAY = 86_400_000;

export function assertOwnerMove(from: SupportStatus, to: SupportStatus): void {
  if (!OWNER_MOVES[from]?.includes(to)) {
    throw new ApiError(
      'SUPPORT_ILLEGAL_MOVE',
      from === 'CLOSED'
        ? 'This ticket is closed. Only the school can reopen it.'
        : `A ticket cannot go from ${from.toLowerCase().replace(/_/g, ' ')} to ${to.toLowerCase().replace(/_/g, ' ')}.`,
      409,
      'status',
    );
  }
}

/** The school may reopen a RESOLVED or CLOSED ticket within the window after it was resolved. */
export function canReopen(status: SupportStatus, resolvedAt: Date | null, now = new Date()): boolean {
  if (status !== 'RESOLVED' && status !== 'CLOSED') return false;
  if (!resolvedAt) return false;
  return now.getTime() - resolvedAt.getTime() <= SUPPORT_REOPEN_DAYS * DAY;
}

/** The school may close a ticket the owner has marked resolved. */
export function canConfirm(status: SupportStatus): boolean {
  return status === 'RESOLVED';
}

/** The school moved last and Sckools has not answered since. Never true once the ticket is settled. */
export function isUnanswered(t: { status: string; lastSchoolActivityAt: Date; lastOwnerActivityAt: Date | null }): boolean {
  if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
  if (!t.lastOwnerActivityAt) return true;
  return t.lastSchoolActivityAt.getTime() > t.lastOwnerActivityAt.getTime();
}

/** A RESOLVED ticket the school has left alone for the quiet period closes itself. */
export function autoCloseDue(resolvedAt: Date | null, now = new Date()): boolean {
  if (!resolvedAt) return false;
  return now.getTime() - resolvedAt.getTime() > SUPPORT_AUTO_CLOSE_DAYS * DAY;
}

/** Consent is a timestamp, not a flag: it expires on its own. */
export function lookInActive(lookInUntil: Date | null, now = new Date()): boolean {
  return !!lookInUntil && lookInUntil.getTime() > now.getTime();
}

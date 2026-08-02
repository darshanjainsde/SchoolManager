'use client';
import type { RegisterChangeStatusValue } from '@skoolos/types';

/** A leave application and a register-change request rendered in one list. */
export type RequestItem =
  | {
      kind: 'leave';
      id: string;
      title: string;
      detail: string;
      reason: string | null;
      status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
      createdAt: string;
      cancellable: boolean;
    }
  | {
      kind: 'register';
      id: string;
      title: string;
      detail: string;
      reason: string;
      status: RegisterChangeStatusValue;
      createdAt: string;
      expiresAt: string | null;
    };

export interface RequestListProps {
  items: RequestItem[];
  onCancelLeave: (id: string) => void;
  cancellingId: string | null;
}

type Tone = 'warn' | 'good' | 'bad' | 'info';

const LEAVE_STATUS_TONE: Record<'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED', Tone> = {
  PENDING: 'warn',
  APPROVED: 'good',
  REJECTED: 'bad',
  CANCELLED: 'info',
};

/**
 * Which ink the stamp is cut in. The three outcomes map onto the same three
 * semantic tones the pills use, so "green = allowed / amber = waiting / red =
 * refused" reads identically whether it arrives as a pill or as a stamp.
 * `info` (a cancelled leave) gets no stamp at all — nobody decided it, the
 * teacher withdrew it, and stamping a withdrawal would misattribute the act.
 */
function stampState(tone: Tone): 'approved' | 'pending' | 'rejected' | null {
  if (tone === 'good') return 'approved';
  if (tone === 'warn') return 'pending';
  if (tone === 'bad') return 'rejected';
  return null;
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Approval only ever means "unlocked until `expiresAt`" (see
 * RegisterChangeService.review's `endOfIstDay`) — an APPROVED row whose
 * window has already passed must read as expired, not as an open unlock, or
 * a teacher will believe they still have time to make the correction.
 */
function isExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

function registerStatusDisplay(item: Extract<RequestItem, { kind: 'register' }>): {
  label: string;
  tone: Tone;
} {
  if (item.status === 'APPROVED') {
    return isExpired(item.expiresAt) ? { label: 'Expired', tone: 'bad' } : { label: 'Approved', tone: 'good' };
  }
  if (item.status === 'PENDING') return { label: 'Pending', tone: 'warn' };
  return { label: 'Rejected', tone: 'bad' };
}

/**
 * Renders whatever `items` it is given, in the order given — the page owns
 * merging the two sources and sorting them by `createdAt`. No hooks, no
 * fetching: every state (empty, one row, many, mixed kinds) is reachable from
 * props alone.
 */
export function RequestList({ items, onCancelLeave, cancellingId }: RequestListProps): React.JSX.Element {
  if (items.length === 0) {
    return <p className="sk-state">No requests yet.</p>;
  }

  return (
    <div>
      {items.map((item) => {
        const pill =
          item.kind === 'leave'
            ? { label: titleCase(item.status), tone: LEAVE_STATUS_TONE[item.status] }
            : registerStatusDisplay(item);
        const showsDeadline =
          item.kind === 'register' && item.status === 'APPROVED' && !!item.expiresAt && !isExpired(item.expiresAt);
        const cancelling = item.kind === 'leave' && cancellingId === item.id;

        const stamp = stampState(pill.tone);

        return (
          // The pitch's `.reqcard`: a slip on the office desk, not a table
          // row. `sk-row` stays underneath it (the flex behaviour is right,
          // and the page's own tests count these) — `sk-reqcard` reframes it.
          <div className="sk-row sk-reqcard" key={`${item.kind}-${item.id}`}>
            <span className="sk-pill" data-tone="info">
              {item.kind === 'leave' ? 'Leave' : 'Register change'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">{item.title}</div>
              <div className="meta">
                {item.detail}
                {item.reason ? ` · ${item.reason}` : ''}
              </div>
              {showsDeadline && item.kind === 'register' && item.expiresAt && (
                <div className="meta">Expires {formatDateTime(item.expiresAt)}</div>
              )}
            </div>
            <span className="sp" />
            {item.kind === 'leave' && item.cancellable && (
              <button
                type="button"
                className="sk-btn sk-press"
                disabled={cancelling}
                onClick={() => onCancelLeave(item.id)}
                style={{ marginRight: 8 }}
              >
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
            {/* THE STAMP. A decision made about you arrives as a stamp
                landing, because that is what it is — somebody in the office
                pressed something down on your slip. It replaces the status
                pill rather than sitting next to it: two renderings of one
                fact would read as two facts. A withdrawn request keeps the
                pill (see `stampState`), since nothing was stamped. */}
            {stamp ? (
              // The word is upper-cased in CSS, not in the string: a stamp
              // LOOKS shouted, but the readable label is what belongs in the
              // DOM for anyone reading it as text.
              <span className="sk-reqstamp sk-stampin sk-in" data-state={stamp}>
                {pill.label}
              </span>
            ) : (
              <span className="sk-pill" data-tone={pill.tone}>
                {pill.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

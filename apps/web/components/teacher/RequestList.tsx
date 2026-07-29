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

        return (
          <div className="sk-row" key={`${item.kind}-${item.id}`}>
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
                className="sk-btn"
                disabled={cancelling}
                onClick={() => onCancelLeave(item.id)}
                style={{ marginRight: 8 }}
              >
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            )}
            <span className="sk-pill" data-tone={pill.tone}>
              {pill.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

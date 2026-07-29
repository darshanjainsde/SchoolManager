'use client';
import { useState } from 'react';
import type { ClassDayStatus } from '@skoolos/types';

export interface LockedDayProps {
  className: string;
  /** YYYY-MM-DD. */
  date: string;
  status: ClassDayStatus | null;
  /** Set once a request for this class+date is already open. */
  requestPending: boolean;
  /**
   * True while the caller is still fetching whether a request is already
   * open. Until that resolves we don't know if `requestPending` is
   * meaningful, so the form must not be offered — otherwise a teacher can
   * submit a duplicate request in that window and get the server's 409 as a
   * toast instead of being blocked by the UI. Optional/defaulted so existing
   * callers that already know the answer synchronously are unaffected.
   */
  requestsLoading?: boolean;
  isSubmitting: boolean;
  onRequestChange: (reason: string) => void;
}

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

/**
 * Replaces the roster entirely for a past date — the server refuses a write
 * for a closed day with `409 REGISTER_LOCKED` (see AttendanceService.save),
 * and a teacher should never discover that by submitting. No hooks reach out
 * to the network here: the page owns `status`/`requestPending` and this
 * component only renders what it's given and reports a trimmed reason back
 * up via `onRequestChange`.
 */
export function LockedDay({
  className,
  date,
  status,
  requestPending,
  requestsLoading = false,
  isSubmitting,
  onRequestChange,
}: LockedDayProps): React.JSX.Element {
  const [reason, setReason] = useState('');
  const taken = status?.taken ?? false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    onRequestChange(trimmed);
  }

  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>
          {className} · {date} is closed
        </h3>
      </div>
      <div className="sk-card-b">
        <p className="sk-muted">
          Past days close once they pass so the record can be trusted. Ask your admin to reopen this
          day from Requests if it needs a change.
        </p>

        {taken && status ? (
          <p className="sk-state">
            ✓ {status.present} of {status.total} present
            {status.markedBy ? ` · Taken by ${status.markedBy}` : ''}
          </p>
        ) : (
          <p className="sk-state">No attendance was recorded for that day.</p>
        )}

        {requestsLoading ? (
          <p className="sk-state">Checking for an existing request…</p>
        ) : requestPending ? (
          <p className="sk-pill" data-tone="info" style={{ alignSelf: 'flex-start' }}>
            Change request sent — waiting on your admin
          </p>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="locked-day-reason" className="sk-lab">
              Reason for reopening
            </label>
            <textarea
              id="locked-day-reason"
              className={fieldCls}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isSubmitting}
              placeholder="Why does this day need to be reopened?"
            />
            <button
              type="submit"
              className="sk-btn"
              data-variant="primary"
              disabled={isSubmitting}
              style={{ alignSelf: 'flex-start' }}
            >
              {isSubmitting ? 'Requesting…' : 'Request a change'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

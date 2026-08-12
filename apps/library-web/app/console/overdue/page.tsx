'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import { listOverdue, type OverdueRow } from '@/lib/circulation';
import { initials, memberHue, memberName } from '@/lib/members';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: OverdueRow[] }
  | { kind: 'error'; message: string };

/** Longer overdue reads as more urgent; the bands match the fine policy's grace. */
function tone(days: number): string {
  if (days > 14) return 'over';
  if (days > 3) return 'soon';
  return '';
}

export default function OverduePage() {
  const ctx = useApiCtx();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!ctx) return;
    let live = true;
    listOverdue(ctx)
      .then((rows) => { if (live) setState({ kind: 'ready', rows }); })
      .catch((err) => {
        if (!live) return;
        setState({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Could not reach the library.',
        });
      });
    return () => { live = false; };
  }, [ctx]);

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Overdue</h2>
          <p>Books past their due date, longest first. Names, not ids.</p>
        </div>
      </div>

      {state.kind === 'error' ? (
        <div className="lbx-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{state.message}</span>
        </div>
      ) : null}

      {state.kind === 'loading' ? (
        <p style={{ color: 'var(--lb-ink-3)', fontSize: '.86rem' }}>Loading…</p>
      ) : null}

      {state.kind === 'ready' && state.rows.length === 0 ? (
        <p className="lbx-empty">Nothing is overdue. Every book is back or still in time.</p>
      ) : null}

      {state.kind === 'ready' && state.rows.length > 0 ? (
        <>
          <div className="lbx-scroller">
            <table className="lbx-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Book</th>
                  <th>Due</th>
                  <th style={{ textAlign: 'right' }}>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {[...state.rows]
                  .sort((a, b) => b.daysOverdue - a.daysOverdue)
                  .map((r) => (
                    <tr key={r.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                          <span
                            className="lbx-disc sm"
                            style={{ background: `hsl(${memberHue(r.member.id)} 45% 40%)` }}
                            aria-hidden="true"
                          >
                            {initials(r.member)}
                          </span>
                          <span>
                            {memberName(r.member)}
                            <span className="lbx-sub lbx-mono">{r.member.code}</span>
                          </span>
                        </div>
                      </td>
                      <td>
                        {r.title.title}
                        <span className="lbx-sub lbx-mono">{r.barcode}</span>
                      </td>
                      <td className="lbx-mono">
                        {new Date(r.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        {r.renewCount > 0 ? (
                          <span className="lbx-sub">renewed {r.renewCount}×</span>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`lbx-days ${tone(r.daysOverdue)}`}>{r.daysOverdue}</span>
                        <span className="lbx-sub">{r.daysOverdue === 1 ? 'day' : 'days'}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: 'var(--lb-ink-3)', fontSize: '.78rem', marginTop: '.6rem' }}>
            {state.rows.length} overdue
            {state.rows.length >= 500 ? ' — showing the first 500' : ''}
          </p>
        </>
      ) : null}
    </>
  );
}

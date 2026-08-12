'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import { daysUntil, listHolds, type HoldRow } from '@/lib/circulation';
import { initials, memberHue, memberName } from '@/lib/members';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: HoldRow[] }
  | { kind: 'error'; message: string };

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'READY', label: 'On the shelf' },
  { key: 'PENDING', label: 'Waiting' },
] as const;

/** READY holds are the actionable ones — a book is physically waiting to be collected. */
function pillFor(status: HoldRow['status']): { cls: string; label: string } {
  if (status === 'READY') return { cls: 'ok', label: 'Ready' };
  if (status === 'PENDING') return { cls: 'warn', label: 'Waiting' };
  if (status === 'EXPIRED') return { cls: 'stop', label: 'Expired' };
  return { cls: 'stop', label: status.toLowerCase() };
}

export default function HoldsPage() {
  const ctx = useApiCtx();
  const [filter, setFilter] = useState<string>('');
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!ctx) return;
    setState({ kind: 'loading' });
    try {
      const rows = await listHolds(ctx, { status: filter || undefined, limit: 100 });
      setState({ kind: 'ready', rows });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reach the library.',
      });
    }
  }, [ctx, filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Holds</h2>
          <p>Who is waiting for what, and what is sitting on the hold shelf.</p>
        </div>
        <div style={{ display: 'flex', gap: '.4rem' }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`lbx-btn${filter === f.key ? '' : ' ghost'}`}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
            >
              {f.label}
            </button>
          ))}
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
        <p className="lbx-empty">
          {filter ? 'Nothing in this state right now.' : 'Nobody is waiting for a book.'}
        </p>
      ) : null}

      {state.kind === 'ready' && state.rows.length > 0 ? (
        <div className="lbx-scroller">
          <table className="lbx-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Member</th>
                <th>Book</th>
                <th>State</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((h) => {
                const pill = pillFor(h.status);
                const left = daysUntil(h.expiresAt);
                return (
                  <tr key={h.id}>
                    <td className="lbx-mono">{h.queuePosition}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <span
                          className="lbx-disc sm"
                          style={{ background: `hsl(${memberHue(h.member.id)} 45% 40%)` }}
                          aria-hidden="true"
                        >
                          {initials(h.member)}
                        </span>
                        <span>
                          {memberName(h.member)}
                          <span className="lbx-sub lbx-mono">{h.member.code}</span>
                        </span>
                      </div>
                    </td>
                    <td>{h.title.title}</td>
                    <td><span className={`lbx-pill ${pill.cls}`}>{pill.label}</span></td>
                    <td className="lbx-mono">
                      {left < 0 ? 'passed' : left === 0 ? 'today' : `${left}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import { formatRupees } from '@/lib/circulation';
import { listDues, type DuesRow } from '@/lib/lost';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: DuesRow[] }
  | { kind: 'error'; message: string };

/**
 * Students and teachers are separate tabs, not one list with a column.
 *
 * A teacher's ₹300 must never sit inside a figure a principal reads as what the
 * CHILDREN owe — the approved prototype's tile says "Students owing" — and a
 * total at the bottom of a mixed list is exactly how that goes wrong.
 */
const TABS = [
  { key: 'STUDENT', label: 'Students' },
  { key: 'TEACHER', label: 'Teachers' },
] as const;

const KIND_LABEL: Record<string, string> = {
  OVERDUE: 'Late',
  LOST: 'Lost book',
  DAMAGE: 'Damage',
  OTHER: 'Other',
};

export default function DuesPage() {
  const ctx = useApiCtx();
  const [tab, setTab] = useState<string>('STUDENT');
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!ctx) return;
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', rows: await listDues(ctx, { memberType: tab, limit: 200 }) });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reach the library.',
      });
    }
  }, [ctx, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = state.kind === 'ready' ? state.rows.reduce((s, r) => s + r.owed, 0) : 0;

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Outstanding</h2>
          <p>Who owes what, and why. Fines are off by default — most schools charge children nothing.</p>
        </div>
      </div>

      <div className="lbx-tabs" role="tablist" style={{ marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className="lbx-btn ghost"
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
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
        <p style={{ color: 'var(--lb-ink-2)', fontSize: '.9rem' }}>
          Nobody owes anything. That is the normal state of a school library.
        </p>
      ) : null}

      {state.kind === 'ready' && state.rows.length > 0 ? (
        <>
          <div className="lbx-scroller">
            <table className="lbx-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Class</th>
                  <th>Why</th>
                  <th style={{ textAlign: 'right' }}>Owed</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.memberId}>
                    <td>
                      <div className="lbx-ttl">
                        {r.firstName} {r.lastName}
                      </div>
                      <div className="lbx-au lbx-mono">{r.code}</div>
                    </td>
                    <td className="lbx-mono">{r.classRef ?? '—'}</td>
                    <td>
                      {r.kinds.map((k) => KIND_LABEL[k] ?? k).join(', ')}
                      {r.fineCount > 1 ? (
                        <span className="lbx-au"> · {r.fineCount} charges</span>
                      ) : null}
                    </td>
                    <td className="lbx-mono" style={{ textAlign: 'right' }}>
                      {formatRupees(r.owed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: '.7rem', fontSize: '.86rem' }}>
            <strong>{formatRupees(total)}</strong> owed by {state.rows.length}{' '}
            {tab === 'TEACHER' ? 'teachers' : 'students'}.
          </p>
        </>
      ) : null}
    </>
  );
}

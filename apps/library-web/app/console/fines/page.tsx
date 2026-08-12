'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import { formatRupees, listFines, outstanding, waiveFine, type FineRow } from '@/lib/circulation';
import { initials, memberHue, memberName } from '@/lib/members';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; rows: FineRow[] }
  | { kind: 'error'; message: string };

const FILTERS = [
  { key: 'OPEN', label: 'Outstanding' },
  { key: '', label: 'All' },
  { key: 'WAIVED', label: 'Waived' },
] as const;

export default function FinesPage() {
  const ctx = useApiCtx();
  const [filter, setFilter] = useState<string>('OPEN');
  const [state, setState] = useState<State>({ kind: 'loading' });

  // The fine being waived, and the reason typed for it. A waiver without a
  // stated reason is not offered: the API requires one, and an audit row that
  // says only "waived" answers nothing later.
  const [waiving, setWaiving] = useState<FineRow | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiveError, setWaiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ctx) return;
    setState({ kind: 'loading' });
    try {
      const rows = await listFines(ctx, { status: filter || undefined, limit: 100 });
      setState({ kind: 'ready', rows });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reach the library.',
      });
    }
  }, [ctx, filter]);

  useEffect(() => { void load(); }, [load]);

  async function confirmWaive() {
    if (!ctx || !waiving || !reason.trim() || busy) return;
    setBusy(true);
    setWaiveError(null);
    try {
      await waiveFine(ctx, waiving.id, reason.trim());
      setWaiving(null);
      setReason('');
      await load();
    } catch (err) {
      setWaiveError(err instanceof ApiError ? err.message : 'Could not reach the library.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Fines</h2>
          <p>What is owed, by whom, and for which book.</p>
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
          {filter === 'OPEN' ? 'Nothing outstanding. Nobody owes the library anything.' : 'No fines here.'}
        </p>
      ) : null}

      {state.kind === 'ready' && state.rows.length > 0 ? (
        <div className="lbx-scroller">
          <table className="lbx-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Book</th>
                <th>Reason</th>
                <th style={{ textAlign: 'right' }}>Owed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.rows.map((f) => {
                const owed = outstanding(f);
                return (
                  <tr key={f.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <span
                          className="lbx-disc sm"
                          style={{ background: `hsl(${memberHue(f.member.id)} 45% 40%)` }}
                          aria-hidden="true"
                        >
                          {initials(f.member)}
                        </span>
                        <span>
                          {memberName(f.member)}
                          <span className="lbx-sub lbx-mono">{f.member.code}</span>
                        </span>
                      </div>
                    </td>
                    <td>{f.loan?.copy.title.title ?? <span style={{ color: 'var(--lb-ink-3)' }}>—</span>}</td>
                    <td>
                      <span className="lbx-pill warn">{f.kind.toLowerCase()}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="lbx-days">{formatRupees(owed)}</span>
                      {f.status !== 'OPEN' ? <span className="lbx-sub">{f.status.toLowerCase()}</span> : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {owed > 0 ? (
                        <button className="lbx-btn ghost" onClick={() => { setWaiving(f); setReason(''); setWaiveError(null); }}>
                          Waive
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {waiving ? (
        <aside className="lbx-detail" aria-label="Waive a fine">
          <div className="lbx-detail-head">
            <h3>Waive {formatRupees(outstanding(waiving))}</h3>
            <button className="lbx-btn ghost" onClick={() => setWaiving(null)}>Cancel</button>
          </div>
          <p className="lbx-au">
            {memberName(waiving.member)} · {waiving.loan?.copy.title.title ?? 'no book attached'}
          </p>
          <div className="lbx-field" style={{ marginTop: '.6rem' }}>
            <label htmlFor="reason">Reason</label>
            <input
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Book returned damaged by flooding, waived by head librarian"
              autoFocus
            />
          </div>
          {waiveError ? (
            <div className="lbx-error" role="alert" style={{ marginTop: '.5rem' }}>
              <span aria-hidden="true">⚠</span>
              <span>{waiveError}</span>
            </div>
          ) : null}
          <button
            className="lbx-btn"
            style={{ marginTop: '.7rem' }}
            onClick={() => void confirmWaive()}
            disabled={!reason.trim() || busy}
          >
            {busy ? 'Waiving…' : 'Waive the balance'}
          </button>
        </aside>
      ) : null}
    </>
  );
}

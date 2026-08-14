'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import { formatRupees, listFines, outstanding, payFine, waiveFine, type FineRow } from '@/lib/circulation';
import { initials, memberHue, memberName } from '@/lib/members';
import { WAIVER_REASONS } from '@/lib/lost';

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
  // A CODE as well as the words. The words explain this one waiver to a human;
  // the code is what lets the collections screen answer "where did each rupee
  // go" across four hundred of them.
  const [reasonCode, setReasonCode] = useState<string>('GOODWILL');
  const [busy, setBusy] = useState(false);
  const [waiveError, setWaiveError] = useState<string | null>(null);
  // Taking money is a different act from forgiving it, and the screen should
  // not make them look alike: Pay is one click with a method, Waive opens a
  // panel that demands a reason.
  const [paying, setPaying] = useState<FineRow | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  async function confirmPay(method: 'CASH' | 'UPI') {
    if (!ctx || !paying || busy) return;
    setBusy(true);
    setPayError(null);
    try {
      await payFine(ctx, paying.id, method);
      setPaying(null);
      await load();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Could not reach the library.');
    } finally {
      setBusy(false);
    }
  }

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
      await waiveFine(ctx, waiving.id, reason.trim(), reasonCode);
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
                    <td>{f.issue?.copy.title.title ?? <span style={{ color: 'var(--lb-ink-3)' }}>—</span>}</td>
                    <td>
                      <span className="lbx-pill warn">{f.kind.toLowerCase()}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="lbx-days">{formatRupees(owed)}</span>
                      {f.status !== 'OPEN' ? <span className="lbx-sub">{f.status.toLowerCase()}</span> : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {owed > 0 ? (
                        <>
                          <button className="lbx-btn ghost" onClick={() => { setPaying(f); setPayError(null); }}>
                            Pay
                          </button>{' '}
                          <button className="lbx-btn ghost" onClick={() => { setWaiving(f); setReason(''); setWaiveError(null); }}>
                            Waive
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {paying ? (
        <aside className="lbx-detail" aria-label="Record a payment">
          <div className="lbx-detail-head">
            <h3>Take {formatRupees(outstanding(paying))}</h3>
            <button className="lbx-btn ghost" onClick={() => setPaying(null)}>Cancel</button>
          </div>
          <p className="lbx-au">
            {memberName(paying.member)} · {paying.issue?.copy.title.title ?? 'no book attached'}
          </p>
          <p style={{ fontSize: '.78rem', color: 'var(--lb-ink-3)' }}>
            In full only. Money is recorded here, not moved — write the family a
            paper receipt.
          </p>
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.7rem' }}>
            <button className="lbx-btn" disabled={busy} onClick={() => void confirmPay('CASH')}>
              {busy ? 'Recording…' : 'Cash'}
            </button>
            <button className="lbx-btn" disabled={busy} onClick={() => void confirmPay('UPI')}>
              {busy ? 'Recording…' : 'UPI'}
            </button>
          </div>
          {payError ? (
            <div className="lbx-error" role="alert" style={{ marginTop: '.5rem' }}>
              <span aria-hidden="true">⚠</span>
              <span>{payError}</span>
            </div>
          ) : null}
        </aside>
      ) : null}

      {waiving ? (
        <aside className="lbx-detail" aria-label="Waive a fine">
          <div className="lbx-detail-head">
            <h3>Waive {formatRupees(outstanding(waiving))}</h3>
            <button className="lbx-btn ghost" onClick={() => setWaiving(null)}>Cancel</button>
          </div>
          <p className="lbx-au">
            {memberName(waiving.member)} · {waiving.issue?.copy.title.title ?? 'no book attached'}
          </p>
          <div className="lbx-field" style={{ marginTop: '.6rem' }}>
            <label htmlFor="reasonCode">Why</label>
            <select
              id="reasonCode"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {WAIVER_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: '.72rem', color: 'var(--lb-ink-3)' }}>
              A book that was found, or replaced by the family, is cleared from the
              lost-book screen instead — those cost the school nothing and are not
              waivers.
            </div>
          </div>
          <div className="lbx-field" style={{ marginTop: '.6rem' }}>
            <label htmlFor="reason">In your own words</label>
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

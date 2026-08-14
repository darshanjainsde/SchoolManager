'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import { formatRupees, rupees } from '@/lib/circulation';
import { listRefundsOwed, type RefundOwedRow } from '@/lib/lost';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; refunds: RefundOwedRow[] }
  | { kind: 'error'; message: string };

/**
 * Lost books.
 *
 * The refunds-owed list is the load-bearing part of this screen, and it is at
 * the top for that reason: when a book turns up after a family has already
 * paid, the school holds both the money and the book, and nothing else in the
 * system will remind anyone. This software cannot send money back — it can only
 * refuse to let the obligation be forgotten.
 */
export default function LostBooksPage() {
  const ctx = useApiCtx();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!ctx) return;
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', refunds: await listRefundsOwed(ctx) });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Could not reach the library.',
      });
    }
  }, [ctx]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Lost books</h2>
          <p>
            A lost book keeps its number in the register for good — that is what makes the register a
            history rather than a stock list. A replacement is entered as a new book with the next
            number.
          </p>
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

      {state.kind === 'ready' ? (
        <>
          <h3>Money to give back</h3>
          {state.refunds.length === 0 ? (
            <p style={{ color: 'var(--lb-ink-2)', fontSize: '.9rem' }}>
              Nothing owed to anyone. This list fills only when a book turns up after it was paid for.
            </p>
          ) : (
            <>
              <div className="lbx-error" role="status" style={{ marginBottom: '.6rem' }}>
                <span aria-hidden="true">₹</span>
                <span>
                  {state.refunds.length} {state.refunds.length === 1 ? 'family is' : 'families are'} owed
                  money back. The book was found after they had already paid.
                </span>
              </div>
              <div className="lbx-scroller">
                <table className="lbx-table">
                  <thead>
                    <tr>
                      <th>Who</th>
                      <th>Book</th>
                      <th>Acc. no.</th>
                      <th style={{ textAlign: 'right' }}>To return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.refunds.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.member ? (
                            <>
                              <div className="lbx-ttl">
                                {r.member.firstName} {r.member.lastName}
                              </div>
                              <div className="lbx-au lbx-mono">
                                {r.member.code}
                                {r.member.classRef ? ` · ${r.member.classRef}` : ''}
                              </div>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{r.copy.title.title}</td>
                        <td className="lbx-mono">{r.copy.accessionNumber}</td>
                        <td className="lbx-mono" style={{ textAlign: 'right' }}>
                          {formatRupees(rupees(r.refundOwedAmount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : null}
    </>
  );
}

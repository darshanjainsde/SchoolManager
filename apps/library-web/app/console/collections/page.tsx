'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useApiCtx } from '@/lib/session';
import { formatRupees, rupees } from '@/lib/circulation';
import { getCollections, listWaivers, type CollectionsReport, type WaiverLogRow } from '@/lib/lost';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; report: CollectionsReport; waivers: WaiverLogRow[] }
  | { kind: 'error'; message: string };

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  OTHER: 'Other',
  UNRECORDED: 'Not recorded',
};

const KIND_LABEL: Record<string, string> = {
  OVERDUE: 'Late returns',
  LOST: 'Lost books',
  DAMAGE: 'Damage',
  OTHER: 'Other',
};

export default function CollectionsPage() {
  const ctx = useApiCtx();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!ctx) return;
    setState({ kind: 'loading' });
    try {
      const [report, waivers] = await Promise.all([getCollections(ctx), listWaivers(ctx, 50)]);
      setState({ kind: 'ready', report, waivers });
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

  if (state.kind === 'error') {
    return (
      <div className="lbx-error" role="alert">
        <span aria-hidden="true">⚠</span>
        <span>{state.message}</span>
      </div>
    );
  }
  if (state.kind === 'loading') {
    return <p style={{ color: 'var(--lb-ink-3)', fontSize: '.86rem' }}>Loading…</p>;
  }

  const { report, waivers } = state;

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Collections</h2>
          <p>
            What has been collected, what was let off, and what is still owed — for {report.from}
            {report.to !== report.from ? ` to ${report.to}` : ''}.
          </p>
        </div>
      </div>

      <div className="lbx-tiles">
        <div className="lbx-tile good">
          <div className="lbx-lab">Collected</div>
          <div className="lbx-val">{formatRupees(report.collected)}</div>
        </div>
        <div className="lbx-tile bad">
          <div className="lbx-lab">Still owed</div>
          <div className="lbx-val">{formatRupees(report.stillOwed)}</div>
          <div className="lbx-au">{report.membersOwing} members</div>
        </div>
        <div className="lbx-tile warn">
          <div className="lbx-lab">Let off</div>
          <div className="lbx-val">{formatRupees(report.letOff)}</div>
        </div>
        <div className="lbx-tile">
          {/*
            Reported separately from "let off" on purpose. A book that was found,
            or replaced by the family, closes a charge without money — but the
            school lost nothing, and folding those into "let off" would make that
            figure read as generosity when it is book-keeping.
          */}
          <div className="lbx-lab">Cleared in kind</div>
          <div className="lbx-val">{formatRupees(report.clearedInKind)}</div>
          <div className="lbx-au">book found or replaced</div>
        </div>
      </div>

      <h3 style={{ marginTop: '1.4rem' }}>Where it came from</h3>
      <div className="lbx-scroller">
        <table className="lbx-table">
          <thead>
            <tr>
              <th>Reason</th>
              <th style={{ textAlign: 'right' }}>Collected</th>
              <th style={{ textAlign: 'right' }}>Still owed</th>
            </tr>
          </thead>
          <tbody>
            {report.byReason.map((r) => (
              <tr key={r.kind}>
                <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td className="lbx-mono" style={{ textAlign: 'right' }}>{formatRupees(r.collected)}</td>
                <td className="lbx-mono" style={{ textAlign: 'right' }}>{formatRupees(r.owed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 style={{ marginTop: '1.4rem' }}>How it was paid</h3>
      {report.byMethod.length === 0 ? (
        <p style={{ color: 'var(--lb-ink-2)', fontSize: '.9rem' }}>Nothing collected in this period.</p>
      ) : (
        <div className="lbx-scroller">
          <table className="lbx-table">
            <thead>
              <tr>
                <th>Method</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th style={{ textAlign: 'right' }}>Payments</th>
              </tr>
            </thead>
            <tbody>
              {report.byMethod.map((m) => (
                <tr key={m.method}>
                  <td>{METHOD_LABEL[m.method] ?? m.method}</td>
                  <td className="lbx-mono" style={{ textAlign: 'right' }}>{formatRupees(m.collected)}</td>
                  <td className="lbx-mono" style={{ textAlign: 'right' }}>{m.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: '1.4rem' }}>Let off</h3>
      <p style={{ color: 'var(--lb-ink-2)', fontSize: '.86rem', marginTop: '-.4rem' }}>
        Only a librarian may waive, and every waiver keeps its reason.
      </p>
      {waivers.length === 0 ? (
        <p style={{ color: 'var(--lb-ink-2)', fontSize: '.9rem' }}>Nothing has been waived.</p>
      ) : (
        <div className="lbx-scroller">
          <table className="lbx-table">
            <thead>
              <tr>
                <th>Who</th>
                <th>Book</th>
                <th>Why it was let off</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {waivers.map((w) => (
                <tr key={w.fineId}>
                  <td>
                    {w.member.firstName} {w.member.lastName}
                  </td>
                  <td>{w.book ?? '—'}</td>
                  <td>
                    {w.reason ?? '—'}
                    {w.mechanical ? (
                      <span className="lbx-au"> · the school lost nothing, so this is not counted above</span>
                    ) : null}
                  </td>
                  <td className="lbx-mono" style={{ textAlign: 'right' }}>
                    {formatRupees(rupees(w.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

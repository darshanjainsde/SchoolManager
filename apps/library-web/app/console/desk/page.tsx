'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { readSession, useApiCtx } from '@/lib/session';
import { MemberPicker } from '@/components/MemberPicker';
import { memberName, type MemberCard } from '@/lib/members';
import {
  daysUntil,
  formatRupees,
  issue,
  returnBook,
  type IssueResult,
  type ReturnResult,
} from '@/lib/circulation';

type Mode = 'issue' | 'return';

interface Row {
  id: string;
  accessionNumber: string;
  kind: 'issued' | 'returned' | 'fined' | 'failed';
  headline: string;
  detail: string;
  stamp: string;
  stampSub: string;
}

export default function DeskPage() {
  const [mode, setMode] = useState<Mode>('issue');
  const [accessionNumber, setAccessionNumber] = useState('');
  const [member, setMember] = useState<MemberCard | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctx = useApiCtx();

  // A desk is operated by scanner, not by mouse. The field must hold focus
  // through every scan or the second accessionNumber lands in the page instead of the
  // input — the single most common way a circulation screen becomes unusable.
  const scanRef = useRef<HTMLInputElement>(null);
  const refocus = useCallback(() => scanRef.current?.focus(), []);
  useEffect(() => { refocus(); }, [refocus, mode]);

  function pushRow(row: Row) {
    setRows((r) => [row, ...r].slice(0, 40));
  }

  async function onScan(e: React.FormEvent) {
    e.preventDefault();
    const code = accessionNumber.trim();
    if (!code || busy) return;

    const session = readSession();
    if (!session) return;
    const call = { host: session.host, token: session.accessToken };

    setBusy(true);
    setError(null);
    try {
      if (mode === 'issue') {
        if (!member) {
          setError('Find the member first, then scan the book.');
          return;
        }
        const res: IssueResult = await issue(call, code, member.id);
        const days = daysUntil(res.issue.dueAt);
        pushRow({
          id: res.issue.id,
          accessionNumber: code,
          kind: 'issued',
          headline: code,
          detail: `${memberName(member)} · due in ${days} day${days === 1 ? '' : 's'}${res.collectedHoldId ? ' · hold collected' : ''}`,
          stamp: 'Issued',
          stampSub: new Date(res.issue.dueAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        });
      } else {
        const res: ReturnResult = await returnBook(call, code);
        const fined = res.fine !== null;
        pushRow({
          id: res.issue.id,
          accessionNumber: code,
          kind: fined ? 'fined' : 'returned',
          headline: code,
          detail: res.promotedHoldId
            ? 'Held for the next member — put it on the hold shelf'
            : 'Back on the shelf',
          stamp: 'Returned',
          stampSub: fined ? `${formatRupees(res.fine!.amount)} fine` : 'on time',
        });
      }
      setAccessionNumber('');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not reach the library.';
      pushRow({
        id: `${code}-${Date.now()}`,
        accessionNumber: code,
        kind: 'failed',
        headline: code,
        detail: message,
        stamp: 'Refused',
        stampSub: err instanceof ApiError ? `${err.status}` : 'offline',
      });
      setAccessionNumber('');
    } finally {
      setBusy(false);
      refocus();
    }
  }

  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Circulation desk</h2>
          <p>Scan a accessionNumber to {mode === 'issue' ? 'issue' : 'take a return'}. The field keeps focus between scans.</p>
        </div>
        <div style={{ display: 'flex', gap: '.4rem' }}>
          <button
            className={`lbx-btn${mode === 'issue' ? '' : ' ghost'}`}
            onClick={() => setMode('issue')}
            aria-pressed={mode === 'issue'}
          >
            Issue
          </button>
          <button
            className={`lbx-btn${mode === 'return' ? '' : ' ghost'}`}
            onClick={() => setMode('return')}
            aria-pressed={mode === 'return'}
          >
            Return
          </button>
        </div>
      </div>

      {mode === 'issue' && ctx ? (
        <div style={{ maxWidth: '26rem', marginBottom: '.8rem' }}>
          <MemberPicker
            ctx={ctx}
            selected={member}
            onSelect={setMember}
            onPicked={refocus}
          />
        </div>
      ) : null}

      <form onSubmit={onScan}>
        <div className="lbx-scanbar">
          <span className="lbx-scan-ico" aria-hidden="true">▮▯▮</span>
          <input
            ref={scanRef}
            value={accessionNumber}
            onChange={(e) => setAccessionNumber(e.target.value)}
            placeholder="Scan or type a accessionNumber…"
            aria-label="AccessionNumber"
            autoComplete="off"
            disabled={busy}
          />
          <span className="lbx-scanhint">{busy ? 'Working' : 'Ready'}</span>
        </div>
      </form>

      {error ? (
        <div className="lbx-error" role="alert" style={{ marginTop: '.7rem' }}>
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="lbx-rows" aria-live="polite">
        {rows.map((r) => (
          <div className="lbx-row" key={r.id}>
            <div className={`lbx-cover ${r.kind}`} aria-hidden="true">▤</div>
            <div style={{ minWidth: 0 }}>
              <div className="lbx-row-t">{r.headline}</div>
              <div className="lbx-row-m">{r.detail}</div>
            </div>
            <div className={`lbx-stamp ${r.kind}`}>
              {r.stamp}
              <small>{r.stampSub}</small>
            </div>
          </div>
        ))}
        {rows.length === 0 ? (
          <p style={{ color: 'var(--lb-ink-3)', fontSize: '.86rem' }}>
            Scans appear here, newest first.
          </p>
        ) : null}
      </div>
    </>
  );
}

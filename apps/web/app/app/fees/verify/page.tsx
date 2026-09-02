'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ExternalLink, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { BackToFees } from '@/components/fees/back-to-fees';
import { useHost } from '@/components/use-host';
import { METHOD_LABEL, fmtDate, rupees, type FeePaymentStatus, type PaymentRow } from '@/lib/fees';

/**
 * The verify desk: where a screenshot becomes money.
 *
 * The clerk is making one judgement forty times a day — does this proof match
 * this bill? So the three things that decide it (claimed amount, bill amount,
 * the image) sit together, and the comparison is computed by the server rather
 * than left to a person doing arithmetic under time pressure.
 */

const REJECTION_REASONS = [
  'We could not read the screenshot — please send a clearer one.',
  'The amount does not match what is due. Please check and send again.',
  'We could not find this reference in our bank account.',
  'This payment has already been recorded.',
  'The payment details are incomplete.',
];

const TAB_IDS: FeePaymentStatus[] = ['SUBMITTED', 'VERIFIED', 'REJECTED', 'REVERSED'];

const TABS: { id: FeePaymentStatus; label: string }[] = [
  { id: 'SUBMITTED', label: 'Awaiting review' },
  { id: 'VERIFIED', label: 'Verified' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'REVERSED', label: 'Reversed' },
];

export default function VerifyPage() {
  // useSearchParams needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={<p className="sk-state">Loading…</p>}>
      <Verify />
    </Suspense>
  );
}

function Verify() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const params = useSearchParams();
  // The dashboard's "Collected today" tile deep-links to ?status=VERIFIED, so
  // the number and the list it opens are the same set of payments.
  const initial = params.get('status');
  const [tab, setTab] = useState<FeePaymentStatus>(
    TAB_IDS.includes(initial as FeePaymentStatus) ? (initial as FeePaymentStatus) : 'SUBMITTED',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useQuery({
    queryKey: ['fee-payments', host, tab], enabled: !!host,
    queryFn: () => api.get<PaymentRow[]>(`/manage/fees/payments?status=${tab}`),
  });

  useEffect(() => {
    if (!rows.data?.length) { setSelectedId(null); return; }
    if (!rows.data.some((r) => r.id === selectedId)) setSelectedId(rows.data[0].id);
  }, [rows.data, selectedId]);

  const selected = rows.data?.find((r) => r.id === selectedId) ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['fee-payments', host] });
    qc.invalidateQueries({ queryKey: ['fee-summary', host] });
    qc.invalidateQueries({ queryKey: ['fee-pending', host] });
  };

  const verify = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post<{ receipt: { number: string } }>(
        `/manage/fees/payments/${id}/verify`,
        // Empty stays undefined rather than "" — the API stores NULL, and the
        // parent's receipt draws the note line only when there is a note.
        note.trim() ? { note: note.trim() } : {},
      ),
    onSuccess: (r) => { invalidate(); toast.success(`Accepted — receipt ${r.receipt.number} issued`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/manage/fees/payments/${id}/reverse`, { reason }),
    onSuccess: () => { invalidate(); toast.success('Reversed — the ledger carries an opposing entry'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/manage/fees/payments/${id}/reject`, { reason }),
    onSuccess: () => { invalidate(); toast.success('Turned down — the reason is on their fees page'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mismatches = rows.data?.filter((r) => r.amountMatchesBill === false).length ?? 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <BackToFees />
      <header className="sk-pagehead flex items-end justify-between">
        <div>
          <h1>Payments to check</h1>
          <p>Parents send what they paid. You confirm it, and the receipt goes out straight away.</p>
        </div>
      </header>

      {/*
        NOT `.sk-tabs` / `.sk-tab`: those are the page-level nav-bar classes
        (max-width 68rem, `margin: 0 auto`, their own padding). An auto margin on
        a flex item beats `stretch`, so the row shrank to its content and sat
        319px right of everything else on the page. These are filter chips.
      */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  style={{
                    borderColor: tab === t.id ? 'var(--sk-brand)' : 'var(--sk-line-2)',
                    background: tab === t.id ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
                    color: tab === t.id ? 'var(--sk-brand-2)' : 'var(--sk-ink-2)',
                    border: '1px solid', borderRadius: 999, padding: '6px 14px',
                    fontSize: 12.5, fontWeight: 650, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
            {t.label}
            {t.id === 'SUBMITTED' && (rows.data?.length ?? 0) > 0 && tab === 'SUBMITTED' && ` · ${rows.data?.length}`}
          </button>
        ))}
      </div>

      {mismatches > 0 && tab === 'SUBMITTED' && (
        <p className="flex items-center gap-2 rounded-[11px] border p-2 text-[12px]"
           style={{ borderColor: 'var(--sk-bad)', background: 'var(--sk-bad-tint)', color: 'var(--sk-bad)' }}>
          <AlertTriangle size={14} />
          {mismatches} {mismatches === 1 ? 'payment does' : 'payments do'} not match the bill amount.
        </p>
      )}

      {rows.isLoading && <p className="sk-state">Loading…</p>}
      {rows.isFetched && rows.data?.length === 0 && (
        <p className="sk-state">
          {tab === 'SUBMITTED' ? 'Nothing waiting. Every payment sent in has been dealt with.' : 'Nothing here yet.'}
        </p>
      )}

      {(rows.data?.length ?? 0) > 0 && (
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <div className="sk-card overflow-hidden">
            <div className="max-h-[560px] overflow-y-auto">
              {rows.data?.map((p) => (
                <button key={p.id} onClick={() => setSelectedId(p.id)}
                        className="flex w-full items-center gap-3 p-3 text-left"
                        style={{
                          borderTop: '1px solid var(--sk-line)',
                          background: p.id === selectedId ? 'var(--sk-brand-tint)' : 'transparent',
                        }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{p.student.name}</div>
                    <div className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
                      {p.student.className ?? '—'} · {p.student.admissionNo} · {METHOD_LABEL[p.method]}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-semibold tabular-nums"
                         style={{ color: p.amountMatchesBill === false ? 'var(--sk-bad)' : 'var(--sk-ink)' }}>
                      {rupees(p.amountMinor)}
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--sk-ink-3)' }}>{fmtDate(p.submittedAt)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selected && (
            <PaymentDetail
              p={selected}
              busy={verify.isPending || reject.isPending || reverse.isPending}
              onVerify={(note) => verify.mutate({ id: selected.id, note })}
              onReject={(reason) => reject.mutate({ id: selected.id, reason })}
              onReverse={(reason) => reverse.mutate({ id: selected.id, reason })}
            />
          )}
        </div>
      )}
    </div>
  );
}

const REVERSAL_REASONS = [
  'The cheque bounced.',
  'Recorded against the wrong student.',
  'A duplicate of a payment already recorded.',
  'The bank returned the transfer.',
];

function PaymentDetail({
  p, busy, onVerify, onReject, onReverse,
}: {
  p: PaymentRow; busy: boolean;
  onVerify: (note: string) => void; onReject: (reason: string) => void; onReverse: (reason: string) => void;
}) {
  const [ackNote, setAckNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState(REJECTION_REASONS[0]);
  const [revReason, setRevReason] = useState(REVERSAL_REASONS[0]);
  // Clearing the note with the panel matters more than it looks: without it,
  // a note typed for one family rides along on the NEXT payment the clerk
  // opens and is printed on a stranger's receipt.
  useEffect(() => { setRejecting(false); setReversing(false); setAckNote(''); }, [p.id]);

  const match = p.amountMatchesBill;

  return (
    <div className="sk-card self-start">
      <div className="sk-card-h">
        <h3>{p.student.name}</h3>
        <p>{p.student.className ?? '—'} · {p.student.admissionNo}{p.invoice && ` · ${p.invoice.termName}`}</p>
      </div>
      <div className="sk-card-b">
        <div className="grid grid-cols-2 gap-2">
          <div className="sk-kpi" style={{ minHeight: 0 }}>
            <div className="lab">Should have paid</div>
            <div className="n" style={{ fontSize: 20 }}>{p.invoice ? rupees(p.invoice.expectedMinor) : '—'}</div>
            {p.invoice && p.invoice.lateFeeMinor > 0 && (
              <div className="hint">
                {rupees(p.invoice.expectedMinor - p.invoice.lateFeeMinor)} bill
                {' + '}{rupees(p.invoice.lateFeeMinor)} late fee
              </div>
            )}
          </div>
          <div className="sk-kpi" style={{ minHeight: 0, borderColor: match === false ? 'var(--sk-bad)' : match ? 'var(--sk-good)' : 'var(--sk-line)' }}>
            <div className="lab">Parent says they paid</div>
            <div className="n" style={{ fontSize: 20, color: match === false ? 'var(--sk-bad)' : match ? 'var(--sk-good)' : undefined }}>
              {rupees(p.amountMinor)}
            </div>
          </div>
        </div>

        {match === true && (
          <p className="text-[11.5px]" style={{ color: 'var(--sk-good)' }}>✓ Exact match with the bill</p>
        )}
        {match === false && p.invoice && (
          <p className="text-[11.5px]" style={{ color: 'var(--sk-bad)' }}>
            {p.amountMinor < p.invoice.expectedMinor
              ? `Short by ${rupees(p.invoice.expectedMinor - p.amountMinor)} — accepting records a part payment.`
              : `Over by ${rupees(p.amountMinor - p.invoice.expectedMinor)} — the extra stays as credit on the student.`}
            {p.invoice.lateFeeMinor > 0 && ' The late fee is worked out to the day they say they paid, not today.'}
          </p>
        )}
        {match === null && (
          <p className="text-[11.5px]" style={{ color: 'var(--sk-ink-3)' }}>
            Not linked to a bill — accepting adds it as credit on the student.
          </p>
        )}

        {p.proofUrl ? (
          <a href={p.proofUrl} target="_blank" rel="noopener noreferrer"
             className="block overflow-hidden rounded-[11px] border"
             style={{ borderColor: 'var(--sk-line-2)' }}>
            <img src={p.proofUrl} alt={`Payment proof from ${p.student.name}`}
                 className="max-h-[240px] w-full object-contain" style={{ background: 'var(--sk-bg-2)' }} />
            <span className="flex items-center justify-center gap-1 p-1.5 text-[10.5px]"
                  style={{ color: 'var(--sk-brand-2)' }}>
              <ExternalLink size={11} /> open full size
            </span>
          </a>
        ) : (
          <p className="sk-state">No screenshot — {METHOD_LABEL[p.method]}.</p>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="sk-lab">Method</dt><dd>{METHOD_LABEL[p.method]}</dd>
          <dt className="sk-lab">Paid on</dt><dd>{fmtDate(p.paidOn)}</dd>
          <dt className="sk-lab">Reference</dt>
          <dd style={{ fontFamily: 'var(--sk-mono)' }}>{p.providerRef ?? '—'}</dd>
          {p.note && (<><dt className="sk-lab">Note</dt><dd>{p.note}</dd></>)}
          {p.receiptNumber && (<><dt className="sk-lab">Receipt</dt>
            <dd style={{ fontFamily: 'var(--sk-mono)' }}>{p.receiptNumber}</dd></>)}
          {p.ackNote && (<><dt className="sk-lab">Note sent</dt><dd>{p.ackNote}</dd></>)}
          {p.rejectionReason && (<><dt className="sk-lab">Reason</dt>
            <dd style={{ color: 'var(--sk-bad)' }}>{p.rejectionReason}</dd></>)}
        </dl>

        {p.status === 'SUBMITTED' && !rejecting && (
          <div className="flex flex-col gap-2">
            {/* Optional on purpose. A clerk clearing forty transfers accepts
                each in one click; the note is there for the one that needs a
                word — "short by ₹500", "this clears the fine too". Wrapped in
                a flex COLUMN because .sk-input declares no display or width,
                so a bare label + input sit side by side (layout-guard.test). */}
            <div className="flex flex-col gap-1">
              <label className="sk-lab" htmlFor="ack-note">
                Note to the parent <span style={{ opacity: 0.7 }}>(optional)</span>
              </label>
              <textarea
                id="ack-note"
                className="sk-input"
                rows={2}
                maxLength={300}
                value={ackNote}
                onChange={(e) => setAckNote(e.target.value)}
                placeholder="Received by NEFT on 28 Aug. Thank you."
              />
              <p className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
                Printed on their receipt word for word. Leave it blank and the
                receipt simply confirms the amount.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="sk-btn" data-variant="primary" disabled={busy}
                      onClick={() => onVerify(ackNote)}>
                <Check size={14} /> Accept &amp; issue receipt
              </button>
              <button className="sk-btn" disabled={busy} onClick={() => setRejecting(true)}>
                <X size={14} /> Turn down…
              </button>
            </div>
          </div>
        )}

        {p.status === 'VERIFIED' && !reversing && (
          <div className="flex flex-col gap-1">
            <button className="sk-btn self-start" disabled={busy} onClick={() => setReversing(true)}>
              Reverse this payment…
            </button>
            <p className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
              For a bounced cheque, a duplicate, or money matched to the wrong child.
              The original entry stays and an opposing one is posted beside it.
            </p>
          </div>
        )}

        {p.status === 'VERIFIED' && reversing && (
          <div className="flex flex-col gap-2 rounded-[11px] border p-3"
               style={{ borderColor: 'var(--sk-bad)', background: 'var(--sk-bad-tint)' }}>
            <label className="sk-lab" htmlFor="reverse-reason" style={{ color: 'var(--sk-bad)' }}>
              Why is it being reversed?
            </label>
            <select id="reverse-reason" className="sk-input" value={revReason}
                    onChange={(e) => setRevReason(e.target.value)}>
              {REVERSAL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-[10.5px]" style={{ color: 'var(--sk-bad)' }}>
              The student&rsquo;s balance goes back up by {rupees(p.amountMinor)} and the receipt
              is marked reversed. Nothing is deleted.
            </p>
            <div className="flex gap-2">
              <button className="sk-btn" onClick={() => setReversing(false)}>Cancel</button>
              <button className="sk-btn" data-variant="primary" disabled={busy}
                      onClick={() => onReverse(revReason)}>Reverse it</button>
            </div>
          </div>
        )}

        {p.status === 'SUBMITTED' && rejecting && (
          <div className="flex flex-col gap-2 rounded-[11px] border p-3" style={{ borderColor: 'var(--sk-line)' }}>
            <label className="sk-lab" htmlFor="reject-reason">What should the parent be told?</label>
            <select id="reject-reason" className="sk-input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
              They see this word for word on their fees page, so it has to tell them
              what to do next. Nothing is sent to them — tell them when you next speak.
            </p>
            <div className="flex gap-2">
              <button className="sk-btn" onClick={() => setRejecting(false)}>Cancel</button>
              <button className="sk-btn" data-variant="primary" disabled={busy} onClick={() => onReject(reason)}>
                Send this reason
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

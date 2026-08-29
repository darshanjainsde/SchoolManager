'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, ExternalLink, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
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

const TABS: { id: FeePaymentStatus; label: string }[] = [
  { id: 'SUBMITTED', label: 'Awaiting review' },
  { id: 'VERIFIED', label: 'Verified' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'REVERSED', label: 'Reversed' },
];

export default function VerifyPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [tab, setTab] = useState<FeePaymentStatus>('SUBMITTED');
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
    mutationFn: (id: string) => api.post<{ receipt: { number: string } }>(`/manage/fees/payments/${id}/verify`, {}),
    onSuccess: (r) => { invalidate(); toast.success(`Accepted — receipt ${r.receipt.number} sent to the parent`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/manage/fees/payments/${id}/reject`, { reason }),
    onSuccess: () => { invalidate(); toast.success('Turned down — the parent has been told why'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mismatches = rows.data?.filter((r) => r.amountMatchesBill === false).length ?? 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <header className="sk-pagehead flex items-end justify-between">
        <div>
          <h1>Payments to check</h1>
          <p>Parents send what they paid. You confirm it, and the receipt goes out straight away.</p>
        </div>
      </header>

      <div className="sk-tabs flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.id} className="sk-tab" onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? 'page' : undefined}
                  style={{
                    borderColor: tab === t.id ? 'var(--sk-brand)' : 'var(--sk-line-2)',
                    background: tab === t.id ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
                    color: tab === t.id ? 'var(--sk-brand-2)' : 'var(--sk-ink-2)',
                    border: '1px solid', borderRadius: 999, padding: '5px 13px',
                    fontSize: 12, fontWeight: 650,
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
              busy={verify.isPending || reject.isPending}
              onVerify={() => verify.mutate(selected.id)}
              onReject={(reason) => reject.mutate({ id: selected.id, reason })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PaymentDetail({
  p, busy, onVerify, onReject,
}: { p: PaymentRow; busy: boolean; onVerify: () => void; onReject: (reason: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECTION_REASONS[0]);
  useEffect(() => { setRejecting(false); }, [p.id]);

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
          {p.rejectionReason && (<><dt className="sk-lab">Reason</dt>
            <dd style={{ color: 'var(--sk-bad)' }}>{p.rejectionReason}</dd></>)}
        </dl>

        {p.status === 'SUBMITTED' && !rejecting && (
          <div className="flex flex-wrap gap-2">
            <button className="sk-btn" data-variant="primary" disabled={busy} onClick={onVerify}>
              <Check size={14} /> Accept &amp; send receipt
            </button>
            <button className="sk-btn" disabled={busy} onClick={() => setRejecting(true)}>
              <X size={14} /> Turn down…
            </button>
          </div>
        )}

        {p.status === 'SUBMITTED' && rejecting && (
          <div className="flex flex-col gap-2 rounded-[11px] border p-3" style={{ borderColor: 'var(--sk-line)' }}>
            <label className="sk-lab" htmlFor="reject-reason">What should the parent be told?</label>
            <select id="reject-reason" className="sk-input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
              They see this word for word, so it has to tell them what to do next.
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

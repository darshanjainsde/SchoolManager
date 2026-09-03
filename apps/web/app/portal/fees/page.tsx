'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, Upload } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import {
  METHOD_LABEL, fmtDate, rupees, toMinor,
  type BankInstructions, type FeePaymentMethod, type HowToPay, type StudentFees,
} from '@/lib/fees';

/**
 * The parent's fees page.
 *
 * Answers three questions without anyone having to ring the office: what do I
 * owe and what is it for, how do I pay it, and where has my payment got to.
 *
 * Every line carries the sentence the school wrote in setup — "Exam ₹800"
 * starts an argument, "Exam ₹800 — question papers, answer sheets and result
 * processing" ends one.
 */
export default function PortalFeesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [paying, setPaying] = useState<string | null>(null);

  const fees = useQuery({
    queryKey: ['me-fees', host], enabled: !!host, retry: false,
    queryFn: () => api.get<StudentFees>('/me/fees'),
  });
  const how = useQuery({
    queryKey: ['me-how-to-pay', host], enabled: !!host, retry: false,
    queryFn: () => api.get<HowToPay>('/me/fees/how-to-pay'),
  });

  if (fees.error instanceof ApiError && fees.error.status === 403) {
    return <p className="mx-auto max-w-md py-12 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>
      Fees are not part of your school&rsquo;s plan yet.
    </p>;
  }
  if (fees.isLoading || !fees.data) {
    return <p className="py-10 text-center text-sm" style={{ color: 'var(--sk-ink-3)' }}>Loading your fees…</p>;
  }

  const d = fees.data;
  const unpaid = d.invoices.filter((i) => !i.isPaid);
  const pending = d.payments.find((p) => p.status === 'SUBMITTED');

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>Fees</h1>
        <p className="text-[12.5px]" style={{ color: 'var(--sk-ink-3)' }}>
          {d.student.name} · {d.student.className ?? d.student.admissionNo}
        </p>
      </div>

      {pending && (
        <div className="sk-card" style={{ borderColor: 'var(--sk-amber)' }}>
          <div className="sk-card-b">
            <div className="flex items-center justify-between gap-2">
              <span className="sk-lab">Your last payment</span>
              <span className="sk-pill" data-tone="warn">Being checked</span>
            </div>
            <p className="text-[13px] font-semibold">
              {rupees(pending.amountMinor)} · sent {fmtDate(pending.submittedAt)}
            </p>
            <p className="text-[11.5px]" style={{ color: 'var(--sk-ink-3)' }}>
              The school usually checks this within one working day. Your receipt will
              appear on this page once they do — check back, or ask the office.
            </p>
          </div>
        </div>
      )}

      {d.balanceMinor <= 0 && unpaid.length === 0 && (
        <div className="sk-card">
          <div className="sk-card-b">
            <p className="sk-state">
              {d.balanceMinor < 0
                ? `Nothing due — and ${rupees(-d.balanceMinor)} is in credit on this account.`
                : 'Nothing due. Every bill is paid.'}
            </p>
          </div>
        </div>
      )}

      {unpaid.map((inv) => (
        <div key={inv.id} className="sk-card" style={{ borderColor: inv.isOverdue ? 'var(--sk-bad)' : undefined }}>
          <div className="sk-card-h">
            <h3>{inv.termName}</h3>
            <span className="sk-pill" data-tone={inv.isOverdue ? 'bad' : 'warn'} style={{ marginLeft: 'auto' }}>
              {inv.isOverdue ? 'Overdue' : `Due ${fmtDate(inv.dueDate)}`}
            </span>
            <p style={{ fontFamily: 'var(--sk-mono)', fontSize: 11 }}>{inv.number}</p>
          </div>
          <div className="sk-card-b">
            {inv.lines.map((l, i) => (
              <div key={i} className="flex items-start justify-between gap-3"
                   style={{ borderTop: i ? '1px solid var(--sk-line)' : undefined, paddingTop: i ? 8 : 0 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{l.categoryName}</div>
                  <div className="text-[11px] leading-snug" style={{ color: 'var(--sk-ink-3)' }}>
                    {l.categoryDescription}
                  </div>
                  {l.concessionReason && (
                    <div className="mt-0.5 text-[11px]" style={{ color: 'var(--sk-good)' }}>
                      −{rupees(l.concessionMinor)} · {l.concessionReason}
                    </div>
                  )}
                </div>
                <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums">
                  {rupees(l.netMinor)}
                </div>
              </div>
            ))}

            {inv.lateFeeMinor > 0 && (
              <div className="flex items-start justify-between gap-3 border-t pt-2"
                   style={{ borderColor: 'var(--sk-line)' }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--sk-amber-ink)' }}>
                    Late fee
                  </div>
                  {/* The rule, not just the number. A parent who can see how it
                      was worked out asks the office one question fewer. */}
                  {d.lateFeeRule && (
                    <div className="text-[11px] leading-snug" style={{ color: 'var(--sk-ink-3)' }}>
                      {d.lateFeeRule}
                    </div>
                  )}
                </div>
                <div className="whitespace-nowrap text-[13px] font-semibold tabular-nums"
                     style={{ color: 'var(--sk-amber-ink)' }}>
                  {rupees(inv.lateFeeMinor)}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-2"
                 style={{ borderColor: 'var(--sk-line-2)' }}>
              <span className="text-[13px] font-semibold">Due now</span>
              <span className="text-[17px] font-bold tabular-nums"
                    style={{ color: inv.isOverdue ? 'var(--sk-bad)' : 'var(--sk-ink)' }}>
                {rupees(inv.dueMinor)}
              </span>
            </div>
            {inv.paidMinor > 0 && (
              <p className="text-[11px]" style={{ color: 'var(--sk-good)' }}>
                {rupees(inv.paidMinor)} already received against this bill.
              </p>
            )}
            {inv.lateFeeMinor === 0 && !inv.isOverdue && d.lateFeeRule && (
              <p className="text-[11px]" style={{ color: 'var(--sk-ink-3)' }}>
                Paid after {fmtDate(inv.dueDate)}? A late fee of {d.lateFeeRule.toLowerCase()} applies.
              </p>
            )}

            {/* Present but disabled until the school's gateway is live — the
                button never appears from nowhere, and the reason is about the
                school's setup rather than an error. */}
            <div className="flex flex-col gap-1">
              <button className="sk-btn w-full" disabled aria-disabled="true"
                      title="Your school is being set up for online payment">
                Pay now — online
              </button>
              <p className="text-center text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
                {how.data?.canPayOnline
                  ? 'Available shortly'
                  : 'Coming soon — your school is being set up for online payment'}
              </p>
            </div>

            {how.data?.canPayByTransfer ? (
              <button className="sk-btn w-full" data-variant="primary"
                      onClick={() => setPaying(paying === inv.id ? null : inv.id)}>
                {paying === inv.id ? 'Hide bank details' : 'Pay by bank transfer'}
              </button>
            ) : (
              <p className="sk-state">
                Your school has not published a way to pay online yet — please contact the office.
              </p>
            )}
          </div>

          {paying === inv.id && (
            <PayByTransfer api={api} host={host} invoiceId={inv.id} dueMinor={inv.dueMinor}
                           onDone={() => { setPaying(null); qc.invalidateQueries({ queryKey: ['me-fees', host] }); }} />
          )}
        </div>
      ))}

      {d.payments.length > 0 && (
        <div className="sk-card">
          <div className="sk-card-h"><h3>Your payments</h3></div>
          <div className="sk-card-b">
            {d.payments.map((p) => (
              <div key={p.id} className="sk-row">
                <div className="min-w-0 flex-1">
                  <div className="nm">{rupees(p.amountMinor)} · {METHOD_LABEL[p.method]}</div>
                  <div className="meta">
                    {fmtDate(p.paidOn)}
                    {p.receiptNumber && ` · receipt ${p.receiptNumber}`}
                  </div>
                  {p.rejectionReason && (
                    <div className="mt-0.5 text-[11px]" style={{ color: 'var(--sk-bad)' }}>{p.rejectionReason}</div>
                  )}
                </div>
                <span className="sk-pill" data-tone={
                  p.status === 'VERIFIED' ? 'good' : p.status === 'SUBMITTED' ? 'warn' : 'bad'
                }>
                  {p.status === 'VERIFIED' ? 'Confirmed'
                    : p.status === 'SUBMITTED' ? 'Being checked'
                    : p.status === 'REJECTED' ? 'Not accepted' : 'Reversed'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Api = ReturnType<typeof useApi>;

/** Step 1 send the money, step 2 tell the school. Deliberately two steps. */
function PayByTransfer({
  api, host, invoiceId, dueMinor, onDone,
}: { api: Api; host: string | undefined; invoiceId: string; dueMinor: number; onDone: () => void }) {
  const [method, setMethod] = useState<FeePaymentMethod>('UPI');
  const [amount, setAmount] = useState(String(dueMinor / 100));
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const instructions = useQuery({
    queryKey: ['me-bank', host, invoiceId], enabled: !!host,
    queryFn: () => api.get<BankInstructions>(`/me/fees/bank-instructions?invoiceId=${invoiceId}`),
  });

  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('studentId', '00000000-0000-0000-0000-000000000000'); // ignored — the server uses your login
      form.append('invoiceId', invoiceId);
      form.append('method', method);
      form.append('amountMinor', String(toMinor(amount)));
      form.append('paidOn', paidOn);
      if (reference.trim()) form.append('reference', reference.trim());
      if (file) form.append('file', file);
      return api.postForm('/me/fees/submit', form);
    },
    onSuccess: () => { toast.success('Sent to the school. They usually check within one working day.'); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = (label: string, value: string) => {
    navigator.clipboard?.writeText(value).then(
      () => toast.success(`${label} copied`),
      () => toast.error('Could not copy — please select the text instead'),
    );
  };

  const b = instructions.data?.bank;

  return (
    <div className="border-t p-4" style={{ borderColor: 'var(--sk-line)', background: 'var(--sk-bg-2)' }}>
      <div className="sk-lab mb-2">Step 1 — send {rupees(dueMinor)}</div>

      {instructions.isLoading && <p className="sk-state">Getting the school&rsquo;s bank details…</p>}
      {instructions.error && <p className="sk-state err">{(instructions.error as Error).message}</p>}

      {b && (
        <div className="flex flex-col gap-2">
          <div className="text-[12.5px] leading-7" style={{ fontFamily: 'var(--sk-mono)' }}>
            <div>{b.accountName}</div>
            <div className="flex items-center gap-2">
              A/c {b.accountNumber}
              <button onClick={() => copy('Account number', b.accountNumber)} aria-label="Copy account number">
                <Copy size={12} style={{ color: 'var(--sk-brand-2)' }} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              IFSC {b.ifsc}
              <button onClick={() => copy('IFSC', b.ifsc)} aria-label="Copy IFSC">
                <Copy size={12} style={{ color: 'var(--sk-brand-2)' }} />
              </button>
            </div>
            {b.upiId && (
              <div className="flex items-center gap-2">
                UPI {b.upiId}
                <button onClick={() => copy('UPI ID', b.upiId!)} aria-label="Copy UPI ID">
                  <Copy size={12} style={{ color: 'var(--sk-brand-2)' }} />
                </button>
              </div>
            )}
          </div>

          {b.upiQrUrl && (
            <div className="flex items-center gap-3">
              <img src={b.upiQrUrl} alt="School UPI QR code" width={78} height={78}
                   className="rounded-[9px] border" style={{ borderColor: 'var(--sk-line-2)' }} />
              <p className="text-[11px] leading-snug" style={{ color: 'var(--sk-ink-2)' }}>
                Scan with any UPI app.<br />
                <strong>Enter {rupees(dueMinor)} yourself</strong> — the QR does not carry an amount.
              </p>
            </div>
          )}

          {b.upiIntentUri && (
            <a href={b.upiIntentUri} className="sk-btn w-full justify-center">
              Open a UPI app with {rupees(dueMinor)} filled in
            </a>
          )}

          {b.instructions && (
            <p className="text-[11.5px]" style={{ color: 'var(--sk-ink-3)' }}>{b.instructions}</p>
          )}
        </div>
      )}

      <div className="sk-lab mb-2 mt-4">Step 2 — tell the school</div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(['UPI', 'NEFT_IMPS', 'CHEQUE', 'CASH'] as FeePaymentMethod[]).map((m) => (
            <button key={m} onClick={() => setMethod(m)}
                    className="rounded-full border px-3 py-1 text-[11.5px] font-semibold"
                    style={{
                      borderColor: method === m ? 'var(--sk-brand)' : 'var(--sk-line-2)',
                      background: method === m ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
                      color: method === m ? 'var(--sk-brand-2)' : 'var(--sk-ink-2)',
                    }}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="sk-lab" htmlFor="pay-amount">Amount you paid</label>
          <input id="pay-amount" className="sk-input" inputMode="decimal" value={amount}
                 onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="sk-lab" htmlFor="pay-date">Date you paid</label>
          <input id="pay-date" type="date" className="sk-input" value={paidOn}
                 onChange={(e) => setPaidOn(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="sk-lab" htmlFor="pay-ref">
            {method === 'CASH' ? 'Receipt number (if you have one)' : 'UPI reference / UTR'}
          </label>
          <input id="pay-ref" className="sk-input" value={reference}
                 onChange={(e) => setReference(e.target.value)}
                 placeholder={method === 'CASH' ? 'optional' : '12-digit reference from your bank'} />
        </div>

        <div>
          <span className="sk-lab">Screenshot or receipt</span>
          <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-[11px] border border-dashed p-3 text-[12px]"
                 style={{ borderColor: 'var(--sk-line-2)' }}>
            <Upload size={14} style={{ color: 'var(--sk-brand-2)' }} />
            {file ? file.name : 'Choose an image (JPG or PNG, up to 5 MB)'}
            <input type="file" accept="image/*" className="hidden"
                   onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>

        <button className="sk-btn w-full justify-center" data-variant="primary"
                disabled={submit.isPending || toMinor(amount) <= 0}
                onClick={() => submit.mutate()}>
          {submit.isPending ? 'Sending…' : <><Check size={14} /> Send to school</>}
        </button>
        <p className="text-center text-[10.5px]" style={{ color: 'var(--sk-ink-3)' }}>
          The school usually checks this within one working day. Your receipt appears on
          this page once they do.
        </p>
      </div>
    </div>
  );
}

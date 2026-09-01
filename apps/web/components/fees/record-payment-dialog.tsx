'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { METHOD_LABEL, toMinor, type FeePaymentMethod, type StudentFees } from '@/lib/fees';

/**
 * Take a payment at the counter.
 *
 * This is the workflow the whole module was pitched around — a parent standing
 * at the desk with cash, found by name, receipted in seconds — and the endpoint
 * for it (`POST /manage/fees/payments/record`) shipped with no screen at all.
 *
 * It writes a SUBMITTED claim exactly like a parent's, rather than a verified
 * payment, so counter cash lands in the same queue as everything else: one
 * place to look, one day-close number, and a clerk cannot mint money in one
 * click. Accepting it is still a separate act on the verify desk.
 *
 * PORTALLED to <body> carrying .skosx — `.sk-anim > *` animates transform on
 * the page root, which makes it the containing block for position:fixed, so an
 * inline dialog would size itself to the page column and open below the fold.
 */
export function RecordPaymentDialog({
  student, invoices, onClose,
}: {
  student: StudentFees['student'];
  invoices: StudentFees['invoices'];
  onClose: () => void;
}) {
  const api = useApi({ audience: 'school' });
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);

  const unpaid = invoices.filter((i) => !i.isPaid);
  const [invoiceId, setInvoiceId] = useState(unpaid[0]?.id ?? '');
  const [method, setMethod] = useState<FeePaymentMethod>('CASH');
  const [amount, setAmount] = useState(unpaid[0] ? String(unpaid[0].dueMinor / 100) : '');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select, input')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => {
      // Multipart, because the endpoint accepts an optional proof image and a
      // multipart body sends every field as a string — which is why the DTO
      // carries @Type(() => Number) on amountMinor.
      const form = new FormData();
      form.append('studentId', student.id);
      if (invoiceId) form.append('invoiceId', invoiceId);
      form.append('method', method);
      form.append('amountMinor', String(toMinor(amount)));
      form.append('paidOn', paidOn);
      if (reference.trim()) form.append('reference', reference.trim());
      if (note.trim()) form.append('note', note.trim());
      return api.post('/manage/fees/payments/record', form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fee-student'] });
      qc.invalidateQueries({ queryKey: ['fee-payments'] });
      qc.invalidateQueries({ queryKey: ['fee-summary'] });
      qc.invalidateQueries({ queryKey: ['fee-students'] });
      toast.success('Recorded — confirm it on the verify desk to issue the receipt');
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="skosx fixed inset-0 z-50 grid place-items-center p-4"
         style={{ background: 'rgba(20,18,36,0.45)' }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Record a payment"
           className="sk-card w-full max-w-md" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div className="sk-card-h">
          <h3>Record a payment</h3>
          <p>{student.name} · {student.className ?? student.admissionNo}</p>
        </div>
        <div className="sk-card-b">
          {unpaid.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="sk-lab" htmlFor="rp-invoice">Against which bill</label>
              <select id="rp-invoice" className="sk-input" value={invoiceId}
                      onChange={(e) => {
                        setInvoiceId(e.target.value);
                        const inv = unpaid.find((i) => i.id === e.target.value);
                        if (inv) setAmount(String(inv.dueMinor / 100));
                      }}>
                {unpaid.map((i) => (
                  <option key={i.id} value={i.id}>{i.termName} — ₹{(i.dueMinor / 100).toLocaleString('en-IN')} due</option>
                ))}
                <option value="">Not against a bill (advance)</option>
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="sk-lab">How they paid</span>
            <div className="flex flex-wrap gap-1.5">
              {(['CASH', 'UPI', 'NEFT_IMPS', 'CHEQUE'] as FeePaymentMethod[]).map((m) => (
                <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m}
                        className="rounded-full border px-3 py-1.5 text-[12px] font-semibold"
                        style={{
                          borderColor: method === m ? 'var(--sk-brand)' : 'var(--sk-line-2)',
                          background: method === m ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
                          color: method === m ? 'var(--sk-brand-2)' : 'var(--sk-ink-2)',
                          cursor: 'pointer',
                        }}>
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="sk-lab" htmlFor="rp-amount">Amount taken (₹)</label>
            <input id="rp-amount" className="sk-input" inputMode="decimal"
                   value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="sk-lab" htmlFor="rp-date">Date</label>
            <input id="rp-date" type="date" className="sk-input" value={paidOn}
                   onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="sk-lab" htmlFor="rp-ref">
              {method === 'CHEQUE' ? 'Cheque number' : method === 'CASH' ? 'Reference (optional)' : 'Reference / UTR'}
            </label>
            <input id="rp-ref" className="sk-input" value={reference}
                   onChange={(e) => setReference(e.target.value)}
                   placeholder={method === 'CASH' ? 'optional' : ''} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="sk-lab" htmlFor="rp-note">Note (optional)</label>
            <input id="rp-note" className="sk-input" value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="Taken at the office by…" />
          </div>

          <p className="text-[11px]" style={{ color: 'var(--sk-ink-3)' }}>
            This goes into the same queue a parent&rsquo;s claim does. Confirm it on the
            verify desk and the receipt is issued then — so one person taking cash
            cannot also be the one who signs it off.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t p-3"
             style={{ borderColor: 'var(--sk-line)', position: 'sticky', bottom: 0, background: 'var(--sk-card)' }}>
          <button className="sk-btn" onClick={onClose}>Cancel</button>
          <button className="sk-btn" data-variant="primary"
                  disabled={save.isPending || toMinor(amount) <= 0}
                  onClick={() => save.mutate()}>
            {save.isPending ? 'Recording…' : 'Record it'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

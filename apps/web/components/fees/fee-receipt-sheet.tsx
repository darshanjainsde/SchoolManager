'use client';
import { METHOD_LABEL, rupees, type FeeReceiptDocument } from '@/lib/fees';

/**
 * ONE RECEIPT, AS PAPER.
 *
 * Rendered twice from the same markup — once in `.rc-preview` on screen, once
 * inside the body-level print portal — so what a family sees is exactly what
 * their printer produces. Every value comes from the API's receipt document;
 * nothing is recomputed here, because a receipt that disagreed with the ledger
 * about a rupee would be worse than no receipt at all.
 *
 * Deliberately NOT theme-aware: see receipt-print.css. A receipt is paper.
 */

function fmt(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function FeeReceiptSheet({ r }: { r: FeeReceiptDocument }) {
  const allocated = r.allocations.reduce((a, x) => a + x.amountMinor, 0);

  return (
    <div className="rc-sheet">
      <div className="rc-head">
        <div className="rc-school">{r.school.name}</div>
        {(r.school.addressLines.length > 0 || r.school.phone || r.school.email) && (
          <div className="rc-addr">
            {r.school.addressLines.map((l) => <div key={l}>{l}</div>)}
            {(r.school.phone || r.school.email) && (
              <div>{[r.school.phone, r.school.email].filter(Boolean).join(' · ')}</div>
            )}
          </div>
        )}
        <div className="rc-title">Fee Receipt</div>
      </div>

      <div className="rc-meta">
        <span>Receipt no. <b>{r.receiptNumber}</b></span>
        <span>Issued <b>{fmt(r.issuedAt)}</b></span>
      </div>

      <div className="rc-who">
        <div className="rc-name">{r.student.name}</div>
        <div className="rc-sub">
          Admission no. {r.student.admissionNo}
          {r.student.className ? ` · Class ${r.student.className}` : ''}
        </div>
      </div>

      <table className="rc-table">
        <thead>
          <tr>
            <th>Received towards</th>
            <th className="rc-amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          {r.allocations.map((a, i) => (
            <tr key={`${a.invoiceNumber}-${a.categoryName}-${i}`}>
              <td>
                {a.categoryName}
                <div className="rc-for">{a.termName} · bill {a.invoiceNumber}</div>
              </td>
              <td className="rc-amt">{rupees(a.amountMinor)}</td>
            </tr>
          ))}

          {/* Shown rather than dropped, so the lines add up to the total. An
              advance is money the school is holding, and the family's copy is
              the only place they can see it was not simply lost. */}
          {r.unallocatedMinor !== 0 && (
            <tr>
              <td>
                Advance held against future bills
                <div className="rc-for">Not applied to any bill yet</div>
              </td>
              <td className="rc-amt">{rupees(r.unallocatedMinor)}</td>
            </tr>
          )}

          {r.allocations.length === 0 && r.unallocatedMinor === 0 && (
            <tr>
              <td colSpan={2} className="rc-for">No allocation recorded.</td>
            </tr>
          )}

          <tr className="rc-total">
            <td>Total received</td>
            <td className="rc-amt">{rupees(allocated + r.unallocatedMinor)}</td>
          </tr>
        </tbody>
      </table>

      <div className="rc-how">
        <div><span className="rc-k">Paid by</span>{METHOD_LABEL[r.payment.method]}</div>
        <div><span className="rc-k">Paid on</span>{fmt(r.payment.paidOn)}</div>
        {r.payment.providerRef && (
          <div><span className="rc-k">Reference</span>{r.payment.providerRef}</div>
        )}
      </div>

      {/* The school speaking, verbatim. Rendered as a text node — never
          interpolated as HTML — because a clerk types this. */}
      {r.payment.ackNote && (
        <div className="rc-note">
          <span className="rc-k">Note from the school</span>
          {r.payment.ackNote}
        </div>
      )}

      <div className="rc-foot">
        <div className="rc-comp">
          Computer-generated receipt. Valid without a signature.
          {r.payment.verifiedAt ? ` Confirmed by the school office on ${fmt(r.payment.verifiedAt)}.` : ''}
        </div>
        <div className="rc-sign">Authorised signatory</div>
      </div>
    </div>
  );
}

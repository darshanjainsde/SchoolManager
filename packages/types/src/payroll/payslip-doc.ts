/**
 * THE PAYSLIP, AS A DOCUMENT — one HTML page shared by the console (an admin
 * or the accounts officer printing anybody's), the two portals (a teacher or
 * a staff member printing their own), and the phone (printed to a PDF).
 *
 * ONE definition, deliberately. A payslip is the piece of paper a person
 * takes to a bank for a loan; the office's copy and the teacher's copy have
 * to be the same document or it is not evidence of anything. Building it
 * twice — once for the console, once for the portal — is how the two drift.
 *
 * Literal ink, millimetres, hairlines: it is paper, not a screen, so it
 * carries no design tokens and renders the same in both themes and in print.
 */

export interface PayslipDocLine {
  key: string;
  name: string;
  kind: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST';
  amountMinor: number;
}

export interface PayslipDoc {
  id: string;
  /** "September 2026" — already worded, so every surface says it the same way. */
  periodLabel: string;
  periodYear: number;
  periodMonth: number;
  person: {
    name: string;
    designation: string | null;
    kind: 'TEACHER' | 'STAFF';
    /** Shown only when the school holds them; a blank line on paper is worse than none. */
    pan: string | null;
    uan: string | null;
    bankAccountLast4: string | null;
    joinedOn: string | null;
  };
  lines: PayslipDocLine[];
  daysInMonth: number;
  daysPaid: number;
  /** The half day, kept separate so the slip can print "27½ of 30 days". */
  lopHalfDays: number;
  grossMinor: number;
  deductionMinor: number;
  netMinor: number;
  employerCostMinor: number;
  incomeTaxMinor: number;
  taxRegime: 'NEW' | 'OLD';
  ytdGrossMinor: number;
  ytdTaxMinor: number;
  /** Null until the run is marked paid — the slip says "not yet paid" instead of lying. */
  paidOn: string | null;
  school: { name: string };
  /** Which rule book worked this out, so a query years later has an answer. */
  rulesAsAt: string | null;
  packVersion: string | null;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** ₹24,500 — Indian grouping, paise only when there are any. */
export function payslipRupees(amountMinor: number): string {
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 100);
  const paise = abs % 100;
  const s = String(whole);
  const grouped = s.length <= 3 ? s : `${s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${s.slice(-3)}`;
  return `${amountMinor < 0 ? '−' : ''}₹${paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`}`;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** "27½ of 30 days" — a school writes a half day, not 27.5. */
export function daysPaidLabel(daysPaid: number, lopHalfDays: number, daysInMonth: number): string {
  const half = lopHalfDays > 0;
  // `daysPaid` is stored rounded; the half day is what the rounding dropped.
  const whole = half ? Math.floor(daysPaid) : daysPaid;
  return `${whole}${half ? '½' : ''} of ${daysInMonth} days`;
}

/** A file name a person can find again: "Payslip Asha Rao September 2026.pdf". */
export function payslipFileName(d: PayslipDoc, ext = 'pdf'): string {
  const safe = `${d.person.name} ${d.periodLabel}`.replace(/[^\wÀ-ɏ ]+/g, '').trim().replace(/\s+/g, ' ');
  return `Payslip ${safe}.${ext}`;
}

function rows(lines: PayslipDocLine[]): string {
  if (lines.length === 0) return '<tr><td class="ps-none" colspan="2">Nothing</td></tr>';
  return lines
    .map((l) => `<tr><td>${esc(l.name)}</td><td class="ps-amt">${esc(payslipRupees(l.amountMinor))}</td></tr>`)
    .join('');
}

/**
 * Is this actually a payslip document?
 *
 * The portals fall back to their own summary when the API is older than this
 * route, and an API that answers with something else entirely must not reach
 * the renderer. One cheap structural check, at the boundary.
 */
export function isPayslipDoc(v: unknown): v is PayslipDoc {
  const d = v as Partial<PayslipDoc> | null;
  return !!d && Array.isArray(d.lines) && typeof d.netMinor === 'number'
    && typeof d.periodLabel === 'string' && !!d.person && typeof d.person.name === 'string';
}

/**
 * The payslip's BODY markup — the web wraps it in its print portal, the app
 * in a whole document.
 */
export function payslipBody(d: PayslipDoc): string {
  // Defensive on purpose: this renders in a portal a teacher opens on their
  // own phone, and a missing `lines` would white-screen the page rather than
  // show a worse payslip. `isPayslipDoc` is the gate callers should use; this
  // is the second belt.
  const all = Array.isArray(d.lines) ? d.lines : [];
  const earnings = all.filter((l) => l.kind === 'EARNING');
  const deductions = all.filter((l) => l.kind === 'DEDUCTION');
  const employer = all.filter((l) => l.kind === 'EMPLOYER_COST');
  const shortMonth = d.daysPaid !== d.daysInMonth || d.lopHalfDays > 0;

  return `<div class="ps">
  <div class="ps-head">
    <h1>${esc(d.school.name)}</h1>
    <div class="ps-kind">Payslip · ${esc(d.periodLabel)}</div>
  </div>

  <table class="ps-who">
    <tr><th>Name</th><td>${esc(d.person.name)}${d.person.designation ? ` · ${esc(d.person.designation)}` : ''}</td></tr>
    ${shortMonth ? `<tr><th>Paid for</th><td>${esc(daysPaidLabel(d.daysPaid, d.lopHalfDays, d.daysInMonth))}</td></tr>` : ''}
    ${d.person.pan ? `<tr><th>PAN</th><td>${esc(d.person.pan)}</td></tr>` : ''}
    ${d.person.uan ? `<tr><th>UAN</th><td>${esc(d.person.uan)}</td></tr>` : ''}
    ${d.person.bankAccountLast4 ? `<tr><th>Paid into</th><td>A/c ending ${esc(d.person.bankAccountLast4)}</td></tr>` : ''}
    <tr><th>Tax regime</th><td>${d.taxRegime === 'NEW' ? 'New' : 'Old'}</td></tr>
  </table>

  <table class="ps-ledger">
    <thead><tr><th>Earned</th><th class="ps-amt">Amount</th><th>Taken off</th><th class="ps-amt">Amount</th></tr></thead>
    <tbody>
      <tr>
        <td class="ps-col" colspan="2"><table class="ps-sub">${rows(earnings)}</table></td>
        <td class="ps-col" colspan="2"><table class="ps-sub">${rows(deductions)}</table></td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td>Gross</td><td class="ps-amt">${esc(payslipRupees(d.grossMinor))}</td>
        <td>Deductions</td><td class="ps-amt">${esc(payslipRupees(d.deductionMinor))}</td>
      </tr>
    </tfoot>
  </table>

  <div class="ps-net">
    <span>Paid to the bank</span>
    <b>${esc(payslipRupees(d.netMinor))}</b>
  </div>

  ${employer.length > 0 ? `<div class="ps-also">
    <div class="ps-also-h">The school also paid in, on top</div>
    <table class="ps-sub">${rows(employer)}</table>
    <div class="ps-note">Not part of the pay to the bank. It goes to the provident fund and ESI in this person’s name.</div>
  </div>` : ''}

  <table class="ps-who ps-ytd">
    <tr><th>This year so far</th><td>${esc(payslipRupees(d.ytdGrossMinor))} earned · ${esc(payslipRupees(d.ytdTaxMinor))} tax</td></tr>
    <tr><th>Status</th><td>${d.paidOn ? `Paid ${esc(day(d.paidOn))}` : 'Approved — not yet paid'}</td></tr>
  </table>

  <div class="ps-foot">
    Generated by Sckools — valid without a signature.${d.rulesAsAt ? ` Worked out on the rules current as at ${esc(day(d.rulesAsAt))}${d.packVersion ? ` (${esc(d.packVersion)})` : ''}.` : ''}
  </div>
</div>`;
}

/** The payslip's own CSS — the same rules on screen, in print, and in the PDF. */
export const PAYSLIP_CSS = `
.ps{font-family:Georgia,"Times New Roman",serif;color:#211D45;max-width:640px;margin:0 auto;padding:22px 24px;border:1px solid #d9d4c4;border-radius:6px;background:#fff}
.ps-head{text-align:center;border-bottom:2px solid #211D45;padding-bottom:10px}
.ps-head h1{font-size:20px;margin:0;font-weight:700}
.ps-kind{font-family:Helvetica,Arial,sans-serif;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin-top:3px}
.ps-who{width:100%;border-collapse:collapse;margin-top:14px;font-size:12.5px;text-align:left}
.ps-who th{font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#666;font-weight:600;padding:6px 8px 6px 0;width:26%;vertical-align:top;border-top:1px solid #e5e5e5}
.ps-who td{padding:6px 0;border-top:1px solid #e5e5e5}
.ps-ledger{width:100%;border-collapse:collapse;margin-top:16px;font-size:12.5px;table-layout:fixed}
.ps-ledger thead th{font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#666;font-weight:600;text-align:left;padding:6px 0;border-bottom:1px solid #211D45}
.ps-ledger thead th.ps-amt{text-align:right}
.ps-col{vertical-align:top;padding:0}
.ps-col:first-child{padding-right:14px;border-right:1px solid #e5e5e5}
.ps-col:last-child{padding-left:14px}
.ps-sub{width:100%;border-collapse:collapse}
.ps-sub td{padding:4px 0;border-bottom:1px solid #f0efe9}
.ps-none{color:#888;font-style:italic}
.ps-amt{text-align:right;font-family:Menlo,Consolas,monospace;white-space:nowrap}
.ps-ledger tfoot td{padding:7px 0;border-top:1px solid #211D45;font-weight:700}
.ps-net{display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-top:14px;padding:10px 12px;background:#f5f3ec;border-radius:5px;font-size:15px}
.ps-net b{font-family:Menlo,Consolas,monospace;font-size:19px}
.ps-also{margin-top:14px;padding:10px 12px;border:1px dashed #d9d4c4;border-radius:5px}
.ps-also-h{font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#666;font-weight:600;margin-bottom:4px}
.ps-note{font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#666;margin-top:6px}
.ps-ytd{margin-top:14px}
.ps-foot{margin-top:16px;font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#666;text-align:center}
@media print{.ps{border:0;padding:0;max-width:none}.ps-net{background:transparent;border:1px solid #211D45}}
`;

/** A whole printable document — what the phone hands to expo-print. */
export function payslipHtml(d: PayslipDoc): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(payslipFileName(d, ''))
    .replace(/\.$/, '')}</title><style>@page{size:A4;margin:14mm}body{margin:0}${PAYSLIP_CSS}</style></head><body>${payslipBody(d)}</body></html>`;
}

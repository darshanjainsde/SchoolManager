'use client';
import { useState } from 'react';
import { isPayslipDoc, type PayslipDoc } from '@skoolos/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { PayslipSheet } from '@/components/pay/payslip-sheet';
import { PayDetailsCard } from '@/components/pay-details-card';
import { monthName, rupees, toMinor } from '@/app/app/pay/ui';
import type { PayLine } from '@/app/app/pay/types';

interface MySlip {
  id: string; name: string; designation: string | null; lines: PayLine[];
  daysInMonth: number; daysPaid: number;
  grossMinor: number; deductionMinor: number; netMinor: number; employerCostMinor: number;
  incomeTaxMinor: number; ytdGrossMinor: number; ytdTaxMinor: number; taxRegime: 'NEW' | 'OLD';
  payRun: { periodYear: number; periodMonth: number; status: string; paidAt: string | null };
}
interface Declaration {
  id: string; regime: 'NEW' | 'OLD'; rentAnnualMinor: number; metro: boolean; landlordPan: string | null;
  section80cMinor: number; section80dMinor: number; homeLoanInterestMinor: number;
  otherIncomeMinor: number; previousEmployerSalaryMinor: number; previousEmployerTdsMinor: number;
  status: 'DRAFT' | 'SUBMITTED';
}
interface MyPay {
  currency: string; personKind: 'TEACHER' | 'STAFF'; taxYear: number; taxYearLabel: string;
  regimes: { key: 'NEW' | 'OLD'; label: string; allows: { hra: boolean; s80c: boolean; s80d: boolean; homeLoanInterest: boolean } }[];
  defaultRegime: 'NEW' | 'OLD';
  declaration: Declaration | null;
  payslips: MySlip[];
  empty: boolean;
}

/**
 * MY PAY — the same screen for a teacher and for a driver, because the
 * question is the same one: what reached my bank, and why is it that number.
 *
 * Only LOCKED months appear. A draft figure in an employee's hand is a
 * conversation the office cannot win, and a payslip that changes after it has
 * been read costs more trust than it saves time.
 */
export function MyPay() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['my-pay'], enabled: !!host, queryFn: () => api.get<MyPay>('/me/pay') });

  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-6" />;
  const d = q.data;
  const latest = d?.payslips[0] ?? null;
  const open = openId ? d?.payslips.find((p) => p.id === openId) ?? null : latest;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
      <div className="grid gap-4">
        <div className="sk-card">
          <div className="sk-card-h"><h3>My pay</h3></div>
          <div className="sk-card-b">
            {q.isPending ? <p className="sk-state">Loading your payslips…</p> : null}
            {d?.empty ? (
              <p className="sk-state">
                No payslip yet. One appears here the month your school finishes its first pay run.
              </p>
            ) : null}
            {open ? <OpenSlip slip={open} /> : null}
          </div>
        </div>

        {d && d.payslips.length > 1 ? (
          <div className="sk-card">
            <div className="sk-card-h"><h3>Earlier months</h3></div>
            <div className="sk-card-b">
              {d.payslips.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="sk-row"
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }}
                  onClick={() => setOpenId(p.id)}
                  aria-current={open?.id === p.id ? 'true' : undefined}
                >
                  <div>
                    <div className="nm">{monthName(p.payRun.periodMonth)} {p.payRun.periodYear}</div>
                    <div className="meta">{p.daysPaid === p.daysInMonth ? 'full month' : `${p.daysPaid} of ${p.daysInMonth} days`}</div>
                  </div>
                  <span className="sp" />
                  <b style={{ fontFamily: 'var(--sk-mono)' }}>{rupees(p.netMinor)}</b>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4">
        {/* Same rows the office writes. A person who fills their account in
            here clears the school's "no bank account" exception at once. */}
        <PayDetailsCard endpoint="/me/pay/details" />
        {d ? <DeclarationCard pay={d} /> : null}
      </div>
    </div>
  );
}

function Slip({ slip }: { slip: MySlip }) {
  const earnings = slip.lines.filter((l) => l.kind === 'EARNING');
  const deductions = slip.lines.filter((l) => l.kind === 'DEDUCTION');
  const employer = slip.lines.filter((l) => l.kind === 'EMPLOYER_COST');
  return (
    <div className="grid gap-3">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{monthName(slip.payRun.periodMonth)} {slip.payRun.periodYear}</b>
        <span className="sk-muted" style={{ fontSize: 12 }}>
          {slip.daysPaid === slip.daysInMonth ? 'full month' : `paid for ${slip.daysPaid} of ${slip.daysInMonth} days`}
        </span>
      </div>

      <Group title="Earned" lines={earnings} total={slip.grossMinor} totalLabel="Gross" />
      <Group title="Taken off" lines={deductions} total={slip.deductionMinor} totalLabel="Deductions" />

      <div style={{ borderTop: '1px solid var(--sk-line-2)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>Paid to you</b>
        <b style={{ fontSize: 15, fontFamily: 'var(--sk-mono)' }}>{rupees(slip.netMinor)}</b>
      </div>

      {employer.length > 0 ? (
        <div style={{ background: 'var(--sk-bg-2)', borderRadius: 10, padding: '10px 12px' }}>
          <p className="sk-lab" style={{ marginBottom: 6 }}>Your school also paid in</p>
          {employer.map((l) => (
            <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '3px 0' }}>
              <span>{l.name}</span>
              <span style={{ fontFamily: 'var(--sk-mono)' }}>{rupees(l.amountMinor)}</span>
            </div>
          ))}
          <p className="sk-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            This is on top of your pay, not out of it. It goes to the provident fund in your name.
          </p>
        </div>
      ) : null}

      <p className="sk-muted" style={{ fontSize: 11.5 }}>
        This year so far: {rupees(slip.ytdGrossMinor)} earned, {rupees(slip.ytdTaxMinor)} tax.
        {' '}On the {slip.taxRegime === 'NEW' ? 'new' : 'old'} tax regime.
      </p>
    </div>
  );
}

function Group({ title, lines, total, totalLabel }: { title: string; lines: PayLine[]; total: number; totalLabel: string }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="sk-lab" style={{ marginBottom: 6 }}>{title}</p>
      {lines.map((l) => (
        <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--sk-line)' }}>
          <span>{l.name}</span>
          <span style={{ fontFamily: 'var(--sk-mono)' }}>{rupees(l.amountMinor)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, paddingTop: 7, marginTop: 4, borderTop: '1px solid var(--sk-line-2)', fontWeight: 650 }}>
        <span>{totalLabel}</span>
        <span style={{ fontFamily: 'var(--sk-mono)' }}>{rupees(total)}</span>
      </div>
    </div>
  );
}

/**
 * The declaration — India calls it Form 124 since April 2026 (it was Form
 * 12BB). The screen only asks for what the chosen regime actually uses: on
 * the new regime rent and 80C are worth nothing, and collecting them anyway
 * would be asking a teacher to type numbers into a hole.
 */
function DeclarationCard({ pay }: { pay: MyPay }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const d = pay.declaration;
  const [regime, setRegime] = useState<'NEW' | 'OLD'>(d?.regime ?? pay.defaultRegime);
  const [rent, setRent] = useState(d ? String(d.rentAnnualMinor / 100) : '');
  const [metro, setMetro] = useState(d?.metro ?? false);
  const [s80c, setS80c] = useState(d ? String(d.section80cMinor / 100) : '');
  const [s80d, setS80d] = useState(d ? String(d.section80dMinor / 100) : '');
  const [prevSalary, setPrevSalary] = useState(d ? String(d.previousEmployerSalaryMinor / 100) : '');
  const [prevTds, setPrevTds] = useState(d ? String(d.previousEmployerTdsMinor / 100) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allows = pay.regimes.find((r) => r.key === regime)?.allows ?? { hra: false, s80c: false, s80d: false, homeLoanInterest: false };

  async function save(submit: boolean) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.post('/me/pay/declaration', {
        taxYear: pay.taxYear, regime,
        rentAnnualMinor: toMinor(rent), metro,
        section80cMinor: toMinor(s80c), section80dMinor: toMinor(s80d),
        previousEmployerSalaryMinor: toMinor(prevSalary), previousEmployerTdsMinor: toMinor(prevTds),
        submit,
      });
      await qc.invalidateQueries({ queryKey: ['my-pay'] });
      setMsg(submit ? 'Sent to the office. Your tax is worked out again on the next pay run.' : 'Saved as a draft.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally { setBusy(false); }
  }

  return (
    <div className="sk-card" style={{ alignSelf: 'start' }}>
      <div className="sk-card-h">
        <h3>Tax declaration {pay.taxYearLabel}</h3>
        {d?.status === 'SUBMITTED' ? <span className="sk-pill" data-tone="good">Sent</span> : null}
      </div>
      <div className="sk-card-b grid gap-3">
        <label className="grid gap-1">
          <span className="sk-lab">Tax regime</span>
          <select className="sk-input" value={regime} onChange={(e) => setRegime(e.target.value as 'NEW' | 'OLD')}>
            {pay.regimes.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>

        {allows.hra ? (
          <>
            <label className="grid gap-1">
              <span className="sk-lab">Rent paid this year (₹)</span>
              <input className="sk-input" inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="240000" />
            </label>
            <label style={{ display: 'flex', gap: 9, alignItems: 'center', minHeight: 32 }}>
              <input type="checkbox" checked={metro} onChange={(e) => setMetro(e.target.checked)} />
              <span style={{ fontSize: 13 }}>I live in Delhi, Mumbai, Kolkata or Chennai</span>
            </label>
          </>
        ) : null}

        {allows.s80c ? (
          <label className="grid gap-1">
            <span className="sk-lab">Savings under 80C (₹)</span>
            <input className="sk-input" inputMode="decimal" value={s80c} onChange={(e) => setS80c(e.target.value)} placeholder="150000" />
          </label>
        ) : null}
        {allows.s80d ? (
          <label className="grid gap-1">
            <span className="sk-lab">Health insurance under 80D (₹)</span>
            <input className="sk-input" inputMode="decimal" value={s80d} onChange={(e) => setS80d(e.target.value)} placeholder="25000" />
          </label>
        ) : null}

        {!allows.hra && !allows.s80c ? (
          <p className="sk-muted" style={{ fontSize: 12 }}>
            On this regime rent and savings do not reduce the tax, so there is nothing to declare for them.
            The standard deduction is already applied for you.
          </p>
        ) : null}

        <details>
          <summary className="sk-lab" style={{ cursor: 'pointer' }}>I worked somewhere else this year</summary>
          <div className="grid gap-3" style={{ marginTop: 10 }}>
            <label className="grid gap-1">
              <span className="sk-lab">Salary from the previous employer (₹)</span>
              <input className="sk-input" inputMode="decimal" value={prevSalary} onChange={(e) => setPrevSalary(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="sk-lab">Tax they already deducted (₹)</span>
              <input className="sk-input" inputMode="decimal" value={prevTds} onChange={(e) => setPrevTds(e.target.value)} />
            </label>
            <p className="sk-muted" style={{ fontSize: 11.5 }}>
              Without this your tax is worked out as though this job were your only one, and March comes as a shock.
            </p>
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="sk-btn" disabled={busy} onClick={() => void save(false)}>Save draft</button>
          <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={busy} onClick={() => void save(true)}>
            {busy ? 'Sending…' : 'Send to the office'}
          </button>
        </div>
        {msg ? <p className="sk-state">{msg}</p> : null}
        {error ? <p className="sk-state err">{error}</p> : null}
      </div>
    </div>
  );
}

/**
 * THE PAYSLIP A PERSON OPENED — the real document, with Print and Download
 * on it, because those are the two things anybody ever wants from a payslip.
 *
 * It is FETCHED, not rebuilt from the summary: the server assembles one
 * payslip for the console and for `/me`, so what a teacher takes to a bank is
 * what the office has. Not hidden behind a disclosure either — a control
 * nobody can see is a control that does not exist, which is the whole lesson
 * of the payslip that used to open 17,000px down the page.
 *
 * While it loads, and on an older API with no such route, the summary below
 * still renders: a worse payslip, never an empty card.
 */
function OpenSlip({ slip }: { slip: MySlip }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({
    queryKey: ['my-payslip-doc', slip.id], enabled: !!host, retry: false,
    queryFn: () => api.get<PayslipDoc>(`/me/pay/payslips/${slip.id}/document`),
  });
  if (isPayslipDoc(q.data)) return <PayslipSheet doc={q.data} />;
  return <Slip slip={slip} />;
}

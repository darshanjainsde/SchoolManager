'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Drawer } from './drawer';
import { Card, CardBody, CardHead, EmptyRow, RunPill, TableWrap, Td, Th, monthName, rupees } from './ui';
import type { Payslip, RunDetail, RunRow } from './types';

/** PAYSLIPS — any month, any person, exactly as it was paid. */
export default function PayslipsTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [runId, setRunId] = useState<string | null>(null);
  const [openSlip, setOpenSlip] = useState<Payslip | null>(null);
  const [q, setQ] = useState('');

  const runs = useQuery({ queryKey: ['pay-runs'], enabled: !!host, queryFn: () => api.get<RunRow[]>('/payroll/runs') });
  const chosen = runId ?? runs.data?.[0]?.id ?? null;
  const detail = useQuery({ queryKey: ['pay-run', chosen], enabled: !!host && !!chosen, queryFn: () => api.get<RunDetail>(`/payroll/runs/${chosen}`) });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = detail.data?.payslips ?? [];
    return term ? all.filter((p) => p.name.toLowerCase().includes(term)) : all;
  }, [detail.data, q]);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHead>
          <h3>Payslips</h3>
          <div className="flex flex-wrap gap-2">
            <select className="sk-input" value={chosen ?? ''} onChange={(e) => { setRunId(e.target.value); setOpenSlip(null); }} aria-label="Month" style={{ minWidth: 0, width: '100%', maxWidth: '14em' }}>
              {runs.data?.map((r) => <option key={r.id} value={r.id}>{monthName(r.periodMonth)} {r.periodYear}</option>)}
            </select>
            <input className="sk-input" style={{ maxWidth: '14em' }} placeholder="Find a name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
          </div>
        </CardHead>
        <CardBody>
          {runs.isError ? <QueryError error={runs.error} onRetry={runs.refetch} className="py-4" /> : null}
          {runs.data && runs.data.length === 0 ? <EmptyRow>No month has been run yet.</EmptyRow> : null}
          {detail.data ? (
            <>
              <p className="sk-muted" style={{ fontSize: 12, marginBottom: 8 }}>
                <RunPill status={detail.data.run.status} />{' '}
                {detail.data.run.status === 'DRAFT' || detail.data.run.status === 'CALCULATED'
                  ? 'Staff cannot see these yet — they appear in the app and the portal once the month is locked.'
                  : 'Visible to staff in the app and the portal.'}
              </p>
              {rows.length === 0 ? <EmptyRow>Nobody matches that.</EmptyRow> : (
                <TableWrap minWidth={620}>
                  <thead>
                    <tr><Th>Name</Th><Th>Role</Th><Th right>Gross</Th><Th right>Tax</Th><Th right>Net</Th><Th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} style={{ borderTop: '1px solid var(--sk-line)' }}>
                        <Td>{p.name}</Td>
                        <Td><span style={{ color: 'var(--sk-ink-3)' }}>{p.designation}</span></Td>
                        <Td right>{rupees(p.grossMinor)}</Td>
                        <Td right>{p.incomeTaxMinor ? rupees(p.incomeTaxMinor) : '—'}</Td>
                        <Td right><b>{rupees(p.netMinor)}</b></Td>
                        <Td><button type="button" className="sk-btn" data-size="sm" onClick={() => setOpenSlip(p)}>Open</button></Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
            </>
          ) : null}
        </CardBody>
      </Card>

      {/* A DRAWER, not a card appended after the table.
          It shipped as a sibling below the list, and with 73 people that put
          it thousands of pixels under the fold: clicking Open moved nothing
          in the viewport, so the button read as broken. Whatever a control
          reveals has to appear where the eye already is. */}
      {openSlip ? (
        <Drawer
          title={openSlip.name}
          subtitle={`${openSlip.designation} · ${monthName(detail.data?.run.periodMonth ?? 1)} ${detail.data?.run.periodYear ?? ''}`}
          onClose={() => setOpenSlip(null)}
          footer={<button type="button" className="sk-btn" onClick={() => setOpenSlip(null)}>Close</button>}
        >
          <SlipBody slip={openSlip} />
        </Drawer>
      ) : null}
    </div>
  );
}

/**
 * One payslip, in the order a person reads it: what was earned, what came off,
 * what reached the bank — and then what the school paid in on top, which is
 * the line most payslips leave out and the one that makes this one honest.
 */
export function SlipBody({ slip }: { slip: Payslip }) {
  const earnings = slip.lines.filter((l) => l.kind === 'EARNING');
  const deductions = slip.lines.filter((l) => l.kind === 'DEDUCTION');
  const employer = slip.lines.filter((l) => l.kind === 'EMPLOYER_COST');
  return (
    <>
      <div className="grid gap-3">
        <p className="sk-muted" style={{ fontSize: 12 }}>
          {slip.daysPaid !== slip.daysInMonth ? `Paid for ${slip.daysPaid} of ${slip.daysInMonth} days · ` : ''}
          {slip.taxRegime === 'NEW' ? 'New tax regime' : 'Old tax regime'}
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          <Ledger title="Earned" lines={earnings} total={slip.grossMinor} totalLabel="Gross" />
          <Ledger title="Taken off" lines={deductions} total={slip.deductionMinor} totalLabel="Deductions" />
        </div>
        <div style={{ borderTop: '1px solid var(--sk-line-2)', paddingTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 15 }}>Paid to the bank</b>
          <b style={{ fontSize: 15, fontFamily: 'var(--sk-mono)' }}>{rupees(slip.netMinor)}</b>
        </div>
        {employer.length > 0 ? (
          <div style={{ background: 'var(--sk-bg-2)', borderRadius: 10, padding: '10px 12px' }}>
            <p className="sk-lab" style={{ marginBottom: 6 }}>The school also paid in</p>
            {employer.map((l) => (
              <div key={l.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5, padding: '3px 0' }}>
                <span>{l.name}</span>
                <span style={{ fontFamily: 'var(--sk-mono)' }}>{rupees(l.amountMinor)}</span>
              </div>
            ))}
            <p className="sk-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Not part of the pay to the bank. It goes to the provident fund and ESI in this person&rsquo;s name.
            </p>
          </div>
        ) : null}
        <p className="sk-muted" style={{ fontSize: 11.5 }}>
          This year so far: {rupees(slip.ytdGrossMinor)} earned, {rupees(slip.ytdTaxMinor)} tax.
        </p>
      </div>
    </>
  );
}

function Ledger({ title, lines, total, totalLabel }: { title: string; lines: { key: string; name: string; amountMinor: number }[]; total: number; totalLabel: string }) {
  return (
    <div>
      <p className="sk-lab" style={{ marginBottom: 6 }}>{title}</p>
      {lines.length === 0 ? <p className="sk-state">Nothing.</p> : lines.map((l) => (
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

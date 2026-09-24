'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardBody, CardHead, EmptyRow, Kpi, Note, RunPill, TableWrap, Td, Th, monthName, rupees } from './ui';
import type { CalcResult, RunDetail } from './types';

/**
 * THE RUN — work it out, approve, lock, pay.
 *
 * It used to own a month picker of its own. It does not any more: there is
 * always exactly one month that wants running, the home screen knows which,
 * and asking the user to pick it was asking them to do the product's
 * arithmetic. This panel is handed a run and does the four steps to it.
 *
 * Only the lock is irreversible, and the confirm says so before it happens:
 * after it a correction is an adjustment in the NEXT month, which is also how
 * every filing system expects to receive one.
 */
export default function RunPanel({ runId, base }: { runId: string; base: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [calc, setCalc] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['pay-run', runId], enabled: !!host && !!runId,
    queryFn: () => api.get<RunDetail>(`/payroll/runs/${runId}`),
  });

  const open = detail.data?.run ?? null;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['pay-run', runId] });
    await qc.invalidateQueries({ queryKey: ['pay-runs'] });
    await qc.invalidateQueries({ queryKey: ['pay-overview'] });
  };

  if (!open) return null;

  return (
    <Card>
      <CardHead>
        <h3>{monthName(open.periodMonth)} {open.periodYear}</h3>
        <RunPill status={open.status} />
      </CardHead>
      <CardBody className="grid gap-3">
        <div className="sk-kpis">
          <Kpi label="People" value={String(open.headcount)} />
          <Kpi label="Gross" value={rupees(open.grossMinor)} />
          <Kpi label="Deductions" value={rupees(open.deductionMinor)} />
          <Kpi label="Paid out" value={rupees(open.netMinor)} tone="good" />
          <Kpi label="School also pays" value={rupees(open.employerCostMinor)} detail="provident fund, ESI" />
        </div>

        {calc?.notes?.length ? (
          <Note>{calc.notes.map((n) => <p key={n} style={{ margin: 0 }}>{n}</p>)}</Note>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <ActionButton
            label="Work it out" busyLabel="Working…" variant="primary"
            disabled={open.status === 'LOCKED' || open.status === 'PAID'}
            run={async () => {
              setError(null);
              try {
                setCalc(await api.post<CalcResult>(`/payroll/runs/${open.id}/calculate`, {}));
                await refresh();
              } catch (e) { setError(e instanceof Error ? e.message : 'Could not work the month out.'); }
            }}
          />
          <ActionButton
            label="Approve" busyLabel="Approving…" disabled={open.status !== 'CALCULATED'}
            run={async () => {
              setError(null);
              try { await api.post(`/payroll/runs/${open.id}/approve`, {}); await refresh(); }
              catch (e) { setError(e instanceof Error ? e.message : 'Could not approve it.'); }
            }}
          />
          <ActionButton
            label="Lock" busyLabel="Locking…" variant="danger" disabled={open.status !== 'APPROVED'}
            confirm={`Lock ${monthName(open.periodMonth)} ${open.periodYear}? After this the month cannot be changed — a correction goes into next month as an adjustment. Payslips become visible to staff.`}
            run={async () => {
              setError(null);
              try { await api.post(`/payroll/runs/${open.id}/lock`, {}); await refresh(); }
              catch (e) { setError(e instanceof Error ? e.message : 'Could not lock it.'); }
            }}
          />
          <ActionButton
            label="Mark paid" busyLabel="Saving…" disabled={open.status !== 'LOCKED'}
            run={async () => {
              setError(null);
              try { await api.post(`/payroll/runs/${open.id}/paid`, {}); await refresh(); }
              catch (e) { setError(e instanceof Error ? e.message : 'Could not mark it paid.'); }
            }}
          />
        </div>

        {error ? <p className="sk-state" role="alert" style={{ color: 'var(--sk-bad)' }}>{error}</p> : null}

        {open.status === 'LOCKED' || open.status === 'PAID' ? (
          <p className="sk-muted" style={{ fontSize: 12.5 }}>
            Locked on {open.lockedAt ? new Date(open.lockedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}.
            Every slip is under <a href={`${base}/payslips`}>Payslips</a>; the provident-fund, ESI and bank files are under <a href={`${base}/filings`}>Filings</a>.
          </p>
        ) : null}

        {detail.data && detail.data.payslips.length > 0 ? (
          <TableWrap>
            <thead>
              <tr>
                <Th>Name</Th><Th>Role</Th><Th right>Days</Th><Th right>Gross</Th><Th right>Deductions</Th><Th right>Net</Th>
              </tr>
            </thead>
            <tbody>
              {detail.data.payslips.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--sk-line)' }}>
                  <Td>{p.name}</Td>
                  <Td><span style={{ color: 'var(--sk-ink-3)' }}>{p.designation}</span></Td>
                  <Td right>{p.daysPaid === p.daysInMonth ? '—' : `${p.daysPaid}/${p.daysInMonth}`}</Td>
                  <Td right>{rupees(p.grossMinor)}</Td>
                  <Td right>{rupees(p.deductionMinor)}</Td>
                  <Td right><b>{rupees(p.netMinor)}</b></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyRow>Nothing worked out yet. Press &ldquo;Work it out&rdquo; to build this month&rsquo;s payslips.</EmptyRow>
        )}
      </CardBody>
    </Card>
  );
}

/** A button that owns its own busy state, and asks first when the step cannot be undone. */
function ActionButton({ label, busyLabel, run, disabled, variant, confirm }: {
  label: string; busyLabel: string; run: () => Promise<void>; disabled?: boolean;
  variant?: 'primary' | 'danger'; confirm?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="sk-btn sk-press"
      data-variant={variant}
      disabled={disabled || busy}
      onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true);
        try { await run(); } finally { setBusy(false); }
      }}
    >
      {busy ? busyLabel : label}
    </button>
  );
}

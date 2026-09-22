'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Card, CardBody, CardHead, EmptyRow, Kpi, Note, RulesAsAt, RunPill, TableWrap, Td, Th, monthName, rupees } from './ui';
import type { CalcResult, RunDetail, RunRow, SalarySettings } from './types';

const now = new Date();

/**
 * THE PAY RUN — draft, work it out, approve, lock, pay.
 *
 * Only the lock is irreversible, and the screen says so before it happens:
 * after it a correction is an adjustment in the NEXT month, which is also how
 * every filing system expects to receive one.
 */
export default function RunTab({ base }: { base: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [calc, setCalc] = useState<CalcResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ['salary-settings'], enabled: !!host, queryFn: () => api.get<SalarySettings>('/payroll/settings') });
  const runs = useQuery({ queryKey: ['pay-runs'], enabled: !!host, queryFn: () => api.get<RunRow[]>('/payroll/runs') });
  const detail = useQuery({
    queryKey: ['pay-run', openId], enabled: !!host && !!openId,
    queryFn: () => api.get<RunDetail>(`/payroll/runs/${openId}`),
  });

  const openRun = useMutation({
    mutationFn: () => api.post<{ id: string }>('/payroll/runs', { year, month }),
    onSuccess: (r) => { setOpenId(r.id); setCalc(null); void qc.invalidateQueries({ queryKey: ['pay-runs'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const open = detail.data?.run ?? null;
  const s = settings.data;

  return (
    <div className="grid gap-4">
      {settings.isError ? <QueryError error={settings.error} onRetry={settings.refetch} className="py-6" /> : null}

      <Card>
        <CardHead>
          <h3>Run a month</h3>
          {s ? <RunPill status={open?.status ?? 'DRAFT'} /> : null}
        </CardHead>
        <CardBody className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1">
              <span className="sk-lab">Month</span>
              <select className="sk-input" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="sk-lab">Year</span>
              <input className="sk-input" style={{ width: '7em' }} type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" />
            </label>
            <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={openRun.isPending} onClick={() => openRun.mutate()}>
              {openRun.isPending ? 'Opening…' : 'Open this month'}
            </button>
          </div>
          {s ? <RulesAsAt asAt={s.pack.rulesAsAt} version={s.pack.version} /> : null}
          {error ? <p className="sk-state err">{error}</p> : null}
        </CardBody>
      </Card>

      {open ? (
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
              <ActionButton label="Work it out" busyLabel="Working…" variant="primary"
                disabled={open.status === 'LOCKED' || open.status === 'PAID'}
                run={async () => {
                  setError(null);
                  try {
                    const r = await api.post<CalcResult>(`/payroll/runs/${open.id}/calculate`, {});
                    setCalc(r);
                    await qc.invalidateQueries({ queryKey: ['pay-run', open.id] });
                    await qc.invalidateQueries({ queryKey: ['pay-runs'] });
                  } catch (e) { setError(e instanceof Error ? e.message : 'Could not work the month out.'); }
                }} />
              <ActionButton label="Approve" busyLabel="Approving…" disabled={open.status !== 'CALCULATED'}
                run={async () => {
                  setError(null);
                  try {
                    await api.post(`/payroll/runs/${open.id}/approve`, {});
                    await qc.invalidateQueries({ queryKey: ['pay-run', open.id] });
                    await qc.invalidateQueries({ queryKey: ['pay-runs'] });
                  } catch (e) { setError(e instanceof Error ? e.message : 'Could not approve it.'); }
                }} />
              <ActionButton label="Lock" busyLabel="Locking…" variant="danger" disabled={open.status !== 'APPROVED'}
                confirm={`Lock ${monthName(open.periodMonth)} ${open.periodYear}? After this the month cannot be changed — a correction goes into next month as an adjustment. Payslips become visible to staff.`}
                run={async () => {
                  setError(null);
                  try {
                    await api.post(`/payroll/runs/${open.id}/lock`, {});
                    await qc.invalidateQueries({ queryKey: ['pay-run', open.id] });
                    await qc.invalidateQueries({ queryKey: ['pay-runs'] });
                  } catch (e) { setError(e instanceof Error ? e.message : 'Could not lock it.'); }
                }} />
              <ActionButton label="Mark paid" busyLabel="Saving…" disabled={open.status !== 'LOCKED'}
                run={async () => {
                  setError(null);
                  try {
                    await api.post(`/payroll/runs/${open.id}/paid`, {});
                    await qc.invalidateQueries({ queryKey: ['pay-run', open.id] });
                    await qc.invalidateQueries({ queryKey: ['pay-runs'] });
                  } catch (e) { setError(e instanceof Error ? e.message : 'Could not mark it paid.'); }
                }} />
            </div>

            {open.status === 'LOCKED' || open.status === 'PAID' ? (
              <p className="sk-muted" style={{ fontSize: 12.5 }}>
                Locked on {open.lockedAt ? new Date(open.lockedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}.
                Download the provident-fund, ESI and bank files under <a href={`${base}/statutory`}>Statutory</a>.
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
      ) : null}

      <Card>
        <CardHead><h3>Months</h3></CardHead>
        <CardBody>
          {runs.isError ? <QueryError error={runs.error} onRetry={runs.refetch} className="py-4" /> : null}
          {runs.data && runs.data.length === 0 ? <EmptyRow>No month has been run yet.</EmptyRow> : null}
          {runs.data?.map((r) => (
            <button key={r.id} type="button" className="sk-row" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer' }} onClick={() => { setOpenId(r.id); setCalc(null); }}>
              <div>
                <div className="nm">{monthName(r.periodMonth)} {r.periodYear}</div>
                <div className="meta">{r.headcount} {r.headcount === 1 ? 'person' : 'people'} · {rupees(r.netMinor)} paid out</div>
              </div>
              <RunPill status={r.status} />
            </button>
          ))}
        </CardBody>
      </Card>
    </div>
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

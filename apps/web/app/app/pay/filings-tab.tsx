'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Card, CardBody, CardHead, EmptyRow, Note, RulesAsAt, TableWrap, Td, Th, downloadText, monthName } from './ui';
import type { Calendar, RunRow } from './types';

const FILES = [
  { key: 'bank', label: 'Bank transfer file', hint: 'Account, name and amount, in the order the office pays.' },
  { key: 'pf', label: 'Provident fund return', hint: 'The electronic return to upload, one line per member.' },
  { key: 'esi', label: 'ESI contribution', hint: 'Insurance number, days and wages for everyone covered.' },
  { key: 'register', label: 'Salary register', hint: 'Every person, every line, one wide sheet.' },
] as const;

/**
 * STATUTORY — what is owed, when, and the exact file to upload.
 *
 * The line this screen draws out loud: Sckools works out what is owed and
 * makes the file. Submitting it stays with the school and its accountant.
 * Filing on somebody else's registration is a different and much worse
 * business to be in, and pretending otherwise would be the wrong promise.
 */
export default function StatutoryTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runs = useQuery({ queryKey: ['pay-runs'], enabled: !!host, queryFn: () => api.get<RunRow[]>('/payroll/runs') });
  const chosen = runs.data?.find((r) => r.id === (runId ?? runs.data?.[0]?.id)) ?? null;
  const calendar = useQuery({
    queryKey: ['salary-calendar', chosen?.periodYear, chosen?.periodMonth],
    enabled: !!host && !!chosen,
    queryFn: () => api.get<Calendar>(`/payroll/statutory/calendar?year=${chosen!.periodYear}&month=${chosen!.periodMonth}`),
  });

  const locked = chosen?.status === 'LOCKED' || chosen?.status === 'PAID';

  async function download(what: string) {
    if (!chosen) return;
    setBusy(what); setError(null);
    try {
      const r = await api.get<{ filename: string; body: string }>(`/payroll/runs/${chosen.id}/files/${what}`);
      downloadText(r.filename, r.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make that file.');
    } finally { setBusy(null); }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHead>
          <h3>Files for a month</h3>
          <select className="sk-input" style={{ maxWidth: '14em' }} value={chosen?.id ?? ''} onChange={(e) => setRunId(e.target.value)} aria-label="Month">
            {runs.data?.map((r) => <option key={r.id} value={r.id}>{monthName(r.periodMonth)} {r.periodYear}</option>)}
          </select>
        </CardHead>
        <CardBody className="grid gap-3">
          {runs.isError ? <QueryError error={runs.error} onRetry={runs.refetch} className="py-4" /> : null}
          {runs.data && runs.data.length === 0 ? <EmptyRow>No month has been run yet.</EmptyRow> : null}
          {chosen && !locked ? (
            <Note>
              <p style={{ margin: 0 }}>
                <b>{monthName(chosen.periodMonth)} {chosen.periodYear} is not locked yet.</b> Files come only from a locked month — one that can still change is worse than no file at all.
              </p>
            </Note>
          ) : null}
          {chosen ? (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
              {FILES.map((f) => (
                <div key={f.key} style={{ border: '1px solid var(--sk-line)', borderRadius: 11, padding: 12, display: 'grid', gap: 6 }}>
                  <b style={{ fontSize: 13.5 }}>{f.label}</b>
                  <span className="sk-muted" style={{ fontSize: 11.5 }}>{f.hint}</span>
                  <div>
                    <button type="button" className="sk-btn" data-size="sm" disabled={!locked || busy === f.key} onClick={() => void download(f.key)}>
                      {busy === f.key ? 'Making…' : 'Download'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {error ? <p className="sk-state err">{error}</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHead><h3>What is due</h3></CardHead>
        <CardBody className="grid gap-3">
          {calendar.isError ? <QueryError error={calendar.error} onRetry={calendar.refetch} className="py-4" /> : null}
          {calendar.data ? (
            <>
              <TableWrap minWidth={480}>
                <thead><tr><Th>Duty</Th><Th>How often</Th><Th>Due</Th></tr></thead>
                <tbody>
                  {calendar.data.duties.map((d) => (
                    <tr key={d.key} style={{ borderTop: '1px solid var(--sk-line)' }}>
                      <Td>
                        {d.label}
                        {d.note ? <span className="sk-muted" style={{ display: 'block', fontSize: 11 }}>{d.note}</span> : null}
                      </Td>
                      <Td><span style={{ color: 'var(--sk-ink-3)' }}>{CADENCE[d.cadence] ?? d.cadence}</span></Td>
                      <Td mono>{d.dueOn ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Note><p style={{ margin: 0 }}>{calendar.data.note}</p></Note>
              <RulesAsAt asAt={calendar.data.rulesAsAt} version={calendar.data.packVersion} />
              {calendar.data.unverified.length > 0 ? (
                <details>
                  <summary className="sk-lab" style={{ cursor: 'pointer' }}>
                    {calendar.data.unverified.length} figures we could not confirm from an official page
                  </summary>
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    {calendar.data.unverified.map((u) => (
                      <p key={u.what} className="sk-muted" style={{ fontSize: 12, margin: 0 }}>
                        <b style={{ color: 'var(--sk-ink-2)' }}>{u.what}.</b> {u.why}
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

const CADENCE: Record<string, string> = {
  MONTHLY: 'Every month', QUARTERLY: 'Every quarter', ANNUAL: 'Once a year', EVERY_PAYDAY: 'Every payday',
};

'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { BackToFees } from '@/components/fees/back-to-fees';
import {
  STATUS_LABEL, STATUS_TONE, rupees, toMinor,
  type FeeTerm, type StudentFeeList,
} from '@/lib/fees';

interface Grade { id: string; name: string }
interface Year { id: string; isCurrent: boolean }

/**
 * Fees by student — ONE list for the whole roll, with a filter that narrows it
 * to who owes.
 *
 * Deliberately not a separate "defaulters" screen. Two lists would compute the
 * same numbers two ways and drift; one list with `?owing=1` answers both
 * questions and has one place a bug can live. The dashboard's "Still
 * outstanding" tile deep-links straight into the filtered view.
 */
export default function StudentFeesPage() {
  return (
    // useSearchParams needs a Suspense boundary to prerender.
    <Suspense fallback={<p className="sk-state">Loading…</p>}>
      <StudentFees />
    </Suspense>
  );
}

function StudentFees() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const params = useSearchParams();

  const [owing, setOwing] = useState(params.get('owing') === '1');
  const [overdue, setOverdue] = useState(params.get('overdue') === '1');
  const [termId, setTermId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [minDue, setMinDue] = useState('');
  const [q, setQ] = useState('');

  const years = useQuery({
    queryKey: ['years', host], enabled: !!host,
    queryFn: () => api.get<Year[]>('/manage/years'),
  });
  const yearId = years.data?.find((y) => y.isCurrent)?.id ?? years.data?.[0]?.id ?? '';

  const terms = useQuery({
    queryKey: ['fee-terms', host, yearId], enabled: !!host && !!yearId,
    queryFn: () => api.get<FeeTerm[]>(`/manage/fees/terms?academicYearId=${yearId}`),
  });
  const grades = useQuery({
    queryKey: ['grades', host], enabled: !!host,
    queryFn: () => api.get<Grade[]>('/manage/grades'),
  });

  const query = new URLSearchParams();
  if (termId) query.set('termId', termId);
  if (gradeId) query.set('gradeId', gradeId);
  if (owing) query.set('owing', '1');
  if (overdue) query.set('overdue', '1');
  if (toMinor(minDue) > 0) query.set('minDue', String(toMinor(minDue)));
  if (q.trim()) query.set('q', q.trim());

  const list = useQuery({
    queryKey: ['fee-students', host, query.toString()], enabled: !!host,
    queryFn: () => api.get<StudentFeeList>(`/manage/fees/students?${query.toString()}`),
  });

  const t = list.data?.totals;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <BackToFees />
      <header className="sk-pagehead">
        <h1>Fees by student</h1>
        <p>Everyone on the roll. Filter down to who still owes.</p>
      </header>

      {/* Plain flex row, NOT .sk-tabs — those are the page nav-bar classes and
          their auto margin centres the row away from the rest of the page. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip on={!owing && !overdue} onClick={() => { setOwing(false); setOverdue(false); }}>Everyone</Chip>
        <Chip on={owing && !overdue} onClick={() => { setOwing(true); setOverdue(false); }}>Owing</Chip>
        <Chip on={overdue} onClick={() => { setOwing(false); setOverdue(true); }}>Overdue</Chip>
        <span aria-hidden="true" style={{ width: 1, height: 20, background: 'var(--sk-line-2)', margin: '0 4px' }} />
        <select className="sk-input" value={termId} onChange={(e) => setTermId(e.target.value)}
                aria-label="Term" style={{ fontSize: 12, padding: '5px 9px' }}>
          <option value="">All terms</option>
          {terms.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select className="sk-input" value={gradeId} onChange={(e) => setGradeId(e.target.value)}
                aria-label="Class" style={{ fontSize: 12, padding: '5px 9px' }}>
          <option value="">All classes</option>
          {grades.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <input className="sk-input" inputMode="decimal" placeholder="Due over ₹"
               value={minDue} onChange={(e) => setMinDue(e.target.value)}
               aria-label="Minimum amount due" style={{ fontSize: 12, padding: '5px 9px', width: 118 }} />
        <span className="relative inline-flex items-center">
          <Search size={13} aria-hidden="true"
                  style={{ position: 'absolute', left: 9, color: 'var(--sk-ink-3)' }} />
          <input className="sk-input" placeholder="Name or admission no."
                 value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students"
                 style={{ fontSize: 12, padding: '5px 9px 5px 26px', width: 190 }} />
        </span>
      </div>

      {t && (
        <div className="sk-kpis">
          <div className="sk-kpi"><div className="lab">Students</div><div className="n">{t.students}</div>
            <div className="hint">{t.owing} still owing</div></div>
          <div className="sk-kpi"><div className="lab">Billed</div><div className="n">{rupees(t.billedMinor)}</div>
            <div className="hint">across the filter</div></div>
          <div className="sk-kpi" data-tone="good"><div className="lab">Received</div><div className="n">{rupees(t.paidMinor)}</div>
            <div className="hint">{pctLabel(t.paidMinor, t.billedMinor)}</div></div>
          <div className="sk-kpi" data-tone={t.dueMinor > 0 ? 'bad' : 'good'}>
            <div className="lab">Still due</div><div className="n">{rupees(t.dueMinor)}</div>
            <div className="hint">{t.lateFeeMinor > 0 ? `incl. ${rupees(t.lateFeeMinor)} late fee` : 'no late fee'}</div></div>
        </div>
      )}

      {list.isLoading && <p className="sk-state">Working out who owes what…</p>}
      {list.error && <p className="sk-state err">{(list.error as Error).message}</p>}
      {list.isFetched && list.data?.rows.length === 0 && (
        <p className="sk-state">
          {owing || overdue ? 'Nobody matches — every bill in this filter is settled.' : 'No students match.'}
        </p>
      )}

      {(list.data?.rows.length ?? 0) > 0 && (
        <div className="sk-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  {['Student', 'Class', 'Status', 'Billed', 'Paid', 'Late fee', 'Due', 'Days late', ''].map((h, i) => (
                    <th key={h || i}
                        className={`p-2 text-[10px] font-bold uppercase tracking-[0.08em] ${i >= 3 && i <= 7 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--sk-ink-3)', borderBottom: '1px solid var(--sk-line-2)', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data!.rows.map((r) => (
                  <tr key={r.studentId} style={{ borderTop: '1px solid var(--sk-line)' }}>
                    <td className="p-2">
                      <Link href={`/app/fees/students/${r.studentId}`}
                            className="font-semibold" style={{ color: 'var(--sk-brand-2)' }}>
                        {r.name}
                      </Link>
                      <div className="text-[10.5px]" style={{ color: 'var(--sk-ink-3)', fontFamily: 'var(--sk-mono)' }}>
                        {r.admissionNo}{r.guardianPhone ? ` · ${r.guardianPhone}` : ''}
                      </div>
                    </td>
                    <td className="p-2">{r.className ?? '—'}</td>
                    <td className="p-2">
                      <span className="sk-pill" data-tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</span>
                      {r.isRte && <span className="sk-pill ml-1" data-tone="info">RTE</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{rupees(r.billedMinor)}</td>
                    <td className="p-2 text-right tabular-nums" style={{ color: r.paidMinor > 0 ? 'var(--sk-good)' : undefined }}>
                      {rupees(r.paidMinor)}
                    </td>
                    <td className="p-2 text-right tabular-nums" style={{ color: r.lateFeeMinor > 0 ? 'var(--sk-amber-ink)' : 'var(--sk-ink-3)' }}>
                      {r.lateFeeMinor > 0 ? rupees(r.lateFeeMinor) : '—'}
                    </td>
                    <td className="p-2 text-right font-semibold tabular-nums"
                        style={{ color: r.dueMinor > 0 ? 'var(--sk-bad)' : 'var(--sk-ink-3)' }}>
                      {r.dueMinor > 0 ? rupees(r.dueMinor) : '—'}
                    </td>
                    <td className="p-2 text-right tabular-nums"
                        style={{ color: r.daysOverdue > 14 ? 'var(--sk-bad)' : r.daysOverdue > 0 ? 'var(--sk-amber-ink)' : 'var(--sk-ink-3)' }}>
                      {r.daysOverdue > 0 ? r.daysOverdue : '—'}
                    </td>
                    <td className="p-2 text-right">
                      <Link href={`/app/fees/students/${r.studentId}`} className="sk-btn" style={{ padding: '4px 10px', fontSize: 11.5 }}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.data!.truncated && (
            <p className="p-3 text-[11.5px]" style={{ color: 'var(--sk-ink-3)', borderTop: '1px solid var(--sk-line)' }}>
              Showing the first {list.data!.returned} of {list.data!.totals.students}. The figures above cover
              every student in the filter, not just this page — narrow the filter to see the rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Below 1% a rounded percentage reads as "we have collected nothing". */
function pctLabel(paid: number, billed: number): string {
  if (billed <= 0) return 'nothing billed yet';
  const pct = (paid / billed) * 100;
  if (pct === 0) return '0% collected';
  if (pct < 1) return 'under 1% collected';
  if (pct < 10) return `${pct.toFixed(1)}% collected`;
  return `${Math.round(pct)}% collected`;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on}
            className="rounded-full border px-3 py-1.5 text-[12.5px] font-semibold"
            style={{
              borderColor: on ? 'var(--sk-brand)' : 'var(--sk-line-2)',
              background: on ? 'var(--sk-brand-tint)' : 'var(--sk-card)',
              color: on ? 'var(--sk-brand-2)' : 'var(--sk-ink-2)',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
      {children}
    </button>
  );
}

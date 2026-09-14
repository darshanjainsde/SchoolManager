'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { fmtDate, type RegisterRow, type YearRow } from './types';

const DECISION_LABEL: Record<string, string> = { PROMOTE: 'Promoted', STAY: 'Stayed in grade', PASS_OUT: 'Passed out', LEAVE: 'Left' };

/** The promotion register for a closed year: every child and what happened to them. Prints on A4. */
export default function Register({ year, onBack }: { year: YearRow; onBack: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const [filter, setFilter] = useState<'ALL' | 'PASS_OUT' | 'NO_EMAIL' | 'LEAVE'>('ALL');
  const rows = useQuery<RegisterRow[]>({
    queryKey: ['session-register', host, year.id],
    queryFn: () => api.get(`/manage/sessions/${year.id}/register`),
    enabled: !!host,
  });
  const list = (rows.data ?? []).filter((r) =>
    filter === 'ALL' ? true : filter === 'NO_EMAIL' ? r.decision === 'PASS_OUT' && !r.email : r.decision === filter,
  );
  // Print only the register: the shell is hidden for the length of the print.
  const print = () => {
    document.body.classList.add('ses-printing');
    const done = () => {
      document.body.classList.remove('ses-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };
  return (
    <div className="sk-card sk-ses-register">
      <div className="sk-card-h">
        <h3>Promotion register · {year.name}</h3>
        <span className="sk-sub">
          {rows.data ? `${rows.data.length} children` : 'Loading…'} · {fmtDate(year.startDate)} – {fmtDate(year.endDate)}
        </span>
      </div>
      <div className="sk-card-b">
        <div className="sk-toolbar sk-ses-toolbar sk-noprint">
          <button type="button" className="sk-btn sk-press" onClick={onBack}>
            ← Sessions
          </button>
          {(['ALL', 'PASS_OUT', 'NO_EMAIL', 'LEAVE'] as const).map((f) => (
            <button key={f} type="button" className="sk-chip sk-press" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'ALL' ? 'Everyone' : f === 'PASS_OUT' ? 'Passed out' : f === 'NO_EMAIL' ? 'Passed out · no email' : 'Left'}
            </button>
          ))}
          <button type="button" className="sk-btn sk-press" style={{ marginLeft: 'auto' }} onClick={print}>
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
        <div className="sk-tblwrap">
          <table className="sk-tbl">
            <thead>
              <tr>
                <th>Admission no.</th>
                <th>Student</th>
                <th>Email</th>
                <th>From</th>
                <th>Decision</th>
                <th>To</th>
                <th>Decided by</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.data && list.length === 0 && (
                <tr>
                  <td colSpan={8} className="sk-muted" data-wrap="true">
                    Nothing here.
                  </td>
                </tr>
              )}
              {list.map((r) => (
                <tr key={r.studentId}>
                  <td className="sk-num">{r.admissionNo}</td>
                  <td>{r.name}</td>
                  <td>{r.email ?? '—'}</td>
                  <td>{r.fromSection ?? '—'}</td>
                  <td>
                    {DECISION_LABEL[r.decision] ?? r.decision}
                    {r.leaveStatus ? ` · ${r.leaveStatus.toLowerCase()}` : ''}
                  </td>
                  <td>{r.decision === 'PASS_OUT' ? `Alumni · Class of ${year.name}` : (r.toSection ?? '—')}</td>
                  <td>{r.decidedBy ?? '—'}</td>
                  <td>{r.appliedAt ? fmtDate(r.appliedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

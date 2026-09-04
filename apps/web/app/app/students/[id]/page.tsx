'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, ScrollText, Wallet } from 'lucide-react';
import type { StudentReport } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { pressDateLabel, printPressSheets } from '@/lib/press';
import { rupees } from '@/lib/fees';
import { StudentReportSheet } from '@/components/press/student-report-sheet';
import { PressPrintPortal } from '@/components/press/press-print-portal';
import '@/components/press/press-print.css';

/**
 * The Student 360 — everything the registers hold about one child, on one
 * screen, with the printed report a parent asks for one click away.
 *
 * Every number is the live register (the composed read computes; nothing is
 * stored), and every panel links to the screen that owns its subject.
 */

const STATUS_TINT: Record<string, string> = {
  PRESENT: 'var(--sk-good-tint)', LATE: 'var(--sk-amber-tint)', ABSENT: 'var(--sk-bad-tint)',
};

export default function StudentReportPage() {
  const { id } = useParams<{ id: string }>();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const report = useQuery({
    queryKey: ['student-report', host, id], enabled: !!host,
    queryFn: () => api.get<StudentReport>(`/manage/students/${id}/report`),
  });

  const r = report.data;
  const asOn = pressDateLabel(new Date().toISOString());

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link href="/app/students" className="sk-seelink" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <ArrowLeft size={13} aria-hidden="true" /> Students
      </Link>

      {report.isLoading && <p className="sk-state">Opening the registers…</p>}
      {report.isError && (
        <p className="sk-state err">
          {report.error instanceof ApiError && report.error.status === 404
            ? 'That student was not found.'
            : 'The report could not load. Refresh to try again.'}
        </p>
      )}

      {r && (
        <>
          {/* ── hero ─────────────────────────────────────────────────────── */}
          <div className="sk-hero" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <span
              aria-hidden="true"
              style={{
                width: 54, height: 54, borderRadius: 16, background: 'rgba(255,255,255,0.18)',
                display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 19, color: '#fff', flex: 'none',
              }}
            >
              {r.student.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sk-hero-title" style={{ marginTop: 0 }}>
                {r.student.name}
                {!r.student.isActive && <span className="sk-pill" data-tone="neutral" style={{ marginLeft: 10, verticalAlign: 4 }}>left the school</span>}
              </div>
              <div className="sk-hero-meta">
                {[r.student.classLabel, r.student.rollNo ? `Roll ${r.student.rollNo}` : null, `Adm ${r.student.admissionNo}`,
                  r.student.dob ? `DOB ${pressDateLabel(r.student.dob)}` : null,
                  r.student.guardianName ? `${r.student.guardianName}${r.student.guardianPhone ? ` (${r.student.guardianPhone})` : ''}` : null]
                  .filter(Boolean).join(' · ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {r.fees && (
                <Link href={`/app/fees/students/${r.student.id}`} className="sk-btn">
                  <Wallet size={14} aria-hidden="true" /> Fees
                </Link>
              )}
              <Link href="/app/press/certificates" className="sk-btn">
                <ScrollText size={14} aria-hidden="true" /> Certificates
              </Link>
              <button className="sk-btn" data-variant="primary" onClick={printPressSheets}>
                <Printer size={14} aria-hidden="true" /> Print report
              </button>
            </div>
          </div>

          {/* ── tiles ────────────────────────────────────────────────────── */}
          <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <div className="sk-kpi">
              <div className="lab">Attendance · this session</div>
              <div className="n" style={{ color: r.attendance.pct !== null && r.attendance.pct < 75 ? 'var(--sk-bad)' : 'var(--sk-good)' }}>
                {r.attendance.pct === null ? '—' : `${r.attendance.pct}%`}
              </div>
              <div className="hint">{r.attendance.total > 0 ? `${r.attendance.present} of ${r.attendance.total} days · last ${r.attendance.last20.length}:` : 'no days marked yet'}</div>
              {r.attendance.last20.length > 0 && (
                <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                  {r.attendance.last20.map((d) => (
                    <span key={d.date} title={`${pressDateLabel(d.date)} — ${d.status.toLowerCase()}`}
                      style={{ flex: 1, height: 10, maxWidth: 12, borderRadius: 3, background: STATUS_TINT[d.status] }} />
                  ))}
                </div>
              )}
            </div>
            <div className="sk-kpi">
              <div className="lab">{r.academics ? `Overall · ${r.academics.windowName}` : 'Overall'}</div>
              <div className="n">
                {r.academics?.overall.pct != null ? `${r.academics.overall.pct}%` : '—'}
                {r.academics?.overall.grade && (
                  <span className="sk-pill" data-tone="good" style={{ marginLeft: 8, verticalAlign: 6 }}>{r.academics.overall.grade}</span>
                )}
              </div>
              <div className="hint">
                {r.academics
                  ? `${r.academics.subjects.filter((s) => s.marks !== null).length} of ${r.academics.subjects.length} subjects assessed`
                  : 'no report window yet'}
              </div>
            </div>
            {r.fees && (
              <Link href={`/app/fees/students/${r.student.id}`} className="sk-kpi" data-tone={r.fees.dueMinor > 0 ? 'bad' : 'good'}>
                <div className="lab">Fees</div>
                <div className="n">{r.fees.dueMinor > 0 ? rupees(r.fees.dueMinor) : 'All clear'}</div>
                <div className="hint">{r.fees.dueMinor > 0 ? 'outstanding · ' : ''}{rupees(r.fees.paidMinor)} paid this session</div>
              </Link>
            )}
            <Link href="/app/press/register" className="sk-kpi">
              <div className="lab">Documents issued</div>
              <div className="n">{r.documents.filter((d) => !d.voided).length}</div>
              <div className="hint">{r.documents.length ? r.documents.slice(0, 2).map((d) => d.serial).join(' · ') : 'nothing issued yet'}</div>
            </Link>
          </div>

          {/* ── panels ───────────────────────────────────────────────────── */}
          <div className="sk-cardgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <div className="sk-card"><div className="sk-card-b">
              <b style={{ fontSize: 13 }}>Marks{r.academics ? ` · ${r.academics.windowName}` : ''}</b>
              {r.academics && r.academics.subjects.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--sk-ink-3)', fontSize: 11 }}>
                    <th style={{ padding: '4px 0' }}>Subject</th><th>Marks</th><th>%</th><th>Grade</th>
                  </tr></thead>
                  <tbody>
                    {r.academics.subjects.map((l) => (
                      <tr key={l.subjectId} style={{ borderTop: '1px solid var(--sk-line)' }}>
                        <td style={{ padding: '6px 0' }}>{l.subjectName}</td>
                        <td>{l.marks === null ? '—' : `${l.marks}/${l.maxMarks}`}</td>
                        <td>{l.pct ?? '—'}</td>
                        <td>{l.grade ? <span className="sk-pill" data-tone={l.grade === 'A1' ? 'good' : 'info'}>{l.grade}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="sk-state">No published marks in a report window yet — they appear here the moment a teacher publishes.</p>
              )}
              {r.academics?.remark && (
                <p style={{ fontSize: 12.5, color: 'var(--sk-ink-2)', margin: 0 }}>
                  <b>Class teacher:</b> {r.academics.remark}
                </p>
              )}
            </div></div>

            {r.fees && (
              <div className="sk-card"><div className="sk-card-b">
                <b style={{ fontSize: 13 }}>Fee ledger · latest</b>
                {r.fees.ledger.length ? r.fees.ledger.map((l, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, borderTop: i ? '1px solid var(--sk-line)' : 'none', paddingTop: i ? 6 : 0 }}>
                    <span>{l.narration}<br /><span className="sk-muted" style={{ fontSize: 11 }}>{pressDateLabel(l.occurredAt)}</span></span>
                    <span style={{ fontWeight: 700, color: l.kind === 'CREDIT' ? 'var(--sk-good)' : 'var(--sk-bad)', whiteSpace: 'nowrap' }}>
                      {l.kind === 'CREDIT' ? '+' : '−'}{rupees(l.amountMinor)}
                    </span>
                  </div>
                )) : <p className="sk-state">Nothing on the ledger yet.</p>}
              </div></div>
            )}

            <div className="sk-card"><div className="sk-card-b">
              <b style={{ fontSize: 13 }}>Documents · the register</b>
              {r.documents.length ? r.documents.map((d) => (
                <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                  <span style={{ textDecoration: d.voided ? 'line-through' : undefined }}>
                    {d.type === 'REPORT_CARD' ? 'Report card' : d.type === 'TC' ? 'Transfer certificate' : d.type === 'BONAFIDE' ? 'Bonafide' : 'Character certificate'}
                    {d.voided && <span className="sk-pill" data-tone="bad" style={{ marginLeft: 6 }}>VOID</span>}
                    <br /><span className="sk-muted" style={{ fontSize: 11 }}>{pressDateLabel(d.issuedAt)}</span>
                  </span>
                  <span className="sk-num sk-muted" style={{ fontWeight: 700 }}>{d.serial}</span>
                </div>
              )) : <p className="sk-state">Nothing issued yet — report cards and certificates land here with their serials.</p>}
            </div></div>

            <div className="sk-card"><div className="sk-card-b">
              <b style={{ fontSize: 13 }}>Library</b>
              {r.library.length ? r.library.map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5 }}>
                  <span>{l.title}</span>
                  <span className="sk-muted" style={{ whiteSpace: 'nowrap' }}>
                    {l.returnedOn ? `returned ${pressDateLabel(l.returnedOn)}` : `due ${pressDateLabel(l.dueOn)}`}
                  </span>
                </div>
              )) : <p className="sk-state">No library record.</p>}
            </div></div>
          </div>

          {/* the printable report — portaled; printPressSheets shows only this */}
          <PressPrintPortal>
            <StudentReportSheet report={r} asOn={asOn} />
          </PressPrintPortal>
        </>
      )}
    </div>
  );
}

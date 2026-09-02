'use client';
import type { StudentReport } from '@skoolos/types';

/**
 * The Student Report on paper — the sheet a parent is handed when they ask
 * "sab kuch dikhao". Same iron rules as every Press sheet: literal ink,
 * millimetres, hairline borders, footer anchored to the page. The data is
 * RE-COMPOSED for A4 — sections ordered for a reader holding paper, never a
 * screenshot of the screen.
 */

const INK = '#191627';
const INK_SOFT = '#5d5a75';
const LINE = '#c9cfdd';
const HEAD_BG = '#eef1f7';
const BRAND = '#17325b';

const cell: React.CSSProperties = { border: `0.25mm solid ${LINE}`, padding: '1.8mm 2.5mm', textAlign: 'left' };
const headCell: React.CSSProperties = { ...cell, background: HEAD_BG, fontWeight: 700 };

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

function rupees(minor: number): string {
  return '₹' + (minor / 100).toLocaleString('en-IN');
}

function trimMarks(n: number): string {
  const r = Math.round(n * 10) / 10;
  return String(r % 1 === 0 ? Math.trunc(r) : r);
}

function SecTitle({ children }: { children: React.ReactNode }) {
  return (
    <h6 style={{
      margin: '4.5mm 0 2mm', fontSize: '8.5pt', letterSpacing: '0.14em', color: BRAND,
      borderBottom: `0.25mm solid ${LINE}`, paddingBottom: '1mm', textTransform: 'uppercase', fontWeight: 700,
    }}>{children}</h6>
  );
}

export function StudentReportSheet({ report, asOn }: { report: StudentReport; asOn: string }) {
  const r = report;
  return (
    <div className="pr-page" style={{ fontSize: '9.5pt' }}>
      {/* masthead */}
      <div style={{ display: 'flex', gap: '5mm', alignItems: 'center', borderBottom: `0.8mm solid ${BRAND}`, paddingBottom: '3mm' }}>
        {r.school.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- print crest, fixed box
          <img src={r.school.logoUrl} alt="" style={{ width: '15mm', height: '15mm', objectFit: 'contain' }} />
        ) : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: '15pt', color: BRAND }}>{r.school.name}</div>
          <div style={{ fontSize: '8pt', color: INK_SOFT }}>
            {[r.school.addressLine, r.school.phone, r.school.email].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '8.5pt', color: INK_SOFT }}>
          <b style={{ color: INK }}>STUDENT REPORT</b><br />
          as on {asOn}<br />
          Ref SR/{r.student.admissionNo}
        </div>
      </div>

      {/* identity */}
      <SecTitle>The student</SecTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2mm 6mm' }}>
        {([
          ['Name', r.student.name],
          ['Class', r.student.classLabel ? `${r.student.classLabel}${r.student.rollNo ? ' · Roll ' + r.student.rollNo : ''}` : '—'],
          ['Admission no', r.student.admissionNo],
          ['Date of birth', dateLabel(r.student.dob)],
          ['Guardian', r.student.guardianName ?? '—'],
          ['Contact', r.student.guardianPhone ?? '—'],
          ['Attendance', r.attendance.pct === null ? '—' : `${r.attendance.present}/${r.attendance.total} days (${r.attendance.pct}%)`],
          ['Fee position', r.fees ? (r.fees.dueMinor > 0 ? `${rupees(r.fees.dueMinor)} outstanding` : 'All dues clear') : 'Kept outside Sckools'],
        ] as const).map(([k, v]) => (
          <span key={k}>
            <b style={{ display: 'block', fontSize: '7.5pt', color: INK_SOFT, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{k}</b>
            {v}
          </span>
        ))}
      </div>

      {/* academics — published marks only, the printed-card computation */}
      {r.academics && r.academics.subjects.length > 0 && (
        <>
          <SecTitle>Academics · {r.academics.windowName} · {r.academics.academicYearName}</SecTitle>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr>
              <th style={headCell}>Subject</th><th style={{ ...headCell, textAlign: 'right' }}>Marks</th>
              <th style={{ ...headCell, textAlign: 'right' }}>Out of</th><th style={{ ...headCell, textAlign: 'right' }}>%</th>
              <th style={{ ...headCell, textAlign: 'center' }}>Grade</th>
            </tr></thead>
            <tbody>
              {r.academics.subjects.map((l) => (
                <tr key={l.subjectId}>
                  <td style={cell}>{l.subjectName}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{l.marks === null ? '—' : trimMarks(l.marks)}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{l.maxMarks}</td>
                  <td style={{ ...cell, textAlign: 'right' }}>{l.pct ?? '—'}</td>
                  <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>{l.grade ?? '—'}</td>
                </tr>
              ))}
              <tr>
                <td style={headCell}>Overall</td>
                <td style={headCell} colSpan={2}></td>
                <td style={{ ...headCell, textAlign: 'right' }}>{r.academics.overall.pct ?? '—'}</td>
                <td style={{ ...headCell, textAlign: 'center' }}>{r.academics.overall.grade ?? '—'}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: '7.5pt', color: INK_SOFT, marginTop: '1.5mm' }}>
            Grades: A1 91–100 · A2 81–90 · B1 71–80 · B2 61–70 · C1 51–60 · C2 41–50 · D 33–40 · E below 33. A dash means
            no assessment was recorded.
          </div>
        </>
      )}

      {/* ledger + documents side by side, as a reader compares them */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5mm' }}>
        <div>
          {r.fees && r.fees.ledger.length > 0 && (
            <>
              <SecTitle>Fee ledger · latest</SecTitle>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt', fontVariantNumeric: 'tabular-nums' }}>
                <tbody>
                  {r.fees.ledger.map((l, i) => (
                    <tr key={i}>
                      <td style={cell}>{l.narration}</td>
                      <td style={cell}>{dateLabel(l.occurredAt)}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{l.kind === 'DEBIT' ? '−' : '+'}{rupees(l.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div>
          {r.documents.length > 0 && (
            <>
              <SecTitle>Documents on the register</SecTitle>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.5pt' }}>
                <tbody>
                  {r.documents.map((d) => (
                    <tr key={d.id}>
                      <td style={cell}>{d.type === 'REPORT_CARD' ? 'Report card' : d.type === 'TC' ? 'Transfer certificate' : d.type === 'BONAFIDE' ? 'Bonafide certificate' : 'Character certificate'}{d.voided ? ' (VOID)' : ''}</td>
                      <td style={cell}>{d.serial}</td>
                      <td style={cell}>{dateLabel(d.issuedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: '7.5pt', color: INK_SOFT, marginTop: '1mm' }}>
                Serials verifiable against the school&rsquo;s press register.
              </div>
            </>
          )}
        </div>
      </div>

      {/* remark */}
      {r.academics?.remark && (
        <>
          <SecTitle>Class teacher&rsquo;s remark</SecTitle>
          <div style={{ border: `0.25mm solid ${LINE}`, borderRadius: '1.5mm', padding: '2.5mm 3mm', minHeight: '12mm' }}>
            {r.academics.remark}
          </div>
        </>
      )}

      {/* anchored foot */}
      <div style={{ marginTop: 'auto', paddingTop: '5mm' }}>
        <div style={{ fontSize: '7.5pt', color: INK_SOFT }}>
          Issued on request. This report summarises the school&rsquo;s registers as on the date above; the registers
          remain the record.
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '9mm', fontSize: '8.5pt', color: INK_SOFT }}>
          <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>Prepared by (office)</span>
          <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>Principal</span>
          <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>School seal</span>
        </div>
      </div>
    </div>
  );
}

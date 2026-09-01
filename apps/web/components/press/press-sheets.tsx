'use client';
import type {
  CertificateSnapshot,
  GradeBand,
  ReportCardSnapshot,
  ReportSubjectLine,
} from '@skoolos/types';

/**
 * The paper the Press produces. Same iron rules as the Exam Hall sheets
 * (`app/app/exam-hall/print-sheets.tsx`), because these leave the office in a
 * schoolbag or a family's filing drawer:
 *
 *   - literal ink, never `--sk-*` tokens — a sheet is paper in both themes,
 *     and a dark-mode browser must not print white-on-black
 *   - millimetres, never pixels — A4 is a physical fact
 *   - hairline borders, never box-shadow — Chrome's print-to-PDF flattens a
 *     blurred shadow into a grey slab (this cost a whole booklet print run)
 *
 * Everything renders from a SNAPSHOT (`PressIssue.payload` or a compile
 * preview shaped identically), so what prints is exactly what the register
 * remembers. `duplicate` stamps a reprint — the original goes out once; every
 * later copy says what it is, the way a paper TC book's office copy would.
 */

const INK = '#191627';
const INK_SOFT = '#5d5a75';
const LINE = '#c9cfdd';
const HEAD_BG = '#eef1f7';
const BRAND = '#17325b';

/** 73.5 stays 73.5; 73.0 prints as 73 — never a float artifact. */
function trimMarks(n: number): string {
  const r = Math.round(n * 10) / 10;
  return String(r % 1 === 0 ? Math.trunc(r) : r);
}

/** "—" is the honest mark for "no data" — never 0, never E. */
function marksLabel(line: ReportSubjectLine): string {
  return line.marks === null ? '—' : trimMarks(line.marks);
}

function gradeLabel(grade: GradeBand | null): string {
  return grade ?? '—';
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);
}

function Masthead({ school, line2 }: { school: ReportCardSnapshot['school']; line2: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5mm', borderBottom: `0.8mm solid ${BRAND}`, paddingBottom: '3mm' }}>
      {school.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- print sheet: a fixed-size crest, not a responsive image
        <img src={school.logoUrl} alt="" style={{ width: '16mm', height: '16mm', objectFit: 'contain' }} />
      ) : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: '15pt', color: BRAND, letterSpacing: '0.02em' }}>{school.name}</div>
        <div style={{ fontSize: '8pt', color: INK_SOFT }}>
          {[school.addressLine, school.phone, school.email].filter(Boolean).join(' · ')}
        </div>
        <div style={{ fontSize: '9pt', color: INK, fontWeight: 600, marginTop: '1mm' }}>{line2}</div>
      </div>
    </div>
  );
}

/**
 * PROOF — an unissued check print for red-penning; DUPLICATE — a register
 * reprint; CANCELLED — a voided entry. The stamp is what stops any of the
 * three passing for an original.
 */
function Stamp({ text }: { text: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', top: '40mm', right: '14mm', transform: 'rotate(-18deg)',
        border: `0.6mm solid ${INK_SOFT}`, color: INK_SOFT, borderRadius: '2mm',
        padding: '1.5mm 4mm', fontWeight: 800, fontSize: '13pt', letterSpacing: '0.2em', opacity: 0.55,
      }}
    >
      {text}
    </div>
  );
}

const cell: React.CSSProperties = { border: `0.25mm solid ${LINE}`, padding: '2.4mm 3mm', textAlign: 'left' };
const cellNum: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const headCell: React.CSSProperties = { ...cell, background: HEAD_BG, fontWeight: 700 };

// ── The report card ──────────────────────────────────────────────────────────

export function ReportCardSheet({
  snapshot, serial, stamp,
}: {
  snapshot: ReportCardSnapshot;
  /** The register serial — official prints carry it; proofs have none. */
  serial?: string;
  stamp?: 'PROOF' | 'DUPLICATE' | 'CANCELLED';
}) {
  const s = snapshot;
  return (
    <div className="pr-page" style={{ position: 'relative' }}>
      {stamp && <Stamp text={stamp} />}
      <Masthead school={s.school} line2={`Progress Report · ${s.windowName} · ${s.academicYearName}`} />

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4mm', margin: '4mm 0 3mm', fontSize: '9.5pt' }}>
        <div>
          <b style={{ fontSize: '11pt' }}>{s.student.name}</b>
          <span style={{ color: INK_SOFT }}>
            {' '}· {s.classLabel}{s.student.rollNo ? ` · Roll ${s.student.rollNo}` : ''} · Adm {s.student.admissionNo}
          </span>
        </div>
        <div style={{ color: INK_SOFT }}>
          {s.student.dob ? `DOB ${dateLabel(s.student.dob)}` : ''}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5pt' }}>
        <thead>
          <tr>
            <th style={headCell}>Subject</th>
            <th style={{ ...headCell, textAlign: 'right' }}>Marks</th>
            <th style={{ ...headCell, textAlign: 'right' }}>Out of</th>
            <th style={{ ...headCell, textAlign: 'right' }}>%</th>
            <th style={{ ...headCell, textAlign: 'center' }}>Grade</th>
          </tr>
        </thead>
        <tbody>
          {s.subjects.map((line) => (
            <tr key={line.subjectId}>
              <td style={cell}>
                {line.subjectName}
                {line.examCount > 1 ? <span style={{ color: INK_SOFT, fontSize: '8pt' }}> ({line.examCount} tests)</span> : null}
              </td>
              <td style={cellNum}>{marksLabel(line)}</td>
              <td style={cellNum}>{line.maxMarks}</td>
              <td style={cellNum}>{line.pct ?? '—'}</td>
              <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>{gradeLabel(line.grade)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...headCell }}>Total</td>
            <td style={{ ...headCell, textAlign: 'right' }}>{s.overall.pct === null ? '—' : trimMarks(s.overall.marks)}</td>
            <td style={{ ...headCell, textAlign: 'right' }}>{s.overall.maxMarks}</td>
            <td style={{ ...headCell, textAlign: 'right' }}>{s.overall.pct ?? '—'}</td>
            <td style={{ ...headCell, textAlign: 'center' }}>{gradeLabel(s.overall.grade)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '4mm', marginTop: '3mm', fontSize: '9.5pt', alignItems: 'flex-start' }}>
        <div style={{ border: `0.25mm solid ${LINE}`, borderRadius: '1.5mm', padding: '2mm 3mm', flex: 'none' }}>
          <b>Attendance</b>{' '}
          {s.attendance.pct === null ? '—' : `${s.attendance.present} / ${s.attendance.total} days (${s.attendance.pct}%)`}
        </div>
        <div style={{ border: `0.25mm solid ${LINE}`, borderRadius: '1.5mm', padding: '2.5mm 3.5mm', flex: 1, minHeight: '24mm' }}>
          <b>Class teacher&rsquo;s remark</b>
          <div style={{ marginTop: '1mm' }}>{s.remark ?? ''}</div>
        </div>
      </div>

      {/* marginTop auto: the legend + signature block sits at the FOOT of the
          A4 page however short the table above runs. */}
      <div style={{ fontSize: '7.5pt', color: INK_SOFT, marginTop: 'auto', paddingTop: '6mm' }}>
        Grades: A1 91–100 · A2 81–90 · B1 71–80 · B2 61–70 · C1 51–60 · C2 41–50 · D 33–40 · E below 33. A dash means no
        assessment was recorded.
        {serial ? <> · Register serial <b>{serial}</b></> : null}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12mm', fontSize: '8.5pt', color: INK_SOFT }}>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>
          Class Teacher{s.classTeacherName ? ` — ${s.classTeacherName}` : ''}
        </span>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>Principal</span>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>Parent</span>
      </div>
    </div>
  );
}

// ── Certificates ─────────────────────────────────────────────────────────────

const CERT_TITLE: Record<CertificateSnapshot['type'], string> = {
  TC: 'TRANSFER CERTIFICATE',
  BONAFIDE: 'BONAFIDE CERTIFICATE',
  CHARACTER: 'CHARACTER CERTIFICATE',
};

/** The certificate's sentence, assembled from the snapshot — no blanks printed. */
function certBody(s: CertificateSnapshot): string {
  const { student, fields } = s;
  // gender is free text in the management DTOs — 'F', 'Female', 'female' all
  // mean the same on a certificate; anything unrecognised stays neutral.
  const g = student.gender?.trim().toUpperCase() ?? '';
  const relation = g.startsWith('F') ? 'daughter' : g.startsWith('M') ? 'son' : 'ward';
  const pronoun = g.startsWith('F') ? 'Her' : g.startsWith('M') ? 'His' : 'Their';
  const guardian = student.guardianName ? `, ${relation} of ${student.guardianName},` : '';
  const dob = student.dob ? ` (date of birth ${dateLabel(student.dob)})` : '';
  const span = `${dateLabel(fields.fromDate)}${fields.toDate ? ` to ${dateLabel(fields.toDate)}` : ' to date'}`;

  if (s.type === 'BONAFIDE') {
    return (
      `This is to certify that ${student.name}${guardian} admission no. ${student.admissionNo}${dob}, ` +
      `is a bona fide student of this school, studying in ${fields.classLabel}, on the rolls from ${span}.` +
      (fields.purpose ? ` This certificate is issued for the purpose of ${fields.purpose}.` : '')
    );
  }
  if (s.type === 'CHARACTER') {
    return (
      `This is to certify that ${student.name}${guardian} admission no. ${student.admissionNo}${dob}, ` +
      `was on the rolls of this school from ${span}, in ${fields.classLabel}. ` +
      `${pronoun} conduct and character during this period have been ${fields.conduct}.`
    );
  }
  return (
    `This is to certify that ${student.name}${guardian} admission no. ${student.admissionNo}${dob}, ` +
    `was a bona fide student of this school from ${span} and was studying in ${fields.classLabel}. ` +
    `${pronoun} conduct during this period was ${fields.conduct}.` +
    (fields.reason ? ` Reason for leaving: ${fields.reason}.` : '') +
    (s.duesMinor > 0 && s.duesOverride
      ? ' Issued with dues outstanding, by order of the school.'
      : ' All dues to the school stand cleared as per the fee ledger.')
  );
}

export function CertificateSheet({
  snapshot, serial, issuedAt, stamp,
}: {
  snapshot: CertificateSnapshot; serial: string; issuedAt: string;
  stamp?: 'DUPLICATE' | 'CANCELLED';
}) {
  const s = snapshot;
  return (
    <div className="pr-page" style={{ position: 'relative' }}>
      {stamp && <Stamp text={stamp} />}
      <Masthead school={s.school} line2="" />

      <div style={{
        border: `0.5mm double ${BRAND}`, borderRadius: '1.5mm', padding: '10mm 12mm', marginTop: '10mm',
        flex: 1, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: '14pt', color: BRAND, letterSpacing: '0.14em' }}>{CERT_TITLE[s.type]}</div>
          <div style={{ fontSize: '8.5pt', color: INK_SOFT, marginTop: '1mm', fontVariantNumeric: 'tabular-nums' }}>
            Serial no. <b>{serial}</b> · Issued {dateLabel(issuedAt)}
          </div>
        </div>

        <p style={{ fontSize: '11.5pt', lineHeight: 2.1, marginTop: '10mm', textAlign: 'justify' }}>{certBody(s)}</p>

        {s.fields.note ? <p style={{ fontSize: '10.5pt', lineHeight: 1.8 }}>{s.fields.note}</p> : null}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '18mm', fontSize: '8.5pt', color: INK_SOFT, alignItems: 'flex-end' }}>
          <span>Place: {s.school.addressLine?.split(', ').slice(-2, -1)[0] ?? '____________'}</span>
          <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '40mm', textAlign: 'center' }}>
            Principal / Headmaster
          </span>
        </div>
      </div>

      <div style={{ fontSize: '7.5pt', color: INK_SOFT, marginTop: '4mm' }}>
        This certificate carries a serial number recorded in the school&rsquo;s register and can be verified against it.
      </div>
    </div>
  );
}

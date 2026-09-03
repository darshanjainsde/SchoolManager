'use client';
import { classInWords, dateInWords } from '@/lib/press';
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
        {(school.board || school.affiliationNo) && (
          <div style={{ fontSize: '8pt', color: INK_SOFT }}>
            {[school.board, school.affiliationNo ? `Affiliation No. ${school.affiliationNo}` : null]
              .filter(Boolean).join(' · ')}
          </div>
        )}
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

/** A per-exam cell: the mark, or the letter that tells the truth. */
function ExamCell({ v }: { v: number | 'AB' | 'EX' | null }) {
  if (v === null) return <td style={{ ...cellNum, color: INK_SOFT }}>—</td>;
  if (v === 'AB') return <td style={{ ...cellNum, color: '#a02818', fontWeight: 700 }}>AB</td>;
  if (v === 'EX') return <td style={{ ...cellNum, color: BRAND, fontWeight: 700 }}>EX</td>;
  return <td style={cellNum}>{trimMarks(v)}</td>;
}

/**
 * The Detailed template — the full board-style card: one column per exam
 * (straight from the window's exams), AB/EX printed as themselves, and the
 * optional blocks (co-scholastic, house, height/weight, promotion, parent's
 * remark) that print ONLY when the office recorded them. It fills its page.
 *
 * Exam columns come from the union of exam titles across subjects, in first-
 * appearance order. A subject without an exam of that title prints a dot —
 * different from "—" (a row that exists but holds no data yet).
 */
function DetailedCardSheet({ s, serial, stamp }: {
  s: ReportCardSnapshot; serial?: string; stamp?: 'PROOF' | 'DUPLICATE' | 'CANCELLED';
}) {
  const titles: string[] = [];
  for (const line of s.subjects) {
    for (const pe of line.perExam ?? []) {
      if (!titles.includes(pe.title)) titles.push(pe.title);
    }
  }
  // More columns than a page can hold → the BOARD totals view is the honest
  // fallback rather than 6pt type nobody can read.
  if (titles.length === 0 || titles.length > 6) {
    return <ReportCardSheet snapshot={s} serial={serial} stamp={stamp} template="BOARD" />;
  }
  const ex = s.extras;
  const hasAbEx = s.subjects.some((l) => (l.perExam ?? []).some((p) => p.value === 'AB' || p.value === 'EX'));
  return (
    <div className="pr-page" style={{ position: 'relative' }}>
      {stamp && <Stamp text={stamp} />}
      <Masthead school={s.school} line2="" />
      <div style={{ textAlign: 'center', margin: '3mm 0 2mm' }}>
        <span style={{
          fontWeight: 800, fontSize: '11pt', letterSpacing: '0.18em', color: INK,
          border: `0.35mm solid ${INK}`, padding: '1mm 6mm', display: 'inline-block',
        }}>
          PROGRESS REPORT · {s.windowName.toUpperCase()} · {s.academicYearName}
        </span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt', margin: '2mm 0' }}>
        <tbody>
          <tr>
            <td style={{ ...cell, width: '42%' }}><b>Name:</b> {s.student.name}</td>
            <td style={cell}><b>Class:</b> {s.classLabel}</td>
            <td style={cell}><b>Roll:</b> {s.student.rollNo ?? '—'}</td>
            {ex?.house ? <td style={cell}><b>House:</b> {ex.house}</td> : null}
          </tr>
          <tr>
            <td style={cell}><b>Admission no.:</b> {s.student.admissionNo}</td>
            <td style={cell} colSpan={ex?.house ? 2 : 1}><b>Date of birth:</b> {s.student.dob ? dateLabel(s.student.dob) : '—'}</td>
            <td style={cell}><b>Class teacher:</b> {s.classTeacherName ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontWeight: 700, fontSize: '9pt', letterSpacing: '0.1em', margin: '1.5mm 0 1mm', color: BRAND }}>
        PART A · SCHOLASTIC AREAS
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt' }}>
        <thead>
          <tr>
            <th style={headCell}>Subject</th>
            {titles.map((t) => {
              const max = s.subjects
                .flatMap((l) => l.perExam ?? [])
                .find((p) => p.title === t)?.maxMarks;
              return <th key={t} style={{ ...headCell, textAlign: 'right' }}>{t}{max ? ` (${max})` : ''}</th>;
            })}
            <th style={{ ...headCell, textAlign: 'right' }}>Total</th>
            <th style={{ ...headCell, textAlign: 'center' }}>Grade</th>
          </tr>
        </thead>
        <tbody>
          {s.subjects.map((line) => {
            const byTitle = new Map((line.perExam ?? []).map((p) => [p.title, p.value]));
            const allEx = (line.perExam ?? []).length > 0 && (line.perExam ?? []).every((p) => p.value === 'EX');
            return (
              <tr key={line.subjectId}>
                <td style={cell}>{line.subjectName}</td>
                {titles.map((t) => (
                  byTitle.has(t)
                    ? <ExamCell key={t} v={byTitle.get(t)!} />
                    : <td key={t} style={{ ...cellNum, color: INK_SOFT }}>·</td>
                ))}
                <td style={cellNum}>
                  {allEx ? <b style={{ color: BRAND }}>EX</b> : line.marks === null ? '—' : `${trimMarks(line.marks)}/${line.maxMarks}`}
                </td>
                <td style={{ ...cell, textAlign: 'center', fontWeight: 700 }}>{gradeLabel(line.grade)}</td>
              </tr>
            );
          })}
          <tr>
            <td style={headCell}>Total</td>
            <td style={{ ...headCell, textAlign: 'right' }} colSpan={titles.length}>
              {s.overall.pct === null ? '—' : `${trimMarks(s.overall.marks)} / ${s.overall.maxMarks}`}
            </td>
            <td style={{ ...headCell, textAlign: 'right' }}>{s.overall.pct ?? '—'}%</td>
            <td style={{ ...headCell, textAlign: 'center' }}>{gradeLabel(s.overall.grade)}</td>
          </tr>
        </tbody>
      </table>
      {hasAbEx && (
        <div style={{ fontSize: '7.5pt', color: INK_SOFT, marginTop: '1mm' }}>
          AB — absent, counted 0 in the total. EX — exempted; the percentage is measured over the exams the child could sit.
        </div>
      )}

      {ex?.coScholastic && ex.coScholastic.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: '9pt', letterSpacing: '0.1em', margin: '3mm 0 1mm', color: BRAND }}>
            PART B · CO-SCHOLASTIC <span style={{ color: INK_SOFT, fontWeight: 500 }}>(A outstanding · B very good · C fair)</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt' }}>
            <tbody>
              <tr>
                {ex.coScholastic.map((c) => (
                  <td key={c.label} style={cell}>{c.label} <b>{c.grade}</b></td>
                ))}
              </tr>
            </tbody>
          </table>
        </>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt', marginTop: '3mm' }}>
        <tbody>
          <tr>
            <td style={cell}>
              <b>Attendance</b>{' '}
              {s.attendance.pct === null ? '—' : `${s.attendance.present} / ${s.attendance.total} days (${s.attendance.pct}%)`}
            </td>
            {ex?.heightCm ? <td style={cell}><b>Height</b> {ex.heightCm} cm</td> : null}
            {ex?.weightKg ? <td style={cell}><b>Weight</b> {ex.weightKg} kg</td> : null}
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt', marginTop: '3mm' }}>
        <tbody>
          <tr>
            <td style={{ ...headCell, width: '30%' }}>RESULT</td>
            <td style={cell}>
              {s.overall.pct === null
                ? 'Assessment pending — see the subject table'
                : `${s.overall.pct}% · Grade ${gradeLabel(s.overall.grade)}`}
              {ex?.promotion ? ` · ${ex.promotion}` : ''}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ border: `0.25mm solid ${LINE}`, borderRadius: '1.5mm', padding: '2.5mm 3.5mm', marginTop: '3mm', minHeight: '16mm', fontSize: '9.5pt' }}>
        <b>Class teacher&rsquo;s remark</b>
        <div style={{ marginTop: '1mm' }}>{s.remark ?? ''}</div>
      </div>
      <div style={{ border: `0.25mm solid ${LINE}`, borderRadius: '1.5mm', padding: '2.5mm 3.5mm', marginTop: '2.5mm', minHeight: '12mm', fontSize: '9.5pt', color: INK_SOFT }}>
        <b style={{ color: INK }}>Parent&rsquo;s remark</b>
      </div>

      <div style={{ fontSize: '7.5pt', color: INK_SOFT, marginTop: 'auto', paddingTop: '5mm' }}>
        Grades: A1 91–100 · A2 81–90 · B1 71–80 · B2 61–70 · C1 51–60 · C2 41–50 · D 33–40 · E below 33. A dash means no
        assessment was recorded.
        {serial ? <> · Register serial <b>{serial}</b></> : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '9mm', fontSize: '8.5pt', color: INK_SOFT }}>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>
          Class Teacher{s.classTeacherName ? ` — ${s.classTeacherName}` : ''}
        </span>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>Principal</span>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', minWidth: '34mm', textAlign: 'center' }}>Parent</span>
      </div>
    </div>
  );
}

export function ReportCardSheet({
  snapshot, serial, stamp, template = 'CLASSIC',
}: {
  snapshot: ReportCardSnapshot;
  /** The register serial — official prints carry it; proofs have none. */
  serial?: string;
  stamp?: 'PROOF' | 'DUPLICATE' | 'CANCELLED';
  /** Presentation only — every template renders the SAME snapshot, so the
   *  register never cares which one a print run wore. DETAILED prints the
   *  per-exam columns + the optional blocks; BOARD is the familiar
   *  scholastic-form look; CLASSIC is the clean minimal sheet. */
  template?: 'CLASSIC' | 'BOARD' | 'DETAILED';
}) {
  const s = snapshot;
  if (template === 'DETAILED') {
    return <DetailedCardSheet s={s} serial={serial} stamp={stamp} />;
  }
  const board = template === 'BOARD';
  return (
    <div className="pr-page" style={{ position: 'relative' }}>
      {stamp && <Stamp text={stamp} />}
      <Masthead school={s.school} line2={board ? '' : `Progress Report · ${s.windowName} · ${s.academicYearName}`} />
      {board && (
        <div style={{ textAlign: 'center', margin: '3mm 0 1mm' }}>
          <span style={{
            fontWeight: 800, fontSize: '11pt', letterSpacing: '0.18em', color: INK,
            border: `0.35mm solid ${INK}`, padding: '1mm 6mm', display: 'inline-block',
          }}>
            PROGRESS REPORT · {s.windowName.toUpperCase()} · {s.academicYearName}
          </span>
        </div>
      )}

      {board ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5pt', margin: '3mm 0' }}>
          <tbody>
            <tr>
              <td style={{ ...cell, width: '50%' }}><b>Name of student:</b> {s.student.name}</td>
              <td style={cell}><b>Class &amp; section:</b> {s.classLabel}</td>
              <td style={cell}><b>Roll no.:</b> {s.student.rollNo ?? '—'}</td>
            </tr>
            <tr>
              <td style={cell}><b>Admission no.:</b> {s.student.admissionNo}</td>
              <td style={cell}><b>Date of birth:</b> {s.student.dob ? dateLabel(s.student.dob) : '—'}</td>
              <td style={cell}><b>Class teacher:</b> {s.classTeacherName ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      ) : (
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
      )}
      {board && (
        <div style={{ fontWeight: 700, fontSize: '9pt', letterSpacing: '0.1em', margin: '1mm 0', color: BRAND }}>
          PART A · SCHOLASTIC AREAS
        </div>
      )}

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

      {board && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt', marginTop: '3mm' }}>
          <tbody>
            <tr>
              <td style={{ ...headCell, width: '34%' }}>RESULT</td>
              <td style={cell}>
                {s.overall.pct === null
                  ? 'Assessment pending — see subject table'
                  : `${trimMarks(s.overall.marks)} / ${s.overall.maxMarks} · ${s.overall.pct}% · Grade ${gradeLabel(s.overall.grade)}`}
              </td>
            </tr>
          </tbody>
        </table>
      )}

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

/** One numbered Annexure line: label, dotted rule, the answer (or the blank). */
function TCField({ no, label, value }: { no: string; label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', gap: '2.5mm', alignItems: 'baseline', padding: '1.6mm 0', borderBottom: `0.2mm dotted ${LINE}`, fontSize: '9.5pt' }}>
      <span style={{ color: INK_SOFT, width: '6mm', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{no}.</span>
      <span style={{ color: INK_SOFT, flex: 'none' }}>{label}</span>
      <span style={{ fontWeight: 650, flex: 1, textAlign: 'right', minHeight: '4mm' }}>{value?.trim() || '\u00A0'}</span>
    </div>
  );
}

/**
 * The statutory Transfer Certificate — the CBSE Examination Bye-laws
 * Annexure-I form, field for field (cbse.gov.in/Byelawsenglish.pdf). An
 * unanswered field prints as a BLANK LINE for the office pen: a statutory
 * form filled by hand beats software that invents an answer. Old snapshots
 * (issued before the statutory fields existed) render the same way — blanks.
 */
function StatutoryTCSheet({ s, serial, issuedAt, stamp }: {
  s: CertificateSnapshot; serial: string; issuedAt: string; stamp?: 'DUPLICATE' | 'CANCELLED';
}) {
  const f = s.fields;
  const st = s.student;
  // The school's statutory face, frozen into the snapshot at issue:
  //   CBSE  — the Annexure-I heading + footer (default).
  //   CISCE — adds the Council's Index No. / year-of-passing lines.
  //   STATE — "Transfer / School Leaving Certificate" naming.
  const variant = s.variant ?? 'CBSE';
  const promoted = [f.qualifiedForPromotion, f.promotedToClass
    ? `to ${f.promotedToClass}${classInWords(f.promotedToClass) ? ` (${classInWords(f.promotedToClass)})` : ''}` : null]
    .filter(Boolean).join(', ');
  const remarks = [
    f.note,
    s.duesMinor > 0 && s.duesOverride ? 'Issued with dues outstanding, by order of the school.' : null,
  ].filter(Boolean).join(' ');
  return (
    <div className="pr-page" style={{ position: 'relative' }}>
      {stamp && <Stamp text={stamp} />}
      <Masthead school={s.school} line2="" />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '8.5pt', color: INK_SOFT, margin: '3mm 0 1mm', fontVariantNumeric: 'tabular-nums' }}>
        <span>Book No. {serial.split('/')[1] ?? '—'}</span>
        <span>Sl. No. <b style={{ color: INK }}>{serial}</b></span>
        <span>Admission No. <b style={{ color: INK }}>{st.admissionNo}</b></span>
      </div>

      <div style={{ textAlign: 'center', margin: '2mm 0 3mm' }}>
        <span style={{ fontWeight: 800, fontSize: '12.5pt', letterSpacing: variant === 'STATE' ? '0.1em' : '0.22em', color: BRAND, borderBottom: `0.5mm double ${BRAND}`, paddingBottom: '1mm' }}>
          {variant === 'STATE' ? 'TRANSFER / SCHOOL LEAVING CERTIFICATE' : 'TRANSFER CERTIFICATE'}
        </span>
      </div>

      <div>
        <TCField no="1" label="Name of pupil" value={st.name} />
        <TCField no="2" label="Father's / Guardian's name" value={st.fatherName ?? st.guardianName} />
        {st.motherName ? <TCField no="2a" label="Mother's name" value={st.motherName} /> : null}
        <TCField no="3" label="Nationality" value={st.nationality} />
        <TCField no="4" label="Whether the candidate belongs to Schedule Caste or Schedule Tribe" value={st.category} />
        <TCField no="5" label="Date of first admission in the school with class"
          value={st.firstAdmissionDate ? `${dateLabel(st.firstAdmissionDate)}${st.firstAdmissionClass ? ` · ${st.firstAdmissionClass}` : ''}` : st.firstAdmissionClass} />
        <TCField no="6" label="Date of birth (in Christian Era) according to Admission Register (in figures and words)"
          value={st.dob ? `${dateLabel(st.dob)} — ${dateInWords(st.dob)}` : null} />
        <TCField no="7" label="Class in which the pupil last studied (in figures and words)"
          value={`${f.classLabel}${classInWords(f.classLabel) ? ` (${classInWords(f.classLabel)})` : ''}`} />
        <TCField no="8" label="School/Board Annual examination last taken with result" value={f.examLastTaken} />
        <TCField no="9" label="Whether failed, if so once/twice in the same class" value={f.failedBefore} />
        <TCField no="10" label="Subjects studied" value={f.subjects} />
        <TCField no="11" label="Whether qualified for promotion to the higher class — if so, to which class" value={promoted} />
        <TCField no="12" label="Month up to which the school dues paid" value={f.feesPaidUpto ?? (s.duesMinor <= 0 ? 'Dues cleared as per the fee ledger' : null)} />
        <TCField no="13" label="Any fee concession availed of — nature of such concession" value={f.feeConcession} />
        <TCField no="14" label="Total No. of working days" value={f.workingDays} />
        <TCField no="15" label="Total No. of working days present" value={f.presentDays} />
        <TCField no="16" label="Whether NCC Cadet / Boy Scout / Girl Guide" value={f.nccScout} />
        <TCField no="17" label="Games played or extra-curricular activities (achievement level)" value={f.games} />
        <TCField no="18" label="General conduct" value={f.conduct} />
        <TCField no="19" label="Date of application for certificate" value={f.dateOfApplication ? dateLabel(f.dateOfApplication) : null} />
        <TCField no="20" label="Date of issue of certificate" value={dateLabel(issuedAt)} />
        <TCField no="21" label="Reasons for leaving the school" value={f.reason} />
        <TCField no="22" label="Any other remarks" value={remarks} />
        {st.penId ? <TCField no="—" label="PEN / APAAR id" value={st.penId} /> : null}
        {variant === 'CISCE' ? (
          <>
            <TCField no="—" label="Index No. allotted by the Council" value={f.indexNo} />
            <TCField no="—" label="Year of last Council examination, if taken" value={f.yearOfPassing} />
          </>
        ) : null}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', paddingTop: '10mm', fontSize: '8.5pt', color: INK_SOFT, gap: '4mm' }}>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', flex: 1, textAlign: 'center' }}>Signature of class teacher</span>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', flex: 1, textAlign: 'center' }}>Checked by (full name and designation)</span>
        <span style={{ borderTop: `0.25mm solid ${LINE}`, paddingTop: '1.5mm', flex: 1, textAlign: 'center' }}>Principal · SEAL</span>
      </div>
      <div style={{ fontSize: '7pt', color: INK_SOFT, marginTop: '3mm' }}>
        {variant === 'CBSE'
          ? 'Form as per CBSE Examination Bye-laws, Annexure-I (cbse.gov.in).'
          : variant === 'CISCE'
            ? 'Form as per the CISCE pattern — Annexure-I field set plus the Council\u2019s Index No.'
            : 'Form as per the school\u2019s affiliating Board\u2019s Leaving Certificate pattern.'}{' '}
        This certificate carries a serial number recorded in the school&rsquo;s register and can be verified against it.
      </div>
    </div>
  );
}

export function CertificateSheet({
  snapshot, serial, issuedAt, stamp,
}: {
  snapshot: CertificateSnapshot; serial: string; issuedAt: string;
  stamp?: 'DUPLICATE' | 'CANCELLED';
}) {
  const s = snapshot;
  if (s.type === 'TC') {
    return <StatutoryTCSheet s={s} serial={serial} issuedAt={issuedAt} stamp={stamp} />;
  }
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

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CertificateSnapshot, ReportCardSnapshot } from '@skoolos/types';
import { CertificateSheet, ReportCardSheet } from './press-sheets';

/**
 * These assert OUTCOMES a family would see on paper — the honest dash for
 * missing data, the grade beside the total, the DUPLICATE stamp on a reprint —
 * not the calls that produce them.
 */

const school = {
  name: 'Raffles Public School',
  logoUrl: null,
  addressLine: '12 MG Road, Jaipur, Rajasthan',
  phone: '0141-2222',
  email: 'office@raffles.in',
};

const cardSnapshot: ReportCardSnapshot = {
  kind: 'REPORT_CARD',
  school,
  windowName: 'Term I',
  academicYearName: '2026-27',
  classLabel: 'VII-B',
  classTeacherName: 'Sunita Joshi',
  student: { name: 'Aarav Sharma', rollNo: '14', admissionNo: 'ADM-0790', dob: '2014-06-01', guardianName: 'Vikram Sharma' },
  subjects: [
    { subjectId: 'maths', subjectName: 'Mathematics', examCount: 2, marks: 91, maxMarks: 100, pct: 91, grade: 'A1' },
    // The child sat no Hindi paper: null marks, null grade — never a 0 or an E.
    { subjectId: 'hindi', subjectName: 'Hindi', examCount: 1, marks: null, maxMarks: 80, pct: null, grade: null },
  ],
  overall: { marks: 91, maxMarks: 100, pct: 91, grade: 'A1' },
  attendance: { present: 90, total: 100, pct: 90 },
  remark: 'Ganit mein utkrisht.',
};

describe('ReportCardSheet', () => {
  it('prints the compiled card: masthead, marks, grade, attendance, remark', () => {
    render(<ReportCardSheet snapshot={cardSnapshot} />);

    expect(screen.getByText('Raffles Public School')).toBeInTheDocument();
    expect(screen.getByText(/Term I/)).toBeInTheDocument();
    // Scoped to the Mathematics ROW — 'A1' also appears in the overall row
    // and the grade legend.
    const mathsRow = screen.getByText('Mathematics').closest('tr')!;
    expect(mathsRow.textContent).toContain('91');
    expect(mathsRow.textContent).toContain('A1');
    expect(screen.getByText(/90 \/ 100 days \(90%\)/)).toBeInTheDocument();
    expect(screen.getByText('Ganit mein utkrisht.')).toBeInTheDocument();
  });

  it('renders missing marks as a dash, and explains the dash in the legend', () => {
    render(<ReportCardSheet snapshot={cardSnapshot} />);

    // Hindi row: marks, % and grade all dash — three of them.
    const hindiRow = screen.getByText('Hindi').closest('tr')!;
    expect(hindiRow.textContent).toContain('—');
    expect(hindiRow.textContent).not.toContain('E'); // no phantom fail grade
    expect(screen.getByText(/A dash means no assessment was recorded/)).toBeInTheDocument();
  });

  it('stamps only when asked, and carries the register serial when given', () => {
    const { rerender } = render(<ReportCardSheet snapshot={cardSnapshot} />);
    expect(screen.queryByText('DUPLICATE')).not.toBeInTheDocument();
    expect(screen.queryByText('PROOF')).not.toBeInTheDocument();
    rerender(<ReportCardSheet snapshot={cardSnapshot} stamp="PROOF" />);
    expect(screen.getByText('PROOF')).toBeInTheDocument();
    rerender(<ReportCardSheet snapshot={cardSnapshot} stamp="DUPLICATE" serial="RC/2026/0007" />);
    expect(screen.getByText('DUPLICATE')).toBeInTheDocument();
    expect(screen.getByText('RC/2026/0007')).toBeInTheDocument();
  });

  it('never prints a float artifact in the Total row', () => {
    render(
      <ReportCardSheet
        snapshot={{
          ...cardSnapshot,
          // 36.7+42.1 style sums arrive server-rounded to 1dp; the sheet must
          // still trim trailing zeros and never render 78.80000000000001.
          overall: { marks: 78.8, maxMarks: 100, pct: 79, grade: 'B1' },
        }}
      />,
    );
    const totalRow = screen.getByText('Total').closest('tr')!;
    expect(totalRow.textContent).toContain('78.8');
    expect(totalRow.textContent).not.toMatch(/78\.80+1/);
  });
});

const certStudent = {
  id: 's1', name: 'Meera Rathore', admissionNo: 'ADM-0412', rollNo: '14',
  classLabel: 'VIII-B', dob: '2013-02-11', guardianName: 'Vikram Rathore', gender: 'F',
  onRollSince: '2019-04-04',
  fatherName: null, motherName: 'Anita Rathore', nationality: 'Indian', category: 'General',
  firstAdmissionDate: '2019-04-04', firstAdmissionClass: 'Class I',
  previousSchool: null, penId: null,
};

const tcSnapshot: CertificateSnapshot = {
  kind: 'CERTIFICATE',
  type: 'TC',
  school,
  student: certStudent,
  fields: {
    conduct: 'good', classLabel: 'VIII', fromDate: '2019-04-04', toDate: '2026-03-31',
    reason: "Parent's transfer", workingDays: '96', presentDays: '88',
  },
  duesMinor: 0,
  duesOverride: false,
};

describe('CertificateSheet — the TC is the Annexure-I form, field for field', () => {
  it('prints the statutory numbered form: DOB in words, class in words, register facts, the blanks left blank', () => {
    const { container } = render(<CertificateSheet snapshot={tcSnapshot} serial="TC/2026/0041" issuedAt="2026-09-02T05:00:00Z" />);
    const text = container.textContent!;

    expect(screen.getByText('TRANSFER CERTIFICATE')).toBeInTheDocument();
    expect(text).toContain('Sl. No.');
    expect(text).toContain('TC/2026/0041');
    // Field 2 falls back to the guardian when no father's name is on file.
    expect(text).toContain('Vikram Rathore');
    expect(text).toContain('Anita Rathore'); // mother's name rides along when known
    // Field 6: figures AND words — the Annexure demands both.
    expect(text).toContain('Eleventh February Two Thousand Thirteen');
    // Field 7: class in figures and words.
    expect(text).toContain('VIII (Eighth)');
    // Fields 14–15 from the attendance prefill.
    expect(text).toContain('Total No. of working days');
    expect(text).toContain('96');
    expect(text).toContain('88');
    // Zero balance prints the ledger's answer for field 12.
    expect(text).toContain('Dues cleared as per the fee ledger');
    // An unanswered statutory question still prints its LINE (blank, for the pen).
    expect(text).toContain('Whether NCC Cadet / Boy Scout / Girl Guide');
    // The signature row is the Annexure's, not a letter's.
    expect(text).toContain('Checked by (full name and designation)');
    expect(text).toContain('Principal · SEAL');
  });

  it('says so plainly when a TC was issued over dues — the paper does not pretend', () => {
    const { container } = render(
      <CertificateSheet
        snapshot={{ ...tcSnapshot, duesMinor: 250000, duesOverride: true }}
        serial="TC/2026/0042" issuedAt="2026-09-02T05:00:00Z"
      />,
    );
    const text = container.textContent!;
    expect(text).toContain('Issued with dues outstanding');
    expect(text).not.toContain('Dues cleared as per the fee ledger');
  });

  it('stamps a register reprint as DUPLICATE and a voided one as CANCELLED', () => {
    const { rerender } = render(
      <CertificateSheet snapshot={tcSnapshot} serial="TC/2026/0041" issuedAt="2026-09-02T05:00:00Z" stamp="DUPLICATE" />,
    );
    expect(screen.getByText('DUPLICATE')).toBeInTheDocument();
    rerender(
      <CertificateSheet snapshot={tcSnapshot} serial="TC/2026/0041" issuedAt="2026-09-02T05:00:00Z" stamp="CANCELLED" />,
    );
    expect(screen.getByText('CANCELLED')).toBeInTheDocument();
  });

  it('uses neutral wording when gender is not recorded (letter certificates)', () => {
    render(
      <CertificateSheet
        snapshot={{
          ...tcSnapshot, type: 'CHARACTER',
          student: { ...tcSnapshot.student, gender: null },
        }}
        serial="CC/2026/0043" issuedAt="2026-09-02T05:00:00Z"
      />,
    );
    const body = screen.getByText(/This is to certify/).textContent!;
    expect(body).toContain('ward of Vikram Rathore');
    expect(body).toContain('Their conduct');
  });
});

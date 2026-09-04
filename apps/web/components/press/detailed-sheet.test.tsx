import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { ReportCardSnapshot } from '@skoolos/types';
import { ReportCardSheet } from './press-sheets';

const school = {
  name: 'Rajmata Public School', logoUrl: null, addressLine: 'Jaipur', phone: null, email: null,
  board: 'CBSE, New Delhi', affiliationNo: '1730456',
};

const snapshot: ReportCardSnapshot = {
  kind: 'REPORT_CARD', school, windowName: 'Term I', academicYearName: '2026-27',
  classLabel: 'VII-B', classTeacherName: 'S. Iyer',
  student: { name: 'Aarav Sharma', rollNo: '3', admissionNo: 'RPS-0710', dob: '2013-01-11', guardianName: null },
  subjects: [
    {
      subjectId: 'a', subjectName: 'Science', marks: 65, maxMarks: 100, pct: 65, grade: 'B2', examCount: 2,
      countedMax: 100,
      perExam: [
        { examId: 'e1', title: 'PT-1', maxMarks: 20, value: 'AB' },
        { examId: 'e2', title: 'Half-Yearly', maxMarks: 80, value: 65 },
      ],
    },
    {
      subjectId: 'b', subjectName: 'Sanskrit', marks: null, maxMarks: 50, pct: null, grade: null, examCount: 1,
      countedMax: 0,
      perExam: [{ examId: 'e3', title: 'PT-1', maxMarks: 50, value: 'EX' }],
    },
  ],
  overall: { marks: 65, maxMarks: 100, pct: 65, grade: 'B2' },
  attendance: { present: 88, total: 96, pct: 92 },
  remark: 'Working hard.',
  extras: {
    house: 'Sarasvati', heightCm: 152, weightKg: 41, promotion: 'Promoted to Class VIII',
    coScholastic: [{ label: 'Work education', grade: 'A' }, { label: 'Discipline', grade: 'B' }],
  },
};

describe('the Detailed template', () => {
  it('prints per-exam columns with AB/EX as themselves, plus every recorded optional block', () => {
    const { container } = render(<ReportCardSheet snapshot={snapshot} serial="REP/2026/0001" template="DETAILED" />);
    const text = container.textContent!;

    // per-exam columns from the window's own exams
    expect(text).toContain('PT-1 (20)');
    expect(text).toContain('Half-Yearly (80)');
    // AB prints as the letter, and the key explains it
    expect(text).toContain('AB');
    expect(text).toContain('counted 0 in the total');
    // a fully exempted subject says EX, not a failing dash
    expect(text).toContain('Sanskrit');
    // optional blocks, because they were recorded
    expect(text).toContain('House');
    expect(text).toContain('Sarasvati');
    expect(text).toContain('152 cm');
    expect(text).toContain('Work education');
    expect(text).toContain('Promoted to Class VIII');
    expect(text).toContain('Parent’s remark');
    expect(text).toContain('REP/2026/0001');
  });

  it('never invents a block the office did not record', () => {
    const bare = { ...snapshot, extras: undefined };
    const { container } = render(<ReportCardSheet snapshot={bare} template="DETAILED" />);
    const text = container.textContent!;
    expect(text).not.toContain('House');
    expect(text).not.toContain('CO-SCHOLASTIC');
    expect(text).not.toContain('Height');
  });
});

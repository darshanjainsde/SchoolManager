import { reportCardHtml } from '../report-card-html';

const snap = {
  kind: 'REPORT_CARD' as const,
  school: { name: 'S & P School', logoUrl: null, addressLine: '12 MG Road', phone: null, email: null },
  windowName: 'Term 1', academicYearName: '2026–27', classLabel: '7-B', classTeacherName: 'Mrs <Iyer>',
  student: { name: 'Aarav "AJ" Sharma', rollNo: '14', admissionNo: 'A1', dob: null, guardianName: null },
  subjects: [
    { subjectId: 'm', subjectName: 'Maths', examCount: 2, marks: 86, maxMarks: 100, pct: 86, grade: 'A2' as const },
    { subjectId: 'h', subjectName: 'Hindi', examCount: 1, marks: null, maxMarks: 50, pct: null, grade: null },
  ],
  overall: { marks: 86, maxMarks: 100, pct: 86, grade: 'A2' as const },
  attendance: { present: 58, total: 62, pct: 93.5 },
  remark: 'Reads widely.',
};

it('renders every subject, escapes the school’s and teacher’s text, and shows a dash for no marks', () => {
  const html = reportCardHtml(snap, 'RC/1', '2026-07-28T00:00:00Z');
  expect(html).toContain('S &amp; P School');
  expect(html).toContain('Mrs &lt;Iyer&gt;');
  expect(html).toContain('Aarav &quot;AJ&quot; Sharma');
  expect(html).toContain('<td>Maths</td>');
  expect(html).toContain('86/100');
  expect(html).toMatch(/<td>Hindi<\/td><td class="n">—<\/td>/);
  expect(html).toContain('58 of 62 days');
  expect(html).toContain('RC/1');
});

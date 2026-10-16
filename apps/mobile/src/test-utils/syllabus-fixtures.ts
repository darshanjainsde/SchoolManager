import type { StudentSyllabusHome, StudentSyllabusSubjectDetail, SyllabusTrack, SyllabusTrackSummary, SyllabusYear } from '@skoolos/types';

export const YEAR: SyllabusYear = { id: 'y1', name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', expectedPct: 55 };

export const track = (o: Partial<SyllabusTrackSummary> = {}): SyllabusTrackSummary => ({
  classSectionId: 'cs-9a', className: 'Class 9-A', gradeId: 'g9', gradeName: 'Class 9', gradeOrder: 9, sectionName: 'A',
  subjectId: 's-mat', subjectName: 'Mathematics', teacher: { id: 't1', name: 'Rajeshwari Balasubramanian' }, isClassTeacher: true,
  leaves: 12, done: 5, teaching: 1, pct: 42, expectedPct: 55, pace: 'warn',
  now: { chapterId: 'c3', title: 'Coordinate geometry' }, lastUpdatedAt: '2026-10-14T04:00:00.000Z',
  ...o,
});

export const TRACK: SyllabusTrack = {
  summary: track(),
  year: YEAR,
  canEdit: true,
  chapters: [
    { id: 'c1', title: 'Number systems', order: 0, status: 'DONE', note: null, updatedAt: '2026-09-02T04:00:00.000Z', updatedBy: 'Rajeshwari Balasubramanian', children: [] },
    {
      id: 'c2', title: 'Polynomials', order: 1, status: 'TEACHING', note: 'Revise Q4 before the test', updatedAt: null, updatedBy: null,
      children: [
        { id: 'c2a', title: 'Zeroes of a polynomial', order: 0, status: 'DONE', note: null, updatedAt: '2026-09-20T04:00:00.000Z', updatedBy: 'Rajeshwari Balasubramanian' },
        { id: 'c2b', title: 'Factorisation', order: 1, status: 'NOT_STARTED', note: null, updatedAt: null, updatedBy: null },
      ],
    },
    { id: 'c3', title: 'Coordinate geometry', order: 2, status: 'NOT_STARTED', note: null, updatedAt: null, updatedBy: null, children: [] },
  ],
};

export const STUDENT_HOME: StudentSyllabusHome = {
  className: 'Class 9-A', year: YEAR,
  subjects: [
    { subjectId: 's-mat', subjectName: 'Mathematics', teacher: 'Rajeshwari Balasubramanian', leaves: 12, done: 5, teaching: 1, pct: 42, revised: 2, revisedPct: 17, now: { chapterId: 'c3', title: 'Coordinate geometry' } },
    { subjectId: 's-sci', subjectName: 'Science', teacher: null, leaves: 10, done: 10, teaching: 0, pct: 100, revised: 10, revisedPct: 100, now: null },
  ],
};

export const STUDENT_SUBJECT: StudentSyllabusSubjectDetail = {
  subject: STUDENT_HOME.subjects[0]!,
  year: YEAR,
  chapters: [
    { id: 'c1', title: 'Number systems', order: 0, status: 'DONE', teacherNote: 'Read the summary box', myNote: 'Rational vs irrational', updatedAt: '2026-09-02T04:00:00.000Z', children: [] },
    {
      id: 'c2', title: 'Polynomials', order: 1, status: 'TEACHING', teacherNote: null, myNote: null, updatedAt: null,
      children: [
        { id: 'c2a', title: 'Zeroes of a polynomial', order: 0, status: 'DONE', teacherNote: null, myNote: null, updatedAt: '2026-09-20T04:00:00.000Z' },
        { id: 'c2b', title: 'Factorisation', order: 1, status: 'NOT_STARTED', teacherNote: null, myNote: null, updatedAt: null },
      ],
    },
  ],
};

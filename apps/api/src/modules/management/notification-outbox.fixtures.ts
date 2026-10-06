import type { NotificationOutboxKind } from '@skoolos/types';

export const S = 'Raffles Public School';
export const ID = '11111111-1111-1111-1111-111111111111';
const fx = { title: 'T', body: 'B' };

/** One realistic payload per kind — typed as a Record so a new kind is a compile error here. */
export const FIXTURES: Record<NotificationOutboxKind, unknown> = {
  RESULT_PUBLISHED: { schoolName: S, subjectName: 'Maths', examTitle: 'UT 2', classSectionName: '5-B', maxMarks: 20 },
  EXAM_SCHEDULED: { schoolName: S, subjectName: 'Maths', examTitle: 'UT 2', scheduledAt: 'Mon 6 Oct', classSectionName: '5-B', maxMarks: 20 },
  ASSIGNMENT_POSTED: { schoolName: S, subjectName: 'Maths', assignmentTitle: 'Fractions', dueDate: 'Fri 10 Oct', classSectionName: '5-B' },
  MESSAGE_RECEIVED: { schoolName: S, senderName: 'Priya Nair', subjectName: 'Maths', preview: 'See you', threadId: ID },
  LIBRARY_NOTICE: { schoolName: S, ...fx },
  SESSION_STARTED: { schoolName: S, ...fx },
  SPORTS_NOTICE: { title: '100 m U-11: Final', body: '14.2 s · 1st — champion!', tournamentId: ID },
  FEE_VERIFIED: { schoolName: S, ...fx },
  FEE_REJECTED: { schoolName: S, ...fx },
  FEE_DUE: { schoolName: S, ...fx },
  LEAVE_APPLIED: { schoolName: S, leaveId: ID, teacherName: 'Priya Nair', dates: 'Mon 13 – Tue 14 Oct', days: 2, reason: null, periodsAffected: 5 },
  LEAVE_DECIDED: { schoolName: S, leaveId: ID, decision: 'APPROVED', dates: 'Mon 13 Oct', byName: 'Darshan Jain' },
  COVER_ASSIGNED: { schoolName: S, substitutionId: ID, when: 'Mon 13 Oct, P3', className: '9-A', subjectName: 'Maths', originalTeacherName: 'Priya Nair' },
  CONCERN_RAISED: { schoolName: S, ...fx },
  CONCERN_REPLIED: { schoolName: S, ...fx },
  CONCERN_RESOLVED: { schoolName: S, ...fx },
};

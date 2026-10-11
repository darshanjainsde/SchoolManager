/**
 * Plain names for every kind of message a delivery log can show. The WhatsApp
 * card named 8 of them and printed the rest as raw codes ("COVER_UNFILLED");
 * the email log lower-cased the code. Unknown kinds fall back to a readable
 * version of the code, never the code itself.
 */
export const MESSAGE_WORDS: Record<string, string> = {
  TEST: 'Test message',
  ABSENCE_NOTICE: 'Absent today',
  ANNOUNCEMENT: 'Announcement',
  DIARY_REMARK: 'Diary remark',
  LOW_ATTENDANCE: 'Low attendance',
  TEST_SCHEDULED: 'Test scheduled',
  TEST_REMINDER: 'Test reminder',
  RESULTS_PUBLISHED: 'Results published',
  RESULT_PUBLISHED: 'Results published',
  EXAM_SCHEDULED: 'Exam scheduled',
  ASSIGNMENT_POSTED: 'Homework set',
  MESSAGE_RECEIVED: 'New message',
  LIBRARY_NOTICE: 'Library notice',
  SESSION_STARTED: 'New session',
  SPORTS_NOTICE: 'Sports notice',
  FEE_VERIFIED: 'Fee payment confirmed',
  FEE_REJECTED: 'Fee payment not accepted',
  FEE_DUE: 'Fee due',
  LEAVE_APPLIED: 'Leave applied',
  LEAVE_DECIDED: 'Leave decided',
  LEAVE_CANCELLED: 'Leave cancelled',
  COVER_ASSIGNED: 'Cover assigned',
  COVER_CANCELLED: 'Cover cancelled',
  COVER_UNFILLED: 'Cover still needed',
  CONCERN_RAISED: 'Concern raised',
  CONCERN_REPLIED: 'Concern answered',
  CONCERN_RESOLVED: 'Concern resolved',
};

export function messageWords(kind: string): string {
  if (MESSAGE_WORDS[kind]) return MESSAGE_WORDS[kind];
  const words = kind.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Message';
}

/** "20 Sep, 10:30 am" in the school's own time. */
export function whenIst(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

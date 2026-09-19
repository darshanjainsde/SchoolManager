import type { NotificationKind, NotificationMessage, PayloadFor } from '../notification.types';

/**
 * The WhatsApp template registry — ONE place that says, for each
 * NotificationKind, which Meta-approved template carries it and how its
 * payload becomes the template's positional parameters.
 *
 * Meta only lets a business START a conversation with a pre-approved
 * template; free text is allowed only inside the 24-hour window a family
 * opens by replying. So every kind here has a template that must exist, by
 * this exact name and language, in WhatsApp Manager. `SUBMISSIONS` below is
 * the text to paste there — kept next to the parameter mapping so the two
 * can never drift: a body with `{{5}}` and a mapping that yields four params
 * is rejected by Meta at send time, and by our spec before that.
 *
 * Parameter rules Meta enforces (and `param()` guarantees): no newlines or
 * tabs, no run of 4+ spaces, never empty, at most 1024 characters.
 */
export interface WhatsAppTemplate {
  name: string;
  language: string;
  params: string[];
}

export const TEMPLATE_LANGUAGE = 'en';
export const TEMPLATE_PREFIX = 'sckools_';

export const TEMPLATE_NAMES: Record<NotificationKind, string> = {
  TEST_SCHEDULED: `${TEMPLATE_PREFIX}test_scheduled`,
  TEST_REMINDER: `${TEMPLATE_PREFIX}test_reminder`,
  RESULTS_PUBLISHED: `${TEMPLATE_PREFIX}results_published`,
  ABSENCE_NOTICE: `${TEMPLATE_PREFIX}absence_notice`,
  ANNOUNCEMENT: `${TEMPLATE_PREFIX}announcement`,
  DIARY_REMARK: `${TEMPLATE_PREFIX}diary_remark`,
  LOW_ATTENDANCE: `${TEMPLATE_PREFIX}low_attendance`,
};

/** Meta's sample template on every new number — the pipeline smoke test. */
export const HELLO_WORLD: WhatsAppTemplate = { name: 'hello_world', language: 'en_US', params: [] };

/** A template parameter Meta will accept, whatever the office typed. */
export function param(value: unknown, fallback = '—'): string {
  const s = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  if (!s) return fallback;
  return s.length > 1024 ? `${s.slice(0, 1023)}…` : s;
}

function daysWord(n: number): string {
  if (n <= 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

export function templateFor(message: NotificationMessage): WhatsAppTemplate {
  const name = TEMPLATE_NAMES[message.kind];
  const language = TEMPLATE_LANGUAGE;
  switch (message.kind) {
    case 'TEST_SCHEDULED': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.subjectName), param(p.examTitle), param(p.scheduledAt), param(p.classSectionName, "your child's class")] };
    }
    case 'TEST_REMINDER': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.subjectName), param(p.examTitle), param(p.scheduledAt), daysWord(p.daysUntil)] };
    }
    case 'RESULTS_PUBLISHED': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.subjectName), param(p.examTitle)] };
    }
    case 'ABSENCE_NOTICE': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.studentName), param(p.date)] };
    }
    case 'ANNOUNCEMENT': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.className, 'the whole school'), param(p.title), param(p.body)] };
    }
    case 'DIARY_REMARK': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.studentName), param(p.className), param(p.teacherName), param(p.date), param(p.remark)] };
    }
    case 'LOW_ATTENDANCE': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.studentName), param(p.className), param(String(p.percent)), param(p.period), param(String(p.threshold))] };
    }
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

/**
 * The bodies to submit in WhatsApp Manager (category UTILITY, language
 * English). `{{n}}` placeholders correspond 1:1 to `templateFor`'s params —
 * the spec counts them. Sample values are what Meta's reviewer sees.
 */
export const SUBMISSIONS: Record<NotificationKind, { body: string; samples: string[] }> = {
  TEST_SCHEDULED: {
    body: '{{1}} has scheduled a {{2}} test, "{{3}}", on {{4}} for {{5}}. Open the Sckools app for the details.',
    samples: ['Raffles Public School', 'Mathematics', 'Unit test 2', 'Mon 6 Oct 2026', '5-B'],
  },
  TEST_REMINDER: {
    body: 'Reminder from {{1}}: the {{2}} test "{{3}}" is on {{4}} — that is {{5}}.',
    samples: ['Raffles Public School', 'Mathematics', 'Unit test 2', 'Mon 6 Oct 2026', 'in 3 days'],
  },
  RESULTS_PUBLISHED: {
    body: '{{1}} has published the results of the {{2}} test "{{3}}". Open the Sckools app to see the marks.',
    samples: ['Raffles Public School', 'Mathematics', 'Unit test 2'],
  },
  ABSENCE_NOTICE: {
    body: '{{1}}: {{2}} was marked absent on {{3}}. If this is a mistake, please tell the school office.',
    samples: ['Raffles Public School', 'Ravi Sharma', 'Thu 18 Sep 2026'],
  },
  ANNOUNCEMENT: {
    body: 'Announcement from {{1}} for {{2}} — {{3}}: {{4}}',
    samples: ['Raffles Public School', '5-B', 'PTM on Saturday', 'Parent–teacher meeting this Saturday, 10 am to 1 pm, in the school hall.'],
  },
  DIARY_REMARK: {
    body: '{{1}}: {{2}} ({{3}}) has a remark from {{4}} dated {{5}}: "{{6}}". Please read and sign it in the Sckools app.',
    samples: ['Raffles Public School', 'Ravi Sharma', '5-B', 'Priya Nair', 'Thu 18 Sep 2026', 'Homework not done for three days.'],
  },
  LOW_ATTENDANCE: {
    body: '{{1}}: {{2}} ({{3}}) has {{4}}% attendance for {{5}}, below the {{6}}% the school expects. Please make sure they attend.',
    samples: ['Raffles Public School', 'Ravi Sharma', '5-B', '68', '1 Jul 2026 – 18 Sep 2026', '75'],
  },
};

/** How many `{{n}}` placeholders a body carries. */
export const placeholderCount = (body: string) => new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;

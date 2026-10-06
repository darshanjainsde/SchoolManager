import type { NoticeTopic, NotificationKind, NotificationMessage, PayloadFor } from '../notification.types';

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
  /** Button parameters, by the button's position in the approved template. */
  buttons?: TemplateButton[];
  /**
   * The approved template to send instead while THIS one waits for Meta's
   * review (see template-approval.ts). Same parameters, fewer buttons.
   */
  fallback?: WhatsAppTemplate;
}
export type TemplateButton =
  | { type: 'quick_reply'; index: number; payload: string }
  | { type: 'url'; index: number; text: string }
  | { type: 'copy_code'; index: number; text: string };

export const TEMPLATE_LANGUAGE = 'en';
export const TEMPLATE_PREFIX = 'sckools_';

export const TEMPLATE_NAMES: Record<NotificationKind, string> = {
  TEST_SCHEDULED: `${TEMPLATE_PREFIX}test_scheduled`,
  TEST_REMINDER: `${TEMPLATE_PREFIX}test_reminder`,
  RESULTS_PUBLISHED: `${TEMPLATE_PREFIX}results_published`,
  ABSENCE_NOTICE: `${TEMPLATE_PREFIX}absence_notice`,
  // NOT `announcement`: Meta moved that one to MARKETING on 2026-10-01 and a
  // free-text catch-all can never come back (see the SUBMISSIONS note below).
  ANNOUNCEMENT: `${TEMPLATE_PREFIX}notice_posted`,
  DIARY_REMARK: `${TEMPLATE_PREFIX}diary_remark`,
  LOW_ATTENDANCE: `${TEMPLATE_PREFIX}low_attendance`,
  LEAVE_APPLIED: `${TEMPLATE_PREFIX}leave_applied`,
  LEAVE_DECIDED: `${TEMPLATE_PREFIX}leave_decided`,
  COVER_ASSIGNED: `${TEMPLATE_PREFIX}cover_assigned`,
};

/** One narrow Utility template per notice topic — what lets a holiday or fee date reach WhatsApp with its facts. */
export const NOTICE_TEMPLATES: Record<NoticeTopic['kind'], string> = {
  HOLIDAY: `${TEMPLATE_PREFIX}holiday_notice`,
  PTM: `${TEMPLATE_PREFIX}ptm_notice`,
  TIMING: `${TEMPLATE_PREFIX}timing_change`,
  FEE: `${TEMPLATE_PREFIX}fee_due`,
};

/** AUTHENTICATION category: Meta fixes the body; only the code is a parameter, and the copy-code button repeats it. */
export const VERIFY_CODE = `${TEMPLATE_PREFIX}verify_code`;
export function verifyCodeTemplate(code: string): WhatsAppTemplate {
  return { name: VERIFY_CODE, language: TEMPLATE_LANGUAGE, params: [code], buttons: [{ type: 'copy_code', index: 0, text: code }] };
}

/** When the 24-hour window has closed and a list cannot be sent: point at the console instead. */
export const COVER_PENDING = `${TEMPLATE_PREFIX}cover_pending`;
export function coverPendingTemplate(schoolName: string, gaps: number): WhatsAppTemplate {
  return { name: COVER_PENDING, language: TEMPLATE_LANGUAGE, params: [param(schoolName), String(gaps)] };
}

/**
 * Tier 1 (2026-10-06). A button cannot be added to an approved template in
 * place, so "Got it · Can't" is a new name. Submitted at the start of the
 * tier; the code sends it only once Meta's list says APPROVED.
 */
export const COVER_ASSIGNED_V2 = `${TEMPLATE_PREFIX}cover_assigned_v2`;
/** A cover (or a whole leave) called off — to the substitute and to the desk. */
export const COVER_CANCELLED = `${TEMPLATE_PREFIX}cover_cancelled`;

/**
 * Names that are sent only after Meta's live list says APPROVED. Everything
 * else in this file was approved before the code that sends it shipped.
 * Remove a name once it is approved on production.
 */
export const GATED_TEMPLATES: ReadonlySet<string> = new Set([COVER_ASSIGNED_V2, COVER_CANCELLED]);

/** Meta's sample template on every new number — the pipeline smoke test. */
export const HELLO_WORLD: WhatsAppTemplate = { name: 'hello_world', language: 'en_US', params: [] };

/**
 * The test send's fallback, for a school on a REAL number.
 *
 * `hello_world` is refused off Meta's public test numbers (code 131058), so
 * the test button has to prove the pipeline with a template of the school's
 * own that Meta has approved. The absence notice is the one every school has,
 * and the wording below is written so nobody who receives it thinks a child
 * is actually absent.
 */
export function testNoticeTemplate(schoolName: string): WhatsAppTemplate {
  return {
    name: TEMPLATE_NAMES.ABSENCE_NOTICE,
    language: TEMPLATE_LANGUAGE,
    params: [
      param(schoolName),
      param('This is a WhatsApp test — nobody'),
      param('today. Please ignore it'),
    ],
  };
}

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

/**
 * Who the message is FOR, when the login it is addressed to is a child's.
 * One guardian phone often serves two or three children, so every notice
 * about one child names that child — the family reads "Ravi Sharma (5-B)"
 * and knows at a glance whose test, whose marks, whose class. The channel
 * fills this in from the student record at send time; class-level payloads
 * stay shared across recipients.
 */
export interface TemplateContext {
  child?: { name: string; className: string | null } | null;
}

/** "Ravi Sharma (5-B)", or the fallback when the recipient is not a child's login. */
export function childLabel(ctx: TemplateContext | undefined, fallback: string): string {
  const c = ctx?.child;
  if (!c || !c.name.trim()) return fallback;
  return param(c.className ? `${c.name} (${c.className})` : c.name, fallback);
}

export function templateFor(message: NotificationMessage, ctx: TemplateContext = {}): WhatsAppTemplate {
  const name = TEMPLATE_NAMES[message.kind];
  const language = TEMPLATE_LANGUAGE;
  switch (message.kind) {
    case 'TEST_SCHEDULED': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), childLabel(ctx, p.classSectionName ? `your child in ${p.classSectionName}` : 'your child'), param(p.subjectName), param(p.examTitle), param(p.scheduledAt)] };
    }
    case 'TEST_REMINDER': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), childLabel(ctx, 'your child'), param(p.subjectName), param(p.examTitle), param(p.scheduledAt), daysWord(p.daysUntil)] };
    }
    case 'RESULTS_PUBLISHED': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.subjectName), param(p.examTitle), childLabel(ctx, 'your child')] };
    }
    case 'ABSENCE_NOTICE': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.studentName), param(p.date)] };
    }
    case 'ANNOUNCEMENT': {
      const p = message.payload;
      const t = p.topic;
      if (t?.kind === 'HOLIDAY') return { name: NOTICE_TEMPLATES.HOLIDAY, language, params: [param(p.schoolName), param(t.closedOn), param(t.occasion), param(t.resumesOn)] };
      if (t?.kind === 'PTM') return { name: NOTICE_TEMPLATES.PTM, language, params: [param(p.schoolName), param(p.className ?? ctx.child?.className ?? 'every class'), param(t.on), param(t.at)] };
      if (t?.kind === 'TIMING') return { name: NOTICE_TEMPLATES.TIMING, language, params: [param(p.schoolName), param(t.on), param(t.from), param(t.to)] };
      if (t?.kind === 'FEE') return { name: NOTICE_TEMPLATES.FEE, language, params: [param(p.schoolName), param(`${t.term} of ${childLabel(ctx, 'your child')}`), param(t.dueOn)] };
      // A class announcement names the child in that class; a school-wide one
      // stays the same words for every child on the phone, so siblings on one
      // number get ONE copy (the channel drops identical text within a minute).
      const who = p.className ? childLabel(ctx, p.className) : 'the whole school';
      // THE BODY IS NOT SENT. It stays in the app, which is what makes this a
      // UTILITY message instead of a MARKETING one, and keeps a school's words
      // off a lock screen. Email still carries them in full.
      return { name, language, params: [param(p.schoolName), param(p.title), param(p.postedOn), who] };
    }
    case 'DIARY_REMARK': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.studentName), param(p.className), param(p.teacherName), param(p.date), param(p.remark)] };
    }
    case 'LOW_ATTENDANCE': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.studentName), param(p.className), param(String(p.percent)), param(p.period), param(String(p.threshold))] };
    }
    case 'LEAVE_APPLIED': {
      const p = message.payload;
      return {
        name, language,
        params: [param(p.schoolName), param(p.teacherName), param(p.dates), param(String(p.days)), param(p.reason, 'no reason given'), param(String(p.periodsAffected))],
        buttons: [
          { type: 'quick_reply', index: 0, payload: p.approvePayload },
          { type: 'quick_reply', index: 1, payload: p.rejectPayload },
        ],
      };
    }
    case 'LEAVE_DECIDED': {
      const p = message.payload;
      return { name, language, params: [param(p.schoolName), param(p.decision === 'APPROVED' ? 'approved' : 'not approved'), param(p.dates), param(p.byName, 'the office')] };
    }
    case 'COVER_ASSIGNED': {
      const p = message.payload;
      return {
        name, language,
        params: [param(p.schoolName), param(p.when), param(p.className), param(p.subjectName, 'the class'), param(p.originalTeacherName)],
        buttons: [{ type: 'quick_reply', index: 0, payload: p.ackPayload }],
      };
    }
    default: {
      const _exhaustive: never = message;
      return _exhaustive;
    }
  }
}

/**
 * The bodies to submit (category UTILITY, language English). `{{n}}`
 * placeholders correspond 1:1 to `templateFor`'s params — the spec counts
 * them. Sample values are what Meta's reviewer sees.
 *
 * TWO OF META'S RULES SHAPE EVERY BODY HERE, and both were learnt the hard
 * way: all twelve were refused on 2026-09-22 when they were first submitted.
 *
 *   1. A body may not START or END with a variable. Every one of these used
 *      to open with `{{1}}` (the school's name), which reads naturally and is
 *      not allowed. Each now opens with a few words of its own.
 *   2. A body needs enough text for the number of variables it carries, so a
 *      terse line with six of them is refused too.
 *
 * Variables also appear in ascending order in the text now. That is not a
 * written rule, but a body that jumps {{1}} {{3}} {{2}} is one a reviewer has
 * to stop and think about, and two of these did.
 *
 * `scripts/whatsapp-templates.mjs` reads THIS object to submit them, so what
 * Meta approves can never drift from what `templateFor` sends.
 */
export const SUBMISSIONS: Record<NotificationKind, { body: string; samples: string[]; buttons?: string[] }> = {
  TEST_SCHEDULED: {
    body: 'A message from {{1}}. {{2}} has a {{3}} test, "{{4}}", on {{5}}. Open the Sckools app to see the syllabus and the timing.',
    samples: ['Raffles Public School', 'Ravi Sharma (5-B)', 'Mathematics', 'Unit test 2', 'Mon 6 Oct 2026'],
  },
  TEST_REMINDER: {
    body: 'A reminder from {{1}}. {{2}} has the {{3}} test "{{4}}" on {{5}}, which is {{6}}. Open the Sckools app to see what to prepare.',
    samples: ['Raffles Public School', 'Ravi Sharma (5-B)', 'Mathematics', 'Unit test 2', 'Mon 6 Oct 2026', 'in 3 days'],
  },
  RESULTS_PUBLISHED: {
    body: 'The results are out at {{1}}. Marks for the {{2}} test "{{3}}" are ready for {{4}}. Open the Sckools app to see them.',
    samples: ['Raffles Public School', 'Mathematics', 'Unit test 2', 'Ravi Sharma (5-B)'],
  },
  ABSENCE_NOTICE: {
    body: 'A message from {{1}}. {{2}} was marked absent on {{3}}. If this is a mistake, please tell the school office.',
    samples: ['Raffles Public School', 'Ravi Sharma', 'Thu 18 Sep 2026'],
  },
  ANNOUNCEMENT: {
    // Submitted 2026-10-01 and accepted as UTILITY, where the old wording had
    // just been moved to MARKETING. The difference is not "free text" —
    // `diary_remark` quotes a teacher's own words and is still UTILITY — it is
    // that the FIXED words here name a concrete event (a notice, posted on a
    // day, for a class) and an action, so Meta can tell what the message is.
    // The old body described any message at all, and `{{4}}` was the message.
    body: 'A school notice from {{1}}: "{{2}}", posted on {{3}} for {{4}}. Open the Sckools app to read it in full, with your child\'s other school updates.',
    samples: ['Raffles Public School', 'Ravi Sharma (5-B)', 'PTM on Saturday', 'Parent–teacher meeting this Saturday, 10 am to 1 pm, in the school hall.'],
  },
  DIARY_REMARK: {
    body: 'A diary note from {{1}}. {{2}} of class {{3}} has a remark from {{4}}, dated {{5}}. It says: "{{6}}". Please read and sign it in the Sckools app.',
    samples: ['Raffles Public School', 'Ravi Sharma', '5-B', 'Priya Nair', 'Thu 18 Sep 2026', 'Homework not done for three days.'],
  },
  LOW_ATTENDANCE: {
    body: 'An attendance notice from {{1}}. {{2}} of class {{3}} has {{4}} per cent attendance for {{5}}, below the {{6}} per cent the school expects. Please make sure they attend.',
    samples: ['Raffles Public School', 'Ravi Sharma', '5-B', '68', '1 Jul 2026 – 18 Sep 2026', '75'],
  },
  LEAVE_APPLIED: {
    body: 'A leave request at {{1}}. {{2}} has applied for leave on {{3}}, which is {{4}} days. The reason given is {{5}}. {{6}} periods would need cover. Approve or reject below, or do it in the console.',
    samples: ['Raffles Public School', 'Priya Nair', 'Mon 22 – Tue 23 Sep 2026', '2', 'Family function', '5'],
    buttons: ['Approve', 'Reject'],
  },
  LEAVE_DECIDED: {
    body: 'A message from {{1}}. Your leave has been {{2}} for {{3}}, by {{4}}. Open the Sckools app for the details.',
    samples: ['Raffles Public School', 'approved', 'Mon 22 – Tue 23 Sep 2026', 'Darshan Jain'],
  },
  COVER_ASSIGNED: {
    body: 'A cover duty at {{1}}. On {{2}} you are covering class {{3}} for {{4}}, in place of {{5}}. Tap below to confirm you have seen this.',
    samples: ['Raffles Public School', 'Mon 22 Sep, period 3 (10:15–11:00)', '9-A', 'Mathematics', 'Priya Nair'],
    buttons: ['Got it'],
  },
};

/** Not notification kinds, but templates all the same — submitted with the others. */
export const EXTRA_SUBMISSIONS: Record<string, { category: 'AUTHENTICATION' | 'UTILITY'; body: string; samples: string[]; buttons?: string[] }> = {
  [VERIFY_CODE]: {
    category: 'AUTHENTICATION',
    body: '{{1}} is your Sckools verification code. For your security, do not share this code.',
    samples: ['482911'],
    buttons: ['Copy code'],
  },
  [COVER_PENDING]: {
    category: 'UTILITY',
    body: 'A message from {{1}}. {{2}} periods still need cover after the leave you approved. Open the console to assign teachers.',
    samples: ['Raffles Public School', '3'],
  },
  [COVER_ASSIGNED_V2]: {
    category: 'UTILITY',
    body: "A cover duty at {{1}}. On {{2}} you are covering class {{3}} for {{4}}, in place of {{5}}. Tap Got it if you will take it, or Can't so the office can find someone else.",
    samples: ['Raffles Public School', 'Mon 22 Sep, period 3 (10:15–11:00)', '9-A', 'Mathematics', 'Priya Nair'],
    buttons: ['Got it', "Can't"],
  },
  [COVER_CANCELLED]: {
    category: 'UTILITY',
    body: 'A change at {{1}}: {{2}} on {{3}} is called off, because {{4}}. Open the Sckools app to see the day as it now stands.',
    samples: ['Raffles Public School', 'your cover of 9-A, period 3', 'Mon 22 Sep 2026', 'the leave it was for was cancelled'],
  },
  [NOTICE_TEMPLATES.HOLIDAY]: {
    category: 'UTILITY',
    body: 'Holiday at {{1}}: the school will be closed on {{2}} for {{3}}. Classes resume as usual on {{4}}. Nothing else changes.',
    samples: ['Raffles Public School', 'Thu 2 Oct 2026', 'Gandhi Jayanti', 'Fri 3 Oct 2026'],
  },
  [NOTICE_TEMPLATES.PTM]: {
    category: 'UTILITY',
    body: 'Parents meeting at {{1}}: the meeting for class {{2}} is on {{3}} at {{4}}. Please come to the school reception a few minutes early.',
    samples: ['Raffles Public School', '5-B', 'Sat 11 Oct 2026', '10:00 am'],
  },
  [NOTICE_TEMPLATES.TIMING]: {
    category: 'UTILITY',
    body: 'Timing change at {{1}}: on {{2}} the school day will run from {{3}} to {{4}} instead of the usual hours. Buses follow the same change.',
    samples: ['Raffles Public School', 'Mon 13 Oct 2026', '8:00 am', '12:30 pm'],
  },
  [NOTICE_TEMPLATES.FEE]: {
    category: 'UTILITY',
    body: 'Fees at {{1}}: the fees for {{2}} are due on {{3}}. Open the Sckools app to pay, to see the bill, or to tell the office you have already paid.',
    samples: ['Raffles Public School', 'Term 2 of Ravi Sharma (5-B)', 'Mon 13 Oct 2026'],
  },
};

/** How many `{{n}}` placeholders a body carries. */
export const placeholderCount = (body: string) => new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;

export interface TemplateSubmission {
  name: string;
  category: 'AUTHENTICATION' | 'UTILITY';
  body: string;
  samples: string[];
  buttons: string[];
}

/**
 * Every template, by the NAME the code sends — what `scripts/whatsapp-templates.mjs`
 * submits. Built from TEMPLATE_NAMES rather than from the kind's spelling, so a
 * kind that rides another kind's template (a v2, a shared "called off" card)
 * submits that template once. Two different bodies under one name is a bug and
 * throws.
 */
export function templateSubmissions(): TemplateSubmission[] {
  const out = new Map<string, TemplateSubmission>();
  const put = (s: TemplateSubmission) => {
    const had = out.get(s.name);
    if (had && had.body !== s.body) throw new Error(`Two different bodies are registered for ${s.name}`);
    if (!had) out.set(s.name, s);
  };
  for (const kind of Object.keys(SUBMISSIONS) as NotificationKind[]) {
    const s = SUBMISSIONS[kind];
    put({ name: TEMPLATE_NAMES[kind], category: 'UTILITY', body: s.body, samples: s.samples, buttons: s.buttons ?? [] });
  }
  for (const [name, s] of Object.entries(EXTRA_SUBMISSIONS)) {
    put({ name, category: s.category, body: s.body, samples: s.samples, buttons: s.buttons ?? [] });
  }
  return [...out.values()];
}

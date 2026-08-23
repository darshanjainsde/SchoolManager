import { platformBrand, renderLetter } from '../mail/letterhead';
import { MailService } from '../mail/mail.service';
import { EmailChannel } from './email.channel';
import type {
  AbsenceNoticePayload,
  ResultsPublishedPayload,
  TestReminderPayload,
  TestScheduledPayload,
} from './notification.types';

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Drives the REAL `EmailChannel` against the REAL `MailService` composers,
 * stubbing only the SMTP hop (`MailService.send`). The instance is built off
 * the prototype rather than via `new MailService()` because the constructor
 * calls `loadEnv()` + `createTransport()`, neither of which belongs in a unit
 * test — the composer methods under test touch neither.
 *
 * This is the regression net for the bug where callers passed ids
 * (`examId`, `subjectId`, `title`) while the composers read names
 * (`schoolName`, `subjectName`, `examTitle`): every assertion below checks
 * the rendered subject/body, and every case asserts the literal string
 * "undefined" never appears.
 */
function harness(): { channel: EmailChannel; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const mail = Object.create(MailService.prototype) as MailService;
  // The channel now hands MailService a `Letter` and the letterhead renders
  // it. Rendering it here with the platform brand keeps every assertion below
  // testing what it always tested — the STRING a parent actually receives.
  (mail as unknown as { sendLetter: MailService['sendLetter'] }).sendLetter = async (
    to,
    _schoolId,
    subject,
    letter,
  ) => {
    const { html, text } = renderLetter(platformBrand(), letter);
    sent.push({ to, subject, html, text });
    return true;
  };
  return { channel: new EmailChannel(mail), sent };
}

/** The exact payload `ExamsService.create` builds today — already IST-formatted. */
const TEST_SCHEDULED: TestScheduledPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Mathematics',
  examTitle: 'Unit Test 1',
  scheduledAt: 'Sat, 1 Aug 2026, 2:30 PM',
};

/** The exact payload `ExamRemindersService.run` builds today — already IST-formatted. */
const TEST_REMINDER: TestReminderPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Physics',
  examTitle: 'Midterm',
  scheduledAt: 'Thu, 23 Jul 2026, 2:30 PM',
  daysUntil: 2,
};

/** The exact payload `ExamsService.publish` builds today. */
const RESULTS_PUBLISHED: ResultsPublishedPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Chemistry',
  examTitle: 'Half Yearly',
};

/** The exact payload `AttendanceService.save` builds today — already IST-formatted. */
const ABSENCE_NOTICE: AbsenceNoticePayload = {
  schoolName: 'Green Valley School',
  studentName: 'Aisha Khan',
  date: 'Tue, 21 Jul 2026',
};

/** Arbitrary — `EmailChannel` receives `schoolId` (part of the shared
 * `NotificationChannel` contract) but ignores it, since SMTP delivery needs
 * no DB lookup at all. */
const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('EmailChannel', () => {
  it('renders TEST_SCHEDULED with the school, subject, title and date — no "undefined"', async () => {
    const { channel, sent } = harness();

    const ok = await channel.send(
      'parent@x.com',
      {
        kind: 'TEST_SCHEDULED',
        payload: TEST_SCHEDULED,
      },
      SCHOOL,
    );

    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail.to).toBe('parent@x.com');
    expect(mail.subject).toBe('New test scheduled: Unit Test 1');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Mathematics');
    expect(mail.text).toContain('Sat, 1 Aug 2026, 2:30 PM');
    expect(mail.html).toContain('Green Valley School');
    expect(mail.html).toContain('Mathematics');
    expect(mail.html).toContain('Unit Test 1');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
    // Regression net for the raw-ISO-timestamp bug: a parent must never see
    // e.g. `2026-08-01T03:30:00.000Z` in a rendered email body.
    expect(mail.html).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(mail.text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('renders TEST_REMINDER with the days-until countdown — no "undefined"', async () => {
    const { channel, sent } = harness();

    await channel.send('parent@x.com', { kind: 'TEST_REMINDER', payload: TEST_REMINDER }, SCHOOL);

    const mail = sent[0];
    expect(mail.subject).toBe('Reminder: Midterm in 2 days');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Physics');
    expect(mail.html).toContain('Midterm');
    expect(mail.html).toContain('2 day');
    expect(mail.text).toContain('Thu, 23 Jul 2026, 2:30 PM');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
    expect(mail.html).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(mail.text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('renders TEST_REMINDER in the singular for a 1-day-out exam', async () => {
    const { channel, sent } = harness();

    await channel.send(
      'parent@x.com',
      {
        kind: 'TEST_REMINDER',
        payload: { ...TEST_REMINDER, daysUntil: 1 },
      },
      SCHOOL,
    );

    expect(sent[0].subject).toBe('Reminder: Midterm in 1 day');
    expect(`${sent[0].subject} ${sent[0].html} ${sent[0].text}`).not.toContain('undefined');
  });

  it('renders RESULTS_PUBLISHED with the school, subject and exam title — no "undefined"', async () => {
    const { channel, sent } = harness();

    await channel.send(
      'parent@x.com',
      {
        kind: 'RESULTS_PUBLISHED',
        payload: RESULTS_PUBLISHED,
      },
      SCHOOL,
    );

    const mail = sent[0];
    expect(mail.subject).toBe('Results published: Half Yearly');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Chemistry');
    expect(mail.html).toContain('Half Yearly');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
  });

  it('renders ABSENCE_NOTICE naming the specific student and date — no "undefined"', async () => {
    const { channel, sent } = harness();

    await channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE }, SCHOOL);

    const mail = sent[0];
    expect(mail.subject).toBe('Absence notice: Aisha Khan');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Aisha Khan');
    expect(mail.text).toContain('Tue, 21 Jul 2026');
    expect(mail.html).toContain('Aisha Khan');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
    expect(mail.html).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(mail.text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('escapes school-authored text before it reaches the HTML body', async () => {
    const { channel, sent } = harness();

    await channel.send(
      'parent@x.com',
      {
        kind: 'TEST_SCHEDULED',
        payload: {
          ...TEST_SCHEDULED,
          examTitle: '<script>alert(1)</script>',
          schoolName: 'Green & "Valley" <b>School</b>',
        },
      },
      SCHOOL,
    );

    const mail = sent[0];
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('Green &amp; &quot;Valley&quot; &lt;b&gt;School&lt;/b&gt;');
  });

  it('reports a delivery failure as false rather than throwing', async () => {
    const mail = Object.create(MailService.prototype) as MailService;
    (mail as unknown as { sendLetter: MailService['sendLetter'] }).sendLetter = async () => false;
    const channel = new EmailChannel(mail);

    await expect(
      channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE }, SCHOOL),
    ).resolves.toBe(false);
  });
});

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
  (mail as unknown as { send: MailService['send'] }).send = async (to, subject, html, text) => {
    sent.push({ to, subject, html, text });
    return true;
  };
  return { channel: new EmailChannel(mail), sent };
}

/** The exact payload `ExamsService.create` builds today. */
const TEST_SCHEDULED: TestScheduledPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Mathematics',
  examTitle: 'Unit Test 1',
  scheduledAt: '2026-08-01T09:00:00.000Z',
};

/** The exact payload `ExamRemindersService.run` builds today. */
const TEST_REMINDER: TestReminderPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Physics',
  examTitle: 'Midterm',
  scheduledAt: '2026-07-23T09:00:00.000Z',
  daysUntil: 2,
};

/** The exact payload `ExamsService.publish` builds today. */
const RESULTS_PUBLISHED: ResultsPublishedPayload = {
  schoolName: 'Green Valley School',
  subjectName: 'Chemistry',
  examTitle: 'Half Yearly',
};

/** The exact payload `AttendanceService.save` builds today. */
const ABSENCE_NOTICE: AbsenceNoticePayload = {
  schoolName: 'Green Valley School',
  studentName: 'Aisha Khan',
  date: '2026-07-21',
};

describe('EmailChannel', () => {
  it('renders TEST_SCHEDULED with the school, subject, title and date — no "undefined"', async () => {
    const { channel, sent } = harness();

    const ok = await channel.send('parent@x.com', {
      kind: 'TEST_SCHEDULED',
      payload: TEST_SCHEDULED,
    });

    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail.to).toBe('parent@x.com');
    expect(mail.subject).toBe('New test scheduled: Unit Test 1');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Mathematics');
    expect(mail.text).toContain('2026-08-01T09:00:00.000Z');
    expect(mail.html).toContain('Green Valley School');
    expect(mail.html).toContain('Mathematics');
    expect(mail.html).toContain('Unit Test 1');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
  });

  it('renders TEST_REMINDER with the days-until countdown — no "undefined"', async () => {
    const { channel, sent } = harness();

    await channel.send('parent@x.com', { kind: 'TEST_REMINDER', payload: TEST_REMINDER });

    const mail = sent[0];
    expect(mail.subject).toBe('Reminder: Midterm in 2 days');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Physics');
    expect(mail.html).toContain('Midterm');
    expect(mail.html).toContain('2 day');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
  });

  it('renders TEST_REMINDER in the singular for a 1-day-out exam', async () => {
    const { channel, sent } = harness();

    await channel.send('parent@x.com', {
      kind: 'TEST_REMINDER',
      payload: { ...TEST_REMINDER, daysUntil: 1 },
    });

    expect(sent[0].subject).toBe('Reminder: Midterm in 1 day');
    expect(`${sent[0].subject} ${sent[0].html} ${sent[0].text}`).not.toContain('undefined');
  });

  it('renders RESULTS_PUBLISHED with the school, subject and exam title — no "undefined"', async () => {
    const { channel, sent } = harness();

    await channel.send('parent@x.com', {
      kind: 'RESULTS_PUBLISHED',
      payload: RESULTS_PUBLISHED,
    });

    const mail = sent[0];
    expect(mail.subject).toBe('Results published: Half Yearly');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Chemistry');
    expect(mail.html).toContain('Half Yearly');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
  });

  it('renders ABSENCE_NOTICE naming the specific student and date — no "undefined"', async () => {
    const { channel, sent } = harness();

    await channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE });

    const mail = sent[0];
    expect(mail.subject).toBe('Absence notice: Aisha Khan');
    expect(mail.text).toContain('Green Valley School');
    expect(mail.text).toContain('Aisha Khan');
    expect(mail.text).toContain('2026-07-21');
    expect(mail.html).toContain('Aisha Khan');
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain('undefined');
  });

  it('escapes school-authored text before it reaches the HTML body', async () => {
    const { channel, sent } = harness();

    await channel.send('parent@x.com', {
      kind: 'TEST_SCHEDULED',
      payload: {
        ...TEST_SCHEDULED,
        examTitle: '<script>alert(1)</script>',
        schoolName: 'Green & "Valley" <b>School</b>',
      },
    });

    const mail = sent[0];
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('Green &amp; &quot;Valley&quot; &lt;b&gt;School&lt;/b&gt;');
  });

  it('reports a delivery failure as false rather than throwing', async () => {
    const mail = Object.create(MailService.prototype) as MailService;
    (mail as unknown as { send: MailService['send'] }).send = async () => false;
    const channel = new EmailChannel(mail);

    await expect(
      channel.send('parent@x.com', { kind: 'ABSENCE_NOTICE', payload: ABSENCE_NOTICE }),
    ).resolves.toBe(false);
  });
});

import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@skoolos/config';
import { captureError } from '../observability/sentry-lite';
import { MailIdentityService } from './mail-identity.service';
import { escapeHtml, renderLetter, type Letter } from './letterhead';
import type {
  AbsenceNoticePayload,
  AnnouncementPayload,
  DiaryRemarkPayload,
  LowAttendancePayload,
  ResultsPublishedPayload,
  TestReminderPayload,
  TestScheduledPayload,
} from '../notifications/notification.types';

/**
 * The notification payload interfaces live in `notification.types.ts` (the
 * authoritative contract shared with every caller and channel); these aliases
 * exist only so the composer signatures below read naturally.
 */
export type TestScheduledInfo = TestScheduledPayload;
export type TestReminderInfo = TestReminderPayload;
export type ResultsPublishedInfo = ResultsPublishedPayload;
export type AbsenceNoticeInfo = AbsenceNoticePayload;
export type AnnouncementInfo = AnnouncementPayload;
export type DiaryRemarkInfo = DiaryRemarkPayload;
export type LowAttendanceInfo = LowAttendancePayload;

/** Re-exported so existing importers (marketing, library) keep working. */
export { escapeHtml };

/**
 * Composes and sends every email the product sends.
 *
 * Each method here decides only WHAT the message says — a `Letter` of title,
 * intro, rows and one action. Who it is from and what it looks like is decided
 * once, in `MailIdentityService` + `letterhead.ts`, so a school's crest and
 * colour reach all twelve message kinds without any of them knowing that
 * schools have branding at all.
 *
 * Every method takes `schoolId` so the letterhead can be resolved. `null` means
 * "this mail belongs to no school" (owner/marketing) and gets the platform
 * identity.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly env = loadEnv();

  constructor(private readonly identity: MailIdentityService) {}

  /**
   * Renders a letter on the school's letterhead and sends it.
   * Failures are logged and reported, never thrown to callers — a mail outage
   * must not roll back the attendance register that triggered it.
   */
  async sendLetter(
    to: string,
    schoolId: string | null,
    subject: string,
    letter: Letter,
  ): Promise<boolean> {
    const id = await this.identity.forSchool(schoolId);
    const { html, text } = renderLetter(id.brand, letter);
    try {
      await id.transporter.sendMail({
        from: id.from,
        ...(id.replyTo ? { replyTo: id.replyTo } : {}),
        to,
        subject,
        html,
        text,
      });
      return true;
    } catch (e) {
      this.logger.error(`Mail to ${to} failed: ${(e as Error).message}`);
      // Launch-gate #2/#4: a transport failure must be VISIBLE — a school
      // half-invited by a silent mail outage looks identical to a finished
      // one. PII discipline: only the recipient's mail DOMAIN travels — the
      // subject must not, because composed subjects embed student names
      // ("Absence notice: <name>"), and a morning outage would otherwise
      // hand a third-party processor a list of named absent minors.
      captureError(e, {
        kind: 'mail',
        domain: to.split('@')[1] ?? 'unknown',
        sender: id.usingCustomSender ? 'school' : 'platform',
      });
      // A school's OWN sender that fails is a configuration problem only its
      // admin can fix, so it is recorded against the school and surfaced in
      // the Email settings tab rather than living in a log nobody reads.
      if (id.usingCustomSender && id.schoolId) {
        await this.recordSenderFailure(id.schoolId, (e as Error).message);
      }
      return false;
    }
  }

  /**
   * Marks a school's own sender as FAILING and drops it back to the platform
   * mailbox for subsequent sends. Deliberately best-effort: if this write
   * fails there is nothing further to do, and it must never mask the mail
   * error that caused it.
   */
  private async recordSenderFailure(schoolId: string, message: string): Promise<void> {
    try {
      const { getPlatformPrisma } = await import('@skoolos/db');
      await getPlatformPrisma().emailSettings.update({
        where: { schoolId },
        data: { senderStatus: 'FAILING', lastError: message.slice(0, 500), lastErrorAt: new Date() },
      });
      this.identity.invalidate(schoolId);
    } catch (e) {
      this.logger.warn(`Could not record sender failure for ${schoolId}: ${(e as Error).message}`);
    }
  }

  // ── Platform mail (no school) ───────────────────────────

  async sendLeadNotification(
    to: string,
    lead: { name: string | null; phone: string; school: string | null; interest: string | null; source: string },
  ): Promise<boolean> {
    const who = lead.name ?? 'Someone';
    const subject = `New Sckools lead: ${who}${lead.school ? ` — ${lead.school}` : ''}`;
    // Every value here is typed by an anonymous visitor on the public form.
    // The letterhead renderer escapes on the way out, so no interpolation
    // happens in this method at all.
    return this.sendLetter(to, null, subject, {
      title: 'New callback request',
      intro: 'Someone asked to be called back from sckools.com.',
      rows: [
        { label: 'Name', value: lead.name ?? '—' },
        { label: 'Phone', value: lead.phone },
        { label: 'School', value: lead.school ?? '—' },
        { label: 'Interested in', value: lead.interest ?? '—' },
        { label: 'Source', value: lead.source },
      ],
      note: 'Open the owner console → Marketing leads to follow up.',
    });
  }

  // ── Account mail ────────────────────────────────────────

  async sendPasswordReset(
    to: string,
    schoolName: string,
    resetUrl: string,
    schoolId: string | null = null,
  ): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Reset your ${schoolName} password`, {
      title: 'Reset your password',
      intro: `Someone requested a password reset for your ${schoolName} account.`,
      cta: { label: 'Set a new password', url: resetUrl },
      note: "The link is valid for 30 minutes and can be used once. If this wasn't you, ignore this email — your password is unchanged.",
    });
  }

  async sendWelcomeInvite(
    to: string,
    schoolName: string,
    loginName: string,
    setPasswordUrl: string,
    schoolId: string | null = null,
  ): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Welcome to ${schoolName} — set your password`, {
      title: `Welcome to ${schoolName}`,
      intro: 'Your account is ready. Set a password to sign in.',
      rows: [{ label: 'Sign-in name', value: loginName }],
      cta: { label: 'Set your password', url: setPasswordUrl },
      note: "The link is valid for 30 minutes and can be used once. If you weren't expecting this, you can safely ignore this email.",
    });
  }

  // ── School notifications ────────────────────────────────

  async sendTestScheduled(to: string, info: TestScheduledInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `New test scheduled: ${info.examTitle}`, {
      title: 'New test scheduled',
      intro: `${info.schoolName} has scheduled a new test.`,
      rows: [
        { label: 'Subject', value: info.subjectName },
        { label: 'Test', value: info.examTitle },
        { label: 'Date', value: info.scheduledAt },
      ],
      note: 'Check the school portal for more details.',
    });
  }

  async sendTestReminder(to: string, info: TestReminderInfo, schoolId: string | null = null): Promise<boolean> {
    const days = `${info.daysUntil} day${info.daysUntil === 1 ? '' : 's'}`;
    return this.sendLetter(to, schoolId, `Reminder: ${info.examTitle} in ${days}`, {
      title: 'Upcoming test',
      intro: `${info.schoolName}: ${info.examTitle} is ${days} away.`,
      rows: [
        { label: 'Subject', value: info.subjectName },
        { label: 'Test', value: info.examTitle },
        { label: 'Date', value: info.scheduledAt },
      ],
    });
  }

  async sendResultsPublished(to: string, info: ResultsPublishedInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Results published: ${info.examTitle}`, {
      title: 'Results published',
      intro: `${info.schoolName} has published results for ${info.examTitle} (${info.subjectName}).`,
      note: 'Check the school portal to view them.',
    });
  }

  async sendAbsenceNotice(to: string, info: AbsenceNoticeInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Absence notice: ${info.studentName}`, {
      title: 'Absence notice',
      tone: 'alert',
      intro: `${info.schoolName} marked ${info.studentName} absent on ${info.date}.`,
      note: 'If this is unexpected, please contact the school office.',
    });
  }

  /**
   * The red-ink remark, sent to the family the moment a teacher writes it —
   * ALWAYS, even if the child then signs it in the app (the pitch's rule: a
   * remark reaches the parent, it does not sit in a child's phone). The
   * remark is quoted so it reads as the teacher's own words rather than
   * platform copy.
   */
  async sendDiaryRemark(to: string, info: DiaryRemarkInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Diary remark for ${info.studentName} — ${info.schoolName}`, {
      title: 'Diary remark',
      tone: 'alert',
      intro: `${info.teacherName} wrote a remark in ${info.studentName}'s diary on ${info.date} (${info.className}).`,
      quote: info.remark,
      note: 'Open the school app to read it in full and sign it.',
    });
  }

  /**
   * The attendance bar's private nudge — one family, their own child, their
   * own number. Never names or counts other students (see
   * `AttendanceBarService.notifyLow`).
   */
  async sendLowAttendance(to: string, info: LowAttendanceInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `${info.studentName}'s attendance is ${info.percent}%`, {
      title: 'Attendance update',
      intro: `${info.studentName} (${info.className}) has attended ${info.percent}% of classes over ${info.period} — below ${info.schoolName}'s ${info.threshold}% benchmark.`,
      note: 'If something is making it hard to attend, please tell the class teacher — we would rather know.',
    });
  }

  async sendAnnouncement(to: string, info: AnnouncementInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, info.title, {
      title: info.title,
      preheader: info.body.slice(0, 120),
      intro: info.className ? `${info.schoolName} — ${info.className}` : info.schoolName,
      body: info.body,
    });
  }
}

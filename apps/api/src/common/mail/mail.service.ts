import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@skoolos/config';
import { captureError } from '../observability/sentry-lite';
import { MailIdentityService } from './mail-identity.service';
import { escapeHtml, renderLetter, type Letter } from './letterhead';
import type {
  AbsenceNoticePayload,
  AnnouncementPayload,
  CoverAssignedPayload,
  LeaveAppliedPayload,
  LeaveDecidedPayload,
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
    kind = 'LETTER',
  ): Promise<boolean> {
    const address = to.trim().toLowerCase();
    // An address that bounced for good, or complained, is never written to
    // again — sending anyway is what gets a domain blacklisted. The office
    // sees it in the Email card's "addresses to fix" and clears it there.
    const suppressed = await this.suppressionFor(address);
    if (suppressed) {
      await this.ledger({ schoolId, to: address, kind, provider: 'none', status: 'SUPPRESSED', error: suppressed });
      return false;
    }
    const id = await this.identity.forSchool(schoolId);
    const { html, text } = renderLetter(id.brand, letter);
    try {
      const info = await id.transporter.sendMail({
        from: id.from,
        ...(id.replyTo ? { replyTo: id.replyTo } : {}),
        to: address,
        subject,
        html,
        text,
      });
      await this.ledger({ schoolId, to: address, kind, provider: id.provider, status: 'SENT', providerId: id.provider === 'resend' ? (info?.messageId ?? null) : null });
      return true;
    } catch (e) {
      await this.ledger({ schoolId, to: address, kind, provider: id.provider, status: 'FAILED', error: (e as Error).message });
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

  /** The ledger write never throws: a bookkeeping failure must not become a mail failure. */
  private async ledger(row: { schoolId: string | null; to: string; kind: string; provider: string; status: string; providerId?: string | null; error?: string | null }): Promise<void> {
    try {
      const { getPlatformPrisma } = await import('@skoolos/db');
      await getPlatformPrisma().emailDelivery.create({
        data: { schoolId: row.schoolId, to: row.to, kind: row.kind, provider: row.provider, status: row.status, providerId: row.providerId ?? null, error: row.error?.slice(0, 500) ?? null },
      });
    } catch (e) {
      this.logger.warn(`Could not record email delivery for ${row.to}: ${(e as Error).message}`);
    }
  }

  /** The suppression reason for an address, or null. A missing table (migration not run yet) reads as "not suppressed". */
  private async suppressionFor(address: string): Promise<string | null> {
    try {
      const { getPlatformPrisma } = await import('@skoolos/db');
      const row = await getPlatformPrisma().emailSuppression.findUnique({ where: { email: address }, select: { reason: true, detail: true } });
      return row ? `${row.reason}${row.detail ? `: ${row.detail}` : ''}` : null;
    } catch {
      return null;
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
    }, 'PASSWORD_RESET');
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
    }, 'INVITE');
  }

  /**
   * The alumni door (Active Roster, Track C): sent once to every child who
   * passed out, when the school has the Homecoming wing. The claim link IS the
   * credential — single use, then a 90-day device session — so there is no
   * password in this mail and nothing to remember.
   */
  async sendAlumniWelcome(to: string, schoolName: string, claimUrl: string, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Your journey at ${schoolName} is complete`, {
      title: 'Congratulations on passing out',
      intro: `Your time at ${schoolName} is complete, and the school would like to stay in touch. This link is your alumni sign-in: it opens your alumni page and keeps you signed in on that device for 90 days.`,
      cta: { label: 'Open your alumni door', url: claimUrl },
      note: 'The link works once. If it has been used or has expired, ask the school office for a new one — there is no password to remember.',
    }, 'ALUMNI_WELCOME');
  }

  /** Passed out without the Homecoming wing: the plain letter, no door to open. */
  async sendPassedOut(to: string, schoolName: string, childName: string, sessionName: string, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `${childName} has passed out of ${schoolName}`, {
      title: 'Congratulations on passing out',
      intro: `${childName}'s journey at ${schoolName} is complete with the ${sessionName} session. The school keeps the record; the office can issue the transfer certificate and mark sheets whenever they are needed.`,
      note: 'The student login has been closed. For certificates, write to the school office.',
    }, 'PASSED_OUT');
  }

  /** Left or transferred at the year end: the record is kept, the login is closed. */
  async sendLeft(to: string, schoolName: string, childName: string, status: 'TRANSFERRED' | 'LEFT', sessionName: string, schoolId: string | null = null): Promise<boolean> {
    const what = status === 'TRANSFERRED' ? 'transferred from' : 'left';
    return this.sendLetter(to, schoolId, `${childName} has ${what} ${schoolName}`, {
      title: status === 'TRANSFERRED' ? 'Transfer recorded' : 'Leaving recorded',
      intro: `${schoolName} has recorded that ${childName} ${what} the school at the end of the ${sessionName} session.`,
      note: 'The student login has been closed. The office can issue the transfer certificate on request.',
    }, 'LEFT');
  }

  /** New session started: which class the child is in now. One per family with an address. */
  async sendSessionStarted(to: string, schoolName: string, childName: string, className: string, sessionName: string, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `${childName} is in ${className} for ${sessionName}`, {
      title: `New session ${sessionName}`,
      intro: `${schoolName} has started the ${sessionName} session. ${childName} is now in ${className}.`,
      note: 'Open the Sckools app to see the new class, timetable and diary.',
    }, 'SESSION_STARTED');
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
    }, 'TEST_SCHEDULED');
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
    }, 'TEST_REMINDER');
  }

  async sendResultsPublished(to: string, info: ResultsPublishedInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Results published: ${info.examTitle}`, {
      title: 'Results published',
      intro: `${info.schoolName} has published results for ${info.examTitle} (${info.subjectName}).`,
      note: 'Check the school portal to view them.',
    }, 'RESULTS_PUBLISHED');
  }

  async sendAbsenceNotice(to: string, info: AbsenceNoticeInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Absence notice: ${info.studentName}`, {
      title: 'Absence notice',
      tone: 'alert',
      intro: `${info.schoolName} marked ${info.studentName} absent on ${info.date}.`,
      note: 'If this is unexpected, please contact the school office.',
    }, 'ABSENCE_NOTICE');
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
    }, 'DIARY_REMARK');
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
    }, 'LOW_ATTENDANCE');
  }

  async sendLeaveApplied(to: string, p: LeaveAppliedPayload, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `Leave request: ${p.teacherName}, ${p.dates}`, {
      title: `${p.teacherName} has applied for leave`,
      intro: `${p.dates} (${p.days} day${p.days === 1 ? '' : 's'}). ${p.periodsAffected} period${p.periodsAffected === 1 ? '' : 's'} would need cover.`,
      rows: [
        { label: 'Reason', value: p.reason ?? 'No reason given' },
        { label: 'Periods to cover', value: String(p.periodsAffected) },
      ],
      note: 'Approve or reject it in the console under Requests — or from the WhatsApp message, if your number is verified.',
    }, 'LEAVE_APPLIED');
  }

  async sendLeaveDecided(to: string, p: LeaveDecidedPayload, schoolId: string | null = null): Promise<boolean> {
    const word = p.decision === 'APPROVED' ? 'approved' : 'not approved';
    return this.sendLetter(to, schoolId, `Your leave for ${p.dates} was ${word}`, {
      title: `Leave ${word}`,
      intro: `Your leave for ${p.dates} has been ${word} by ${p.byName ?? 'the office'}.`,
      rows: [{ label: 'Dates', value: p.dates }, { label: 'Decision', value: word }],
    }, 'LEAVE_DECIDED');
  }

  async sendCoverAssigned(to: string, p: CoverAssignedPayload, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, `You are covering ${p.className} on ${p.when}`, {
      title: 'A class to cover',
      intro: `You have been assigned ${p.className}${p.subjectName ? ` (${p.subjectName})` : ''} on ${p.when}, in place of ${p.originalTeacherName}.`,
      rows: [
        { label: 'When', value: p.when },
        { label: 'Class', value: `${p.className}${p.subjectName ? ` · ${p.subjectName}` : ''}` },
        { label: 'For', value: p.originalTeacherName },
      ],
    }, 'COVER_ASSIGNED');
  }

  async sendAnnouncement(to: string, info: AnnouncementInfo, schoolId: string | null = null): Promise<boolean> {
    return this.sendLetter(to, schoolId, info.title, {
      title: info.title,
      preheader: info.body.slice(0, 120),
      intro: info.className ? `${info.schoolName} — ${info.className}` : info.schoolName,
      body: info.body,
    }, 'ANNOUNCEMENT');
  }
}

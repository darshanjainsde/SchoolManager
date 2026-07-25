import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { loadEnv } from '@skoolos/config';
import type {
  AbsenceNoticePayload,
  AnnouncementPayload,
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

/**
 * Escapes a value for interpolation into an HTML email body. School-authored
 * text (exam titles, school names, student names) reaches parents' inboxes,
 * so it must never be able to inject markup.
 */
export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Thin SMTP wrapper. Hostinger (authenticated, port 465/SSL) in prod,
 * Mailhog (unauthenticated, port 1025) in local dev — env-swap only.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly env = loadEnv();
  private readonly transporter: Transporter;

  constructor() {
    this.transporter = createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_PORT === 465,
      ...(this.env.SMTP_USER
        ? { auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS } }
        : {}),
    });
  }

  /** Sends and reports success; failures are logged, never thrown to callers. */
  async send(to: string, subject: string, html: string, text: string): Promise<boolean> {
    try {
      await this.transporter.sendMail({ from: this.env.SMTP_FROM, to, subject, html, text });
      return true;
    } catch (e) {
      this.logger.error(`Mail to ${to} failed: ${(e as Error).message}`);
      return false;
    }
  }

  async sendLeadNotification(
    to: string,
    lead: { name: string | null; phone: string; school: string | null; interest: string | null; source: string },
  ): Promise<boolean> {
    const who = lead.name ?? 'Someone';
    const subject = `New Sckools lead: ${who}${lead.school ? ` — ${lead.school}` : ''}`;
    const lines = [
      `Name: ${lead.name ?? '—'}`,
      `Phone: ${lead.phone}`,
      `School: ${lead.school ?? '—'}`,
      `Interested in: ${lead.interest ?? '—'}`,
      `Source: ${lead.source}`,
    ];
    const text = `New callback request from sckools.com\n\n${lines.join('\n')}\n\nOpen the owner console to follow up.`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">📞 New callback request</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;color:#334155">
          ${lines
            .map((l) => {
              const [k, v] = l.split(/: (.*)/s);
              return `<tr><td style="padding:6px 10px 6px 0;color:#64748b;white-space:nowrap">${k}</td><td style="padding:6px 0;font-weight:bold">${v}</td></tr>`;
            })
            .join('')}
        </table>
        <p style="color:#64748b;font-size:13px;margin-top:20px">Open the owner console → Marketing leads to follow up.</p>
      </div>`;
    return this.send(to, subject, html, text);
  }

  async sendPasswordReset(to: string, schoolName: string, resetUrl: string): Promise<boolean> {
    const subject = `Reset your ${schoolName} admin password`;
    const text = `Someone requested a password reset for your ${schoolName} account.\n\nReset it here (valid 30 minutes): ${resetUrl}\n\nIf this wasn't you, ignore this email — your password is unchanged.`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Reset your password</h2>
        <p style="color:#334155;line-height:1.6">Someone requested a password reset for your <b>${schoolName}</b> account.</p>
        <p style="margin:24px 0">
          <a href="${resetUrl}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">
            Set a new password
          </a>
        </p>
        <p style="color:#64748b;font-size:13px;line-height:1.6">The link is valid for 30 minutes and can be used once.<br>
        If this wasn't you, ignore this email — your password is unchanged.</p>
      </div>`;
    return this.send(to, subject, html, text);
  }

  async sendWelcomeInvite(
    to: string,
    schoolName: string,
    loginName: string,
    setPasswordUrl: string,
  ): Promise<boolean> {
    const subject = `Welcome to ${schoolName} — set your password`;
    const text = `You now have an account at ${schoolName}.\n\nYour sign-in name is: ${loginName}\n\nSet your password here (valid 30 minutes): ${setPasswordUrl}\n\nIf you weren't expecting this, you can safely ignore this email.`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Welcome to ${escapeHtml(schoolName)}</h2>
        <p style="color:#334155;line-height:1.6">You now have an account at <b>${escapeHtml(schoolName)}</b>.</p>
        <p style="color:#334155;line-height:1.6">Your sign-in name is: <b>${escapeHtml(loginName)}</b></p>
        <p style="margin:24px 0">
          <a href="${setPasswordUrl}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:bold;display:inline-block">
            Set your password
          </a>
        </p>
        <p style="color:#64748b;font-size:13px;line-height:1.6">The link is valid for 30 minutes and can be used once.<br>
        If you weren't expecting this, you can safely ignore this email.</p>
      </div>`;
    return this.send(to, subject, html, text);
  }

  async sendTestScheduled(to: string, info: TestScheduledInfo): Promise<boolean> {
    const subject = `New test scheduled: ${info.examTitle}`;
    const text = `${info.schoolName} has scheduled a new test.\n\nSubject: ${info.subjectName}\nTest: ${info.examTitle}\nDate: ${info.scheduledAt}\n\nCheck the school portal for more details.`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">📝 New test scheduled</h2>
        <p style="color:#334155;line-height:1.6"><b>${escapeHtml(info.schoolName)}</b> has scheduled a new test.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;color:#334155">
          <tr><td style="padding:6px 10px 6px 0;color:#64748b">Subject</td><td style="padding:6px 0;font-weight:bold">${escapeHtml(info.subjectName)}</td></tr>
          <tr><td style="padding:6px 10px 6px 0;color:#64748b">Test</td><td style="padding:6px 0;font-weight:bold">${escapeHtml(info.examTitle)}</td></tr>
          <tr><td style="padding:6px 10px 6px 0;color:#64748b">Date</td><td style="padding:6px 0;font-weight:bold">${escapeHtml(info.scheduledAt)}</td></tr>
        </table>
        <p style="color:#64748b;font-size:13px;margin-top:20px">Check the school portal for more details.</p>
      </div>`;
    return this.send(to, subject, html, text);
  }

  async sendTestReminder(to: string, info: TestReminderInfo): Promise<boolean> {
    const subject = `Reminder: ${info.examTitle} in ${info.daysUntil} day${info.daysUntil === 1 ? '' : 's'}`;
    const text = `Reminder from ${info.schoolName}: "${info.examTitle}" (${info.subjectName}) is scheduled for ${info.scheduledAt} — that's ${info.daysUntil} day${info.daysUntil === 1 ? '' : 's'} away.`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">⏰ Upcoming test reminder</h2>
        <p style="color:#334155;line-height:1.6"><b>${escapeHtml(info.schoolName)}</b>: <b>${escapeHtml(info.examTitle)}</b> (${escapeHtml(info.subjectName)}) is coming up on ${escapeHtml(info.scheduledAt)} — ${escapeHtml(info.daysUntil)} day${info.daysUntil === 1 ? '' : 's'} from now.</p>
      </div>`;
    return this.send(to, subject, html, text);
  }

  async sendResultsPublished(to: string, info: ResultsPublishedInfo): Promise<boolean> {
    const subject = `Results published: ${info.examTitle}`;
    const text = `${info.schoolName} has published results for "${info.examTitle}" (${info.subjectName}). Check the school portal to view them.`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">✅ Results published</h2>
        <p style="color:#334155;line-height:1.6"><b>${escapeHtml(info.schoolName)}</b> has published results for <b>${escapeHtml(info.examTitle)}</b> (${escapeHtml(info.subjectName)}).</p>
        <p style="color:#64748b;font-size:13px;margin-top:20px">Check the school portal to view them.</p>
      </div>`;
    return this.send(to, subject, html, text);
  }

  async sendAbsenceNotice(to: string, info: AbsenceNoticeInfo): Promise<boolean> {
    const subject = `Absence notice: ${info.studentName}`;
    const text = `${info.schoolName} marked ${info.studentName} absent on ${info.date}. If this is unexpected, please contact the school office.`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">Absence notice</h2>
        <p style="color:#334155;line-height:1.6"><b>${escapeHtml(info.schoolName)}</b> marked <b>${escapeHtml(info.studentName)}</b> absent on ${escapeHtml(info.date)}.</p>
        <p style="color:#64748b;font-size:13px;margin-top:20px">If this is unexpected, please contact the school office.</p>
      </div>`;
    return this.send(to, subject, html, text);
  }

  async sendAnnouncement(to: string, info: AnnouncementInfo): Promise<boolean> {
    const subject = info.title;
    const target = info.className ? ` (${info.className})` : '';
    const text = `${info.schoolName}${target} posted a new announcement.\n\n${info.title}\n\n${info.body}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#134e4a;margin:0 0 12px">📣 ${escapeHtml(info.schoolName)}${target ? ` — ${escapeHtml(info.className as string)}` : ''}</h2>
        <p style="color:#334155;font-weight:bold;margin:0 0 8px">${escapeHtml(info.title)}</p>
        <p style="color:#334155;line-height:1.6;white-space:pre-wrap">${escapeHtml(info.body)}</p>
      </div>`;
    return this.send(to, subject, html, text);
  }
}

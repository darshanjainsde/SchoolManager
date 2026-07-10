import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { loadEnv } from '@skoolos/config';

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
}

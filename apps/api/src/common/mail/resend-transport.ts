/**
 * Resend over HTTPS, shaped like the one method of nodemailer's Transporter
 * that MailService uses — so `MailIdentity.transporter` can be either without
 * the composers knowing. Why not Resend's SMTP relay: the HTTP API returns
 * the message id that the webhook later reports delivered / bounced against,
 * and that id is the whole point of the ledger.
 */
export interface MailAddress {
  name: string;
  address: string;
}

export interface SendMailOptions {
  from: MailAddress | string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface SentMailInfo {
  messageId?: string;
}

export interface MailTransport {
  sendMail(opts: SendMailOptions): Promise<SentMailInfo>;
}

export class ResendApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly name_: string | null,
  ) {
    super(message);
    this.name = 'ResendApiError';
  }
}

const formatFrom = (from: MailAddress | string): string =>
  typeof from === 'string' ? from : from.name ? `${from.name.replace(/"/g, "'")} <${from.address}>` : from.address;

export class ResendTransport implements MailTransport {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendMail(opts: SendMailOptions): Promise<SentMailInfo> {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: formatFrom(opts.from),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !json.id) throw new ResendApiError(json.message || `Resend ${res.status}`, res.status, json.name ?? null);
    return { messageId: json.id };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@skoolos/config';
import { WhatsAppChannel } from '../notifications/whatsapp.channel';
import { sendTemplate } from '../notifications/whatsapp/graph.client';
import { VERIFY_CODE, verifyCodeTemplate } from '../notifications/whatsapp/templates';

/**
 * WHERE A ONE-TIME CODE GOES. One code, every enabled sender, in parallel:
 * WhatsApp today, SMS the day the DLT template is approved (set the two
 * MSG91 keys and it switches itself on). Nothing above this file knows how
 * many senders there are — the login, the reset and the verify flows all
 * call `OtpSenders.fanOut` and read back which channels carried the code.
 */
export type OtpPurpose = 'LOGIN' | 'RESET' | 'VERIFY_PHONE';

export interface OtpSendContext {
  /** The school the ledger row is filed under — the profile's, or the login's. */
  schoolId: string;
  purpose: OtpPurpose;
}

export interface OtpSendResult {
  ok: boolean;
  /** Provider code when the provider gave one (Meta 131026 = not on WhatsApp). */
  code: number | null;
  reason?: string;
}

export interface OtpSender {
  readonly name: 'whatsapp' | 'sms';
  enabled(): boolean;
  send(phoneE164: string, code: string, ctx: OtpSendContext): Promise<OtpSendResult>;
}

@Injectable()
export class WhatsAppOtpSender implements OtpSender {
  readonly name = 'whatsapp' as const;
  constructor(private readonly channel: WhatsAppChannel) {}
  enabled(): boolean {
    return this.channel.configured;
  }
  async send(phone: string, code: string, ctx: OtpSendContext): Promise<OtpSendResult> {
    // The AUTHENTICATION template: Meta writes the body, we supply the code
    // and the copy-code button. Bypasses nothing — the per-school switch is
    // about notices, and deliverWith does not consult it; a code is identity.
    const r = await this.channel.deliverWith(ctx.schoolId, phone, `OTP_${ctx.purpose}`, VERIFY_CODE, (cfg, pnid, f) =>
      sendTemplate(cfg, phone, verifyCodeTemplate(code), { phoneNumberId: pnid, fetchImpl: f }),
    );
    return {
      ok: r.ok,
      code: r.code,
      reason: r.ok
        ? undefined
        : r.code === 131026
          ? 'not on WhatsApp'
          : r.code === 131030
            ? 'not on the Meta test list'
            // 132001 = the template does not exist on this business account.
            // For the code template that is not a transient failure: Meta gates
            // the AUTHENTICATION category per account, and ours is not enabled
            // (both the API and WhatsApp Manager refuse to create it). Naming
            // it separately keeps a permanent block out of the "try again in a
            // minute" bucket, where it would have people retrying forever.
            : r.code === 132001
              ? 'the code template is not approved on this WhatsApp account'
              : 'WhatsApp did not deliver',
    };
  }
}

/**
 * MSG91's OTP endpoint. The DLT-registered template carries one `##OTP##`
 * variable; MSG91 fills it and sends on the registered header. Disabled until
 * both keys exist, so the fan-out simply skips it today.
 */
@Injectable()
export class SmsOtpSender implements OtpSender {
  readonly name = 'sms' as const;
  private readonly logger = new Logger(SmsOtpSender.name);
  private readonly env = loadEnv();
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  enabled(): boolean {
    return !!(this.env.MSG91_AUTH_KEY && this.env.MSG91_OTP_TEMPLATE_ID);
  }
  async send(phone: string, code: string): Promise<OtpSendResult> {
    if (!this.enabled()) return { ok: false, code: null, reason: 'SMS not enabled' };
    try {
      const url = new URL('https://control.msg91.com/api/v5/otp');
      url.searchParams.set('template_id', this.env.MSG91_OTP_TEMPLATE_ID!);
      url.searchParams.set('mobile', phone.replace(/^\+/, ''));
      url.searchParams.set('otp', code);
      const res = await this.fetchImpl(url, { method: 'POST', headers: { authkey: this.env.MSG91_AUTH_KEY!, 'Content-Type': 'application/json' }, body: '{}' });
      const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
      if (res.ok && body.type === 'success') return { ok: true, code: null };
      this.logger.warn(`SMS OTP to ${phone} failed: ${res.status} ${body.message ?? ''}`);
      return { ok: false, code: res.status, reason: body.message ?? `SMS failed (${res.status})` };
    } catch (e) {
      this.logger.warn(`SMS OTP to ${phone} threw: ${(e as Error).message}`);
      return { ok: false, code: null, reason: 'SMS did not deliver' };
    }
  }
}

export interface FanOutResult {
  /** Names of the senders that delivered, in the order they finished. */
  sentVia: string[];
  /** Every enabled sender that did not deliver, with its reason. */
  failures: { name: string; code: number | null; reason: string }[];
  /** True when no sender was even enabled — the platform is not set up. */
  nothingEnabled: boolean;
}

@Injectable()
export class OtpSenders {
  private readonly senders: OtpSender[];
  constructor(whatsapp: WhatsAppOtpSender, sms: SmsOtpSender) {
    this.senders = [whatsapp, sms];
  }

  enabledNames(): string[] {
    return this.senders.filter((s) => s.enabled()).map((s) => s.name);
  }

  async fanOut(phone: string, code: string, ctx: OtpSendContext): Promise<FanOutResult> {
    const live = this.senders.filter((s) => s.enabled());
    if (live.length === 0) return { sentVia: [], failures: [], nothingEnabled: true };
    const results = await Promise.all(live.map(async (s) => ({ name: s.name, r: await s.send(phone, code, ctx) })));
    return {
      sentVia: results.filter((x) => x.r.ok).map((x) => x.name),
      failures: results.filter((x) => !x.r.ok).map((x) => ({ name: x.name, code: x.r.code, reason: x.r.reason ?? 'did not deliver' })),
      nothingEnabled: false,
    };
  }
}

import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ResendTransport, type MailTransport } from './resend-transport';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { decryptSecret } from './secret-box';
import { platformBrand, safeHex, type EmailBrand, type EmailTemplate } from './letterhead';

/**
 * Who an email is FROM, and what letterhead it wears.
 *
 * Both answers come from the same place because they are the same decision:
 * a school that sends from its own mailbox should not carry a "sent by
 * Sckools" footer, and a school that has configured nothing should still have
 * its own name on the envelope. One resolver, one source of truth.
 *
 * Reads go through the BYPASSRLS platform client on purpose: notifications are
 * dispatched post-commit, outside any tenant transaction, so a tenant-scoped
 * read here would find nothing and every school would silently lose its
 * branding. The schoolId is always supplied by the caller (never derived from
 * user input), so this cannot become a cross-tenant read.
 */

export interface MailIdentity {
  brand: EmailBrand;
  /** Passed to nodemailer as-is; the object form encodes the name safely. */
  from: { name: string; address: string };
  replyTo?: string;
  /** The school's own SMTP when verified, otherwise the platform's (Resend, or SMTP). */
  transporter: MailTransport;
  /** Which pipe this identity sends through — recorded on every ledger row. */
  provider: 'resend' | 'smtp' | 'school-smtp';
  usingCustomSender: boolean;
  schoolId: string | null;
}

/** How long a resolved identity is reused. A 300-family announcement fans out
 *  in one burst — without this it would be 300 identical database round-trips. */
const CACHE_TTL_MS = 60_000;

/** How long one instance trusts its copy of a school's email switch. Same as WhatsApp's. */
export const EMAIL_SWITCH_TTL_MS = 10_000;

interface CacheEntry {
  value: MailIdentity;
  expires: number;
}

@Injectable()
export class MailIdentityService {
  private readonly logger = new Logger(MailIdentityService.name);
  private readonly env = loadEnv();
  private readonly cache = new Map<string, CacheEntry>();
  /** One transporter per school sender, keyed by its connection signature. */
  private readonly schoolTransports = new Map<string, Transporter>();
  private platformTransport: MailTransport | null = null;

  /** Resend when the key is set, else SMTP — decided once, read by every identity. */
  platformProvider(): 'resend' | 'smtp' {
    return this.env.RESEND_API_KEY ? 'resend' : 'smtp';
  }

  /** The platform mailbox — the fallback every school starts on. */
  private platform(): MailTransport {
    if (!this.platformTransport) {
      if (this.env.RESEND_API_KEY) {
        this.platformTransport = new ResendTransport(this.env.RESEND_API_KEY);
        return this.platformTransport;
      }
      this.platformTransport = createTransport({
        host: this.env.SMTP_HOST,
        port: this.env.SMTP_PORT,
        secure: this.env.SMTP_PORT === 465,
        ...(this.env.SMTP_USER ? { auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS } } : {}),
      });
    }
    return this.platformTransport;
  }

  /** `"Sckools" <no-reply@…>` parsed out of SMTP_FROM, which may be either form. */
  private platformFrom(displayName?: string): { name: string; address: string } {
    const raw = this.env.SMTP_FROM;
    const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(raw);
    const address = (m ? m[2] : raw).trim();
    const fallbackName = (m?.[1] ?? '').trim() || 'Sckools';
    return { name: displayName?.trim() || fallbackName, address };
  }

  /** Identity for mail that belongs to no school (owner alerts, marketing). */
  platformIdentity(): MailIdentity {
    return {
      brand: platformBrand(),
      from: this.platformFrom(),
      transporter: this.platform(),
      provider: this.platformProvider(),
      usingCustomSender: false,
      schoolId: null,
    };
  }

  invalidate(schoolId: string): void {
    this.cache.delete(schoolId);
    this.switches.delete(schoolId);
  }

  /** The school's email master switch, per instance, for EMAIL_SWITCH_TTL_MS. */
  private readonly switches = new Map<string, { on: boolean; expires: number }>();

  /**
   * Is this school's email switched on? Read on its own short clock, not the
   * identity's minute: the API is stateless across many instances, and an
   * office that switches email OFF must see the mail stop on every one of them
   * within seconds — not after another minute of bounces. A row that does not
   * exist is ON (the default every school starts with). A failed read is ON
   * too: email went out before this switch existed, and a database blip must
   * not silently stop a real school's absence notices.
   */
  async emailOn(schoolId: string): Promise<boolean> {
    const hit = this.switches.get(schoolId);
    if (hit && hit.expires > Date.now()) return hit.on;
    let on = true;
    try {
      const row = await getPlatformPrisma().emailSettings.findUnique({ where: { schoolId }, select: { enabled: true } });
      on = row?.enabled ?? true;
    } catch (e) {
      this.logger.warn(`Email switch for school ${schoolId} could not be read: ${(e as Error).message}`);
    }
    this.switches.set(schoolId, { on, expires: Date.now() + EMAIL_SWITCH_TTL_MS });
    return on;
  }

  async forSchool(schoolId: string | null | undefined): Promise<MailIdentity> {
    if (!schoolId) return this.platformIdentity();

    const hit = this.cache.get(schoolId);
    if (hit && hit.expires > Date.now()) return hit.value;

    let value: MailIdentity;
    try {
      value = await this.load(schoolId);
    } catch (e) {
      // Branding is a nicety; delivery is not. Any failure resolving a
      // school's identity falls back to a working platform sender rather than
      // dropping the email.
      this.logger.warn(`Mail identity for school ${schoolId} failed to resolve: ${(e as Error).message}`);
      value = this.platformIdentity();
    }
    this.cache.set(schoolId, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  private async load(schoolId: string): Promise<MailIdentity> {
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: {
        name: true,
        slug: true,
        emailSettings: true,
        profile: { select: { logoAssetId: true, brandColorPrimary: true } },
        domains: {
          where: { isPrimary: true, status: 'LIVE' },
          select: { hostname: true },
          take: 1,
        },
      },
    });
    if (!school) return this.platformIdentity();

    const s = school.emailSettings;
    const host = school.domains[0]?.hostname ?? `${school.slug}.${this.env.PLATFORM_HOST}`;

    // The crest: an explicit email logo wins, else the website's logo.
    const logoAssetId = s?.logoAssetId ?? school.profile?.logoAssetId ?? null;
    let logoUrl: string | null = null;
    if (logoAssetId) {
      const asset = await db.mediaAsset.findFirst({ where: { id: logoAssetId }, select: { url: true } });
      logoUrl = asset?.url ?? null;
    }

    const sender = this.resolveSender(s, school.name);

    const brand: EmailBrand = {
      schoolName: school.name,
      logoUrl,
      accent: safeHex(s?.accentColor ?? school.profile?.brandColorPrimary),
      template: (s?.template as EmailTemplate) ?? 'CLASSIC',
      footerLines: s?.footerLines ?? [],
      siteHost: host,
      // The credit line is the honest marker of WHOSE mailbox carried this:
      // it appears exactly while the platform is sending on the school's behalf.
      showPlatformCredit: !sender.usingCustomSender,
    };

    return { brand, ...sender, schoolId };
  }

  /**
   * The fallback rule, in one place: a school's own sender is used only when it
   * is switched on, verified by a real test send, and its credential still
   * decrypts. Anything else falls through to the platform mailbox wearing the
   * school's name — mail never stops because a sender went bad.
   */
  private resolveSender(
    s: {
      senderMode: string;
      senderStatus: string;
      fromAddress: string | null;
      smtpHost: string | null;
      smtpPort: number | null;
      smtpUser: string | null;
      smtpPassEnc: string | null;
      senderName: string | null;
      replyTo: string | null;
    } | null
      | undefined,
    schoolName: string,
  ): Pick<MailIdentity, 'from' | 'replyTo' | 'transporter' | 'provider' | 'usingCustomSender'> {
    const displayName = s?.senderName?.trim() || schoolName;
    const replyTo = s?.replyTo?.trim() || undefined;

    const wantsCustom =
      s?.senderMode === 'CUSTOM' &&
      s?.senderStatus === 'VERIFIED' &&
      !!s.fromAddress &&
      !!s.smtpHost &&
      !!s.smtpPort;

    if (wantsCustom) {
      const pass = decryptSecret(s!.smtpPassEnc);
      if (pass !== null || !s!.smtpUser) {
        const transporter = this.schoolTransport(s!.smtpHost!, s!.smtpPort!, s!.smtpUser, pass);
        return {
          from: { name: displayName, address: s!.fromAddress! },
          replyTo,
          transporter,
          provider: 'school-smtp',
          usingCustomSender: true,
        };
      }
      this.logger.warn('Custom sender credential could not be decrypted — falling back to the platform sender');
    }

    return {
      from: this.platformFrom(displayName),
      replyTo,
      transporter: this.platform(),
      provider: this.platformProvider(),
      usingCustomSender: false,
    };
  }

  private schoolTransport(host: string, port: number, user: string | null, pass: string | null): Transporter {
    // The PASSWORD is part of the signature (hashed — never kept as a key in
    // the clear). Keyed on host:port:user alone, a school that fixed a wrong
    // password kept failing on every warm instance until it was recycled:
    // the old transporter, with the old password, was found and reused.
    const mailbox = `${host}:${port}:${user ?? ''}`;
    const cacheKey = `${mailbox}:${pass ? createHash('sha256').update(pass).digest('hex').slice(0, 16) : ''}`;
    const existing = this.schoolTransports.get(cacheKey);
    if (existing) return existing;
    // A changed password replaces the old connection for that mailbox, so the
    // map holds one per mailbox rather than one per password ever tried.
    for (const [k, t] of this.schoolTransports) {
      if (k.startsWith(`${mailbox}:`)) {
        t.close();
        this.schoolTransports.delete(k);
      }
    }
    const t = createTransport({
      host,
      port,
      secure: port === 465,
      // On 587 the session starts in the clear and upgrades. Without this a
      // server that fails to offer STARTTLS would get the school's mailbox
      // password in plaintext; requireTLS aborts instead.
      ...(port === 465 ? {} : { requireTLS: true }),
      ...(user && pass ? { auth: { user, pass } } : {}),
      // A school's mailbox is a third party we do not control. Without these a
      // hung connection would keep a serverless invocation alive to its own
      // timeout, turning one bad mailbox into a stalled request.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    this.schoolTransports.set(cacheKey, t);
    return t;
  }

  /**
   * Opens a connection with candidate settings and sends one real message.
   * Used by the admin's "verify" step: a sender is only ever marked VERIFIED
   * because mail actually left, never because a form validated.
   */
  async trySend(
    config: { host: string; port: number; user?: string; pass?: string; fromAddress: string; fromName: string },
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      ...(config.port === 465 ? {} : { requireTLS: true }),
      ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    try {
      await transporter.sendMail({
        from: { name: config.fromName, address: config.fromAddress },
        to,
        subject,
        html,
        text,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    } finally {
      transporter.close();
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
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
  /** The school's own SMTP when verified, otherwise the platform's. */
  transporter: Transporter;
  usingCustomSender: boolean;
  schoolId: string | null;
}

/** How long a resolved identity is reused. A 300-family announcement fans out
 *  in one burst — without this it would be 300 identical database round-trips. */
const CACHE_TTL_MS = 60_000;

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
  private platformTransport: Transporter | null = null;

  /** The platform mailbox — the fallback every school starts on. */
  private platform(): Transporter {
    if (!this.platformTransport) {
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
      usingCustomSender: false,
      schoolId: null,
    };
  }

  invalidate(schoolId: string): void {
    this.cache.delete(schoolId);
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
  ): Pick<MailIdentity, 'from' | 'replyTo' | 'transporter' | 'usingCustomSender'> {
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
          usingCustomSender: true,
        };
      }
      this.logger.warn('Custom sender credential could not be decrypted — falling back to the platform sender');
    }

    return {
      from: this.platformFrom(displayName),
      replyTo,
      transporter: this.platform(),
      usingCustomSender: false,
    };
  }

  private schoolTransport(host: string, port: number, user: string | null, pass: string | null): Transporter {
    const cacheKey = `${host}:${port}:${user ?? ''}`;
    const existing = this.schoolTransports.get(cacheKey);
    if (existing) return existing;
    const t = createTransport({
      host,
      port,
      secure: port === 465,
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

import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { MailIdentityService } from '../../common/mail/mail-identity.service';
import { MailService } from '../../common/mail/mail.service';
import { encryptSecret, secretBoxAvailable } from '../../common/mail/secret-box';
import { renderLetter, safeHex, EMAIL_TEMPLATES, type EmailBrand, type EmailTemplate, type Letter } from '../../common/mail/letterhead';
import type { UpdateEmailSettingsDto, UpdateEmailSenderDto, VerifyEmailSenderDto } from './management.dto';

/**
 * The school's letterhead and (optionally) its own sender.
 *
 * Two rules shape everything here:
 *
 *  1. A school that configures NOTHING must still send beautiful, branded
 *     mail. So this service never requires a row to exist — reads resolve
 *     through `MailIdentityService`, which falls back to the website's name,
 *     logo and colour.
 *  2. A sender is VERIFIED only because a real message left the building.
 *     There is no path that marks a sender good from form validation alone,
 *     because the failure that matters (wrong password, blocked port, relay
 *     refused) is invisible until you actually send.
 */
@Injectable()
export class EmailSettingsService {
  private readonly logger = new Logger(EmailSettingsService.name);

  constructor(
    private readonly identity: MailIdentityService,
    private readonly mail: MailService,
  ) {}

  /** A sample of each message kind, so the preview shows real shapes. */
  private sampleLetter(schoolName: string): Letter {
    return {
      title: `Welcome to ${schoolName}`,
      intro: 'Your account is ready. Set a password to sign in.',
      rows: [{ label: 'Sign-in name', value: 'RAF-00301' }],
      cta: { label: 'Set your password', url: 'https://example.com/reset-password?token=sample' },
      note: 'The link is valid for 30 minutes and can be used once.',
    };
  }

  /**
   * Everything the settings screen needs: the stored overrides, the values
   * actually in force right now, and a rendered preview of each letterhead.
   * The SMTP password is never part of this response — only whether one is set.
   */
  async get(schoolId: string) {
    const row = await getPlatformPrisma().emailSettings.findUnique({ where: { schoolId } });
    const identity = await this.identity.forSchool(schoolId);
    const brand = identity.brand;

    const previews = EMAIL_TEMPLATES.map((template) => ({
      template,
      html: renderLetter({ ...brand, template }, this.sampleLetter(brand.schoolName)).html,
    }));

    return {
      // What the school has deliberately overridden (null = "use the default").
      settings: {
        template: (row?.template as EmailTemplate) ?? 'CLASSIC',
        senderName: row?.senderName ?? null,
        replyTo: row?.replyTo ?? null,
        accentColor: row?.accentColor ?? null,
        logoAssetId: row?.logoAssetId ?? null,
        footerLines: row?.footerLines ?? [],
      },
      // What is actually in force, defaults resolved — this is what the admin
      // sees described on screen so the fallback is never a mystery.
      effective: {
        schoolName: brand.schoolName,
        senderName: identity.from.name,
        fromAddress: identity.from.address,
        replyTo: identity.replyTo ?? null,
        accent: brand.accent,
        logoUrl: brand.logoUrl,
        template: brand.template,
        footerLines: brand.footerLines,
        usingCustomSender: identity.usingCustomSender,
        showPlatformCredit: brand.showPlatformCredit,
      },
      sender: {
        mode: row?.senderMode ?? 'DEFAULT',
        status: row?.senderStatus ?? 'UNVERIFIED',
        fromAddress: row?.fromAddress ?? null,
        smtpHost: row?.smtpHost ?? null,
        smtpPort: row?.smtpPort ?? null,
        smtpUser: row?.smtpUser ?? null,
        hasPassword: !!row?.smtpPassEnc,
        verifiedAt: row?.verifiedAt?.toISOString() ?? null,
        lastError: row?.lastError ?? null,
        lastErrorAt: row?.lastErrorAt?.toISOString() ?? null,
        // Told plainly, because a school cannot fix what it cannot see.
        canConfigure: secretBoxAvailable(),
      },
      previews,
    };
  }

  /** Letterhead only — never touches the sender. */
  async update(schoolId: string, dto: UpdateEmailSettingsDto) {
    if (dto.logoAssetId) {
      // The crest must be one of THIS school's own assets; an id from another
      // tenant would leak an image path across schools.
      const owned = await withTenant(schoolId, (tx) =>
        tx.mediaAsset.findFirst({ where: { schoolId, id: dto.logoAssetId }, select: { id: true } }),
      );
      if (!owned) throw new ApiError('VALIDATION', 'That logo does not belong to this school.', 400, 'logoAssetId');
    }
    const data = {
      ...(dto.template !== undefined ? { template: dto.template } : {}),
      ...(dto.senderName !== undefined ? { senderName: dto.senderName || null } : {}),
      ...(dto.replyTo !== undefined ? { replyTo: dto.replyTo || null } : {}),
      ...(dto.accentColor !== undefined ? { accentColor: dto.accentColor ? safeHex(dto.accentColor) : null } : {}),
      ...(dto.logoAssetId !== undefined ? { logoAssetId: dto.logoAssetId || null } : {}),
      ...(dto.footerLines !== undefined ? { footerLines: dto.footerLines } : {}),
    };
    await getPlatformPrisma().emailSettings.upsert({
      where: { schoolId },
      create: { schoolId, ...data },
      update: data,
    });
    this.identity.invalidate(schoolId);
    return this.get(schoolId);
  }

  /**
   * Stores candidate sender credentials. Deliberately does NOT switch the
   * school over: the row lands UNVERIFIED and mail keeps going out through the
   * platform until a test send proves the settings work.
   */
  async updateSender(schoolId: string, dto: UpdateEmailSenderDto) {
    if (!secretBoxAvailable()) {
      throw new ApiError(
        'EMAIL_SECRET_MISSING',
        'This deployment cannot store mail passwords yet (EMAIL_SECRET_KEY is not set), so a custom sender cannot be saved. Mail continues to send from Sckools with your school branding.',
        503,
      );
    }
    const data = {
      senderMode: 'DEFAULT' as const, // stays on the fallback until verified
      senderStatus: 'UNVERIFIED' as const,
      fromAddress: dto.fromAddress,
      smtpHost: dto.smtpHost,
      smtpPort: dto.smtpPort,
      smtpUser: dto.smtpUser ?? null,
      ...(dto.smtpPass ? { smtpPassEnc: encryptSecret(dto.smtpPass) } : {}),
      lastError: null,
      lastErrorAt: null,
      verifiedAt: null,
    };
    await getPlatformPrisma().emailSettings.upsert({
      where: { schoolId },
      create: { schoolId, ...data },
      update: data,
    });
    this.identity.invalidate(schoolId);
    return this.get(schoolId);
  }

  /**
   * Sends one real message with the stored credentials. Only a success flips
   * the school onto its own sender.
   */
  async verifySender(schoolId: string, dto: VerifyEmailSenderDto) {
    const db = getPlatformPrisma();
    const row = await db.emailSettings.findUnique({ where: { schoolId } });
    if (!row?.smtpHost || !row.smtpPort || !row.fromAddress) {
      throw new ApiError('VALIDATION', 'Save the sender settings before verifying them.', 400);
    }
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { name: true } });
    const brand = (await this.identity.forSchool(schoolId)).brand;
    const fromName = row.senderName || school?.name || 'School';

    const { decryptSecret } = await import('../../common/mail/secret-box');
    const pass = decryptSecret(row.smtpPassEnc);
    const letter: Letter = {
      title: 'Your school sender works',
      intro: `This message was sent from ${row.fromAddress} using your own mail settings. From now on every email your school sends can come from this address.`,
      note: 'If you did not expect this, someone in your school console is testing the email setup.',
    };
    const { html, text } = renderLetter({ ...brand, showPlatformCredit: false }, letter);

    const result = await this.identity.trySend(
      {
        host: row.smtpHost,
        port: row.smtpPort,
        user: row.smtpUser ?? undefined,
        pass: pass ?? undefined,
        fromAddress: row.fromAddress,
        fromName,
      },
      dto.to,
      `${fromName} — mail settings verified`,
      html,
      text,
    );

    if (!result.ok) {
      await db.emailSettings.update({
        where: { schoolId },
        data: {
          senderMode: 'DEFAULT',
          senderStatus: 'UNVERIFIED',
          lastError: result.error.slice(0, 500),
          lastErrorAt: new Date(),
        },
      });
      this.identity.invalidate(schoolId);
      // 200 with ok:false, not a 4xx: a failed test is a NORMAL outcome of
      // this screen (wrong password on the first try), and the admin needs
      // the provider's own message to fix it.
      return { ok: false as const, error: result.error, ...(await this.get(schoolId)) };
    }

    await db.emailSettings.update({
      where: { schoolId },
      data: {
        senderMode: 'CUSTOM',
        senderStatus: 'VERIFIED',
        verifiedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
    });
    this.identity.invalidate(schoolId);
    return { ok: true as const, ...(await this.get(schoolId)) };
  }

  /** Back to the platform mailbox. Credentials are wiped, not just ignored. */
  async disableSender(schoolId: string) {
    await getPlatformPrisma().emailSettings.upsert({
      where: { schoolId },
      create: { schoolId, senderMode: 'DEFAULT', senderStatus: 'UNVERIFIED' },
      update: {
        senderMode: 'DEFAULT',
        senderStatus: 'UNVERIFIED',
        fromAddress: null,
        smtpHost: null,
        smtpPort: null,
        smtpUser: null,
        smtpPassEnc: null,
        verifiedAt: null,
        lastError: null,
        lastErrorAt: null,
      },
    });
    this.identity.invalidate(schoolId);
    return this.get(schoolId);
  }

  /**
   * Sends a sample through whatever is in force right now — the honesty check.
   * The admin sees exactly what a parent will see, including which sender it
   * came from.
   */
  async sendTest(schoolId: string, to: string) {
    const identity = await this.identity.forSchool(schoolId);
    const sent = await this.mail.sendLetter(
      to,
      schoolId,
      `${identity.brand.schoolName} — sample email`,
      {
        title: 'This is how your emails look',
        intro: `Every message ${identity.brand.schoolName} sends — invites, announcements, results, absence notices — is wrapped in this letterhead.`,
        rows: [
          { label: 'Sent from', value: identity.from.address },
          { label: 'Letterhead', value: identity.brand.template },
        ],
        cta: { label: 'A button looks like this', url: 'https://sckools.com' },
        note: 'Sent from your school console to check the email setup.',
      },
    );
    return { sent, from: identity.from.address, usingCustomSender: identity.usingCustomSender };
  }

  /** Preview a template the admin has not saved yet. */
  async preview(schoolId: string, template: EmailTemplate, accentColor?: string) {
    const brand: EmailBrand = { ...(await this.identity.forSchool(schoolId)).brand, template };
    if (accentColor) brand.accent = safeHex(accentColor);
    return { html: renderLetter(brand, this.sampleLetter(brand.schoolName)).html };
  }
}

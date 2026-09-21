import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@skoolos/db';
import type { NotificationChannel, NotificationMessage } from './notification.types';
import { toE164 } from './whatsapp/phone';
import { sendTemplate, whatsAppConfig, WhatsAppApiError, type SendResult, type WhatsAppConfig } from './whatsapp/graph.client';
import { templateFor, type WhatsAppTemplate } from './whatsapp/templates';

/**
 * WhatsApp as a `NotificationChannel` — the slot notification.module.ts
 * left open. Addressed like every other channel, by the recipient's login
 * email within a school; this channel turns that into a phone (the child's
 * guardian phone, a teacher's or staff member's own) and a Meta template.
 *
 * MULTI-TENANT BY CONSTRUCTION:
 *  - nothing sends unless THAT school has switched WhatsApp on
 *    (`WhatsAppSettings.enabled`) — the platform being configured is
 *    necessary, never sufficient;
 *  - a school's own sender (`phoneNumberId`) wins over the platform's;
 *  - every message names the school in its first parameter, so a family
 *    with children at two Sckools schools always knows who is speaking;
 *  - every ledger row carries the school, so cost and quota are per school;
 *  - every query here carries an explicit `schoolId`: this runs on the
 *    platform (BYPASSRLS) client like PushChannel, for the same reason —
 *    the outbox drain is cross-tenant and `withTenant` is unavailable.
 *
 * Never throws for a delivery failure: resolves `false` and records a
 * FAILED ledger row with Meta's reason, so "this number is not on WhatsApp"
 * becomes a fact the office can act on rather than a swallowed log line.
 */
type Db = Pick<PrismaClient, 'user' | 'student' | 'teacher' | 'staff' | 'whatsAppSettings' | 'whatsAppDelivery'>;

interface SchoolSettings {
  enabled: boolean;
  phoneNumberId: string | null;
}

const SETTINGS_TTL_MS = 60_000;

export class WhatsAppChannel implements NotificationChannel {
  readonly name = 'whatsapp';
  private readonly logger = new Logger(WhatsAppChannel.name);
  private readonly settingsCache = new Map<string, { at: number; value: SchoolSettings }>();
  private warnedUnconfigured = false;
  private warnedNoTable = false;

  constructor(
    private readonly prisma: Db,
    private readonly config: () => WhatsAppConfig | null = () => whatsAppConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The platform credentials, or null when the environment has none. */
  get configured(): boolean {
    return this.config() !== null;
  }

  /**
   * The same words to the same phone within a minute are one message. A
   * family with three children at the school gets ONE "PTM on Saturday",
   * not three; the per-child kinds (absence, remark) differ in their
   * parameters and pass. Keyed on phone + template + parameters; the map is
   * pruned when it grows, so a fan-out of thousands stays bounded.
   */
  private readonly recent = new Map<string, number>();
  private static readonly DEDUPE_MS = 60_000;
  private isDuplicate(phone: string, template: WhatsAppTemplate): boolean {
    const key = `${phone}|${template.name}|${template.params.join('\u0001')}`;
    const now = Date.now();
    const seen = this.recent.get(key);
    if (seen && now - seen < WhatsAppChannel.DEDUPE_MS) return true;
    if (this.recent.size > 5000) for (const [k, t] of this.recent) if (now - t > WhatsAppChannel.DEDUPE_MS) this.recent.delete(k);
    this.recent.set(key, now);
    return false;
  }

  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    const cfg = this.config();
    if (!cfg) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        this.logger.warn('WhatsApp is not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID); channel is idle.');
      }
      return false;
    }
    const settings = await this.settingsFor(schoolId);
    if (!settings.enabled) return false;

    const address = await this.addressFor(schoolId, to);
    if (!address) return false;
    const { phone } = address;

    const template = templateFor(message, { child: address.child });
    if (this.isDuplicate(phone, template)) return true;
    return this.deliver(cfg, schoolId, phone, message.kind, template, settings.phoneNumberId);
  }

  /** The platform credentials for callers that compose their own sends (actions, verification). */
  configOrNull(): WhatsAppConfig | null {
    return this.config();
  }

  /**
   * A send composed by the caller (free text, an interactive list, a template
   * outside the notification kinds), still written to the ledger under the
   * school. Resolves false and records the reason on refusal, like send().
   */
  async deliverWith(schoolId: string, phone: string, kind: string, label: string, fn: (cfg: WhatsAppConfig, phoneNumberId: string | null, fetchImpl: typeof fetch) => Promise<SendResult>): Promise<{ ok: boolean; code: number | null }> {
    const cfg = this.config();
    if (!cfg) return { ok: false, code: null };
    const settings = await this.settingsFor(schoolId);
    try {
      const { messageId } = await fn(cfg, settings.phoneNumberId, this.fetchImpl);
      await this.prisma.whatsAppDelivery.create({ data: { schoolId, phone, kind, templateName: label, waMessageId: messageId, status: 'SENT', sentAt: new Date() } });
      return { ok: true, code: null };
    } catch (e) {
      const code = e instanceof WhatsAppApiError ? e.code : null;
      const reason = e instanceof WhatsAppApiError ? `${e.message} (code ${e.code ?? '?'})` : (e as Error).message;
      this.logger.warn(`WhatsApp ${label} to ${phone} failed: ${reason}`);
      try {
        await this.prisma.whatsAppDelivery.create({ data: { schoolId, phone, kind, templateName: label, status: 'FAILED', error: reason.slice(0, 500) } });
      } catch (ledgerErr) {
        this.logger.error(`Could not record WhatsApp failure: ${(ledgerErr as Error).message}`);
      }
      return { ok: false, code };
    }
  }

  /**
   * Send a template to a phone and write the ledger row — shared by
   * `send()` and by the settings page's test send (which has no message,
   * only a number to prove the pipeline with).
   */
  async deliver(
    cfg: WhatsAppConfig,
    schoolId: string,
    phone: string,
    kind: string,
    template: WhatsAppTemplate,
    phoneNumberId: string | null,
  ): Promise<boolean> {
    try {
      const { messageId } = await sendTemplate(cfg, phone, template, { phoneNumberId, fetchImpl: this.fetchImpl });
      await this.prisma.whatsAppDelivery.create({
        data: { schoolId, phone, kind, templateName: template.name, waMessageId: messageId, status: 'SENT', sentAt: new Date() },
      });
      return true;
    } catch (e) {
      const err = e as Error;
      const reason = e instanceof WhatsAppApiError ? `${err.message} (code ${e.code ?? '?'})` : err.message;
      this.logger.warn(`WhatsApp send to ${phone} (${kind}) failed: ${reason}`);
      try {
        await this.prisma.whatsAppDelivery.create({
          data: { schoolId, phone, kind, templateName: template.name, status: 'FAILED', error: reason.slice(0, 500) },
        });
      } catch (ledgerErr) {
        this.logger.error(`Could not record WhatsApp failure: ${(ledgerErr as Error).message}`);
      }
      return false;
    }
  }

  async settingsFor(schoolId: string): Promise<SchoolSettings> {
    const hit = this.settingsCache.get(schoolId);
    if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
    let value: SchoolSettings = { enabled: false, phoneNumberId: null };
    try {
      const row = await this.prisma.whatsAppSettings.findUnique({
        where: { schoolId },
        select: { enabled: true, phoneNumberId: true },
      });
      value = { enabled: row?.enabled ?? false, phoneNumberId: row?.phoneNumberId ?? null };
    } catch (e) {
      // The API deploys before a migration has necessarily run (and a deploy
      // must never be broken by that order). A missing table reads as "off"
      // for this school — and, crucially, never fails the outbox row that
      // push has already been sent for, which would resend the push.
      if (!this.warnedNoTable) {
        this.warnedNoTable = true;
        this.logger.warn(`WhatsApp settings unreadable — treating every school as off until the migration runs: ${(e as Error).message}`);
      }
    }
    this.settingsCache.set(schoolId, { at: Date.now(), value });
    return value;
  }

  /** Forget a school's cached switch — the settings page calls this on save. */
  forget(schoolId: string): void {
    this.settingsCache.delete(schoolId);
  }

  /**
   * The phone behind a login: the person's own verified number first (an
   * admin has nothing else); then a student's login reaches the guardian's
   * phone, a teacher's or staff member's their own record. The first that
   * normalises to a real mobile wins; none means nothing to send.
   */
  async phoneFor(schoolId: string, email: string): Promise<string | null> {
    return (await this.addressFor(schoolId, email))?.phone ?? null;
  }

  /**
   * The phone, plus WHICH CHILD when the login is a student's: one guardian
   * phone often serves siblings, so every notice about a child carries that
   * child's name and class (see `childLabel` in templates.ts).
   */
  async addressFor(schoolId: string, email: string): Promise<{ phone: string; child: { name: string; className: string | null } | null } | null> {
    const user = await this.prisma.user.findFirst({ where: { schoolId, email }, select: { id: true, phone: true, phoneVerifiedAt: true } });
    if (!user) return null;
    const [student, teacher, staff] = await Promise.all([
      this.prisma.student.findFirst({
        where: { schoolId, userId: user.id },
        select: { guardianPhone: true, firstName: true, lastName: true, classSection: { select: { name: true, grade: { select: { name: true } } } } },
      }),
      this.prisma.teacher.findFirst({ where: { schoolId, userId: user.id }, select: { phone: true } }),
      this.prisma.staff.findFirst({ where: { schoolId, userId: user.id }, select: { phone: true } }),
    ]);
    const child = student
      ? { name: `${student.firstName} ${student.lastName}`.trim(), className: student.classSection ? `${student.classSection.grade.name}-${student.classSection.name}` : null }
      : null;
    // A number the person proved is theirs wins over anything the office typed.
    const phone = (user.phone && user.phoneVerifiedAt ? toE164(user.phone) : null) ?? toE164(student?.guardianPhone) ?? toE164(teacher?.phone) ?? toE164(staff?.phone);
    return phone ? { phone, child } : null;
  }
}

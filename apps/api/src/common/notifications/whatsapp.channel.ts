import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@skoolos/db';
import type { NotificationChannel, NotificationMessage } from './notification.types';
import { toE164 } from './whatsapp/phone';
import { sendTemplate, whatsAppConfig, WhatsAppApiError, type WhatsAppConfig } from './whatsapp/graph.client';
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

    const phone = await this.phoneFor(schoolId, to);
    if (!phone) return false;

    const template = templateFor(message);
    return this.deliver(cfg, schoolId, phone, message.kind, template, settings.phoneNumberId);
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
   * The phone behind a login: a student's login reaches the guardian's
   * phone; a teacher's or staff member's reaches their own. The first that
   * normalises to a real mobile wins; none means nothing to send.
   */
  async phoneFor(schoolId: string, email: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({ where: { schoolId, email }, select: { id: true } });
    if (!user) return null;
    const [student, teacher, staff] = await Promise.all([
      this.prisma.student.findFirst({ where: { schoolId, userId: user.id }, select: { guardianPhone: true } }),
      this.prisma.teacher.findFirst({ where: { schoolId, userId: user.id }, select: { phone: true } }),
      this.prisma.staff.findFirst({ where: { schoolId, userId: user.id }, select: { phone: true } }),
    ]);
    return toE164(student?.guardianPhone) ?? toE164(teacher?.phone) ?? toE164(staff?.phone);
  }
}

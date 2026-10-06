import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@skoolos/db';
import { ensureConnected, sharedRedis, type SharedRedis } from '../redis/redis.client';
import type { DeliveryChannel, DeliveryOutcome, NotificationMessage } from './notification.types';
import { isTransientWhatsAppFailure } from './whatsapp/failure';
import { toE164 } from './whatsapp/phone';
import { WhatsAppApiError, sendTemplate, senderDisplayNumber, type SendResult, type WhatsAppConfig, whatsAppConfig, whatsAppConfigProblem } from './whatsapp/graph.client';
import { TemplateApproval, chooseTemplate } from './whatsapp/template-approval';
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

/**
 * An established-but-stalled Redis socket never rejects, and the outbox drain
 * awaits send() per recipient — one hung command would stall the whole
 * fan-out. Past this, the dedup falls back to memory.
 */
export const DEDUP_REDIS_TIMEOUT_MS = 750;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export class WhatsAppChannel implements DeliveryChannel {
  readonly name = 'whatsapp';
  private readonly logger = new Logger(WhatsAppChannel.name);
  private readonly settingsCache = new Map<string, { at: number; value: SchoolSettings }>();
  private warnedUnconfigured = false;
  private warnedNoTable = false;

  constructor(
    private readonly prisma: Db,
    private readonly config: () => WhatsAppConfig | null = () => whatsAppConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly redis: () => SharedRedis = () => sharedRedis(),
    private readonly approval: Pick<TemplateApproval, 'isApproved'> = new TemplateApproval(config, fetchImpl),
  ) {}

  /** The platform credentials, or null when the environment has none. */
  get configured(): boolean {
    return this.config() !== null;
  }

  /** The number families see messages come FROM, for copy that has to name it. */
  async senderNumber(): Promise<string | null> {
    const cfg = this.config();
    return cfg ? senderDisplayNumber(cfg, { fetchImpl: this.fetchImpl }) : null;
  }

  /**
   * The same words to the same phone within a minute are one message. A
   * family with three children at the school gets ONE "PTM on Saturday",
   * not three; the per-child kinds (absence, remark) differ in their
   * parameters and pass. Keyed on phone + template + parameters.
   *
   * One copy per phone across every serverless instance, through Redis
   * (SET NX with a 60 s expiry); memory decides only when Redis is
   * unreachable, but every Redis grant is mirrored there too. The
   * Redis key is a hash — the phone number is personal data and stays out of
   * it. The memory map is pruned when it grows, so a fan-out of thousands
   * stays bounded.
   */
  private readonly recent = new Map<string, number>();
  private static readonly DEDUPE_MS = 60_000;
  private warnedRedis = false;

  /**
   * Claim the right to send this message to this phone. Resolves null when
   * someone already did within the minute (a duplicate: send nothing), else
   * a release that gives the claim back — called when the delivery FAILS, so
   * a retry or an identical sibling send is not counted as sent.
   */
  private async claim(phone: string, template: WhatsAppTemplate): Promise<null | (() => Promise<void>)> {
    const raw = `${phone}|${template.name}|${template.params.join('\u0001')}`;
    try {
      const r = this.redis();
      if (r) {
        if (await ensureConnected(r)) {
          const key = `wa:dedup:${createHash('sha256').update(raw).digest('hex').slice(0, 32)}`;
          const got = await withTimeout(r.set(key, '1', 'EX', WhatsAppChannel.DEDUPE_MS / 1000, 'NX'), DEDUP_REDIS_TIMEOUT_MS);
          if (got === null) return null;
          // Record it in memory too: if Redis flaps between this send and an
          // identical sibling one, the memory fallback must still know this
          // phone was sent to. (Memory already holding it means this server
          // sent it during an earlier outage — a duplicate either way.)
          if (this.isDuplicateLocal(raw)) return null;
          return async () => {
            this.recent.delete(raw);
            try {
              await withTimeout(r.del(key), DEDUP_REDIS_TIMEOUT_MS);
            } catch {
              /* the claim expires on its own in 60 s */
            }
          };
        }
        this.warnRedisOnce('Redis is configured but unreachable');
      }
    } catch (e) {
      this.warnRedisOnce((e as Error).message);
    }
    if (this.isDuplicateLocal(raw)) return null;
    return async () => {
      this.recent.delete(raw);
    };
  }

  private warnRedisOnce(why: string): void {
    if (this.warnedRedis) return;
    this.warnedRedis = true;
    this.logger.warn(`WhatsApp dedup fell back to memory: ${why}`);
  }

  private isDuplicateLocal(raw: string): boolean {
    const now = Date.now();
    const seen = this.recent.get(raw);
    if (seen && now - seen < WhatsAppChannel.DEDUPE_MS) return true;
    if (this.recent.size > 5000) for (const [k, t] of this.recent) if (now - t > WhatsAppChannel.DEDUPE_MS) this.recent.delete(k);
    this.recent.set(raw, now);
    return false;
  }

  async send(to: string, message: NotificationMessage, schoolId: string): Promise<boolean> {
    const o = await this.attempt(to, message, schoolId);
    // A duplicate means a sibling login on this phone already has it.
    return o.status === 'SENT' || (o.status === 'SKIPPED' && o.reason === 'duplicate');
  }

  /**
   * One attempt, and what it came to — the outbox drain records this on the
   * delivery row and retries only a RETRY. Never throws for a delivery failure.
   */
  async attempt(to: string, message: NotificationMessage, schoolId: string): Promise<DeliveryOutcome> {
    const cfg = this.config();
    if (!cfg) {
      if (!this.warnedUnconfigured) {
        this.warnedUnconfigured = true;
        // Say WHICH thing is wrong. "Not configured" sent everybody to check
        // a token that was fine, while the real fault was the account id
        // pasted in where the number id goes.
        this.logger.warn(`WhatsApp is idle — ${whatsAppConfigProblem() ?? 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set.'}`);
      }
      return { status: 'SKIPPED', reason: 'channel-off' };
    }
    const settings = await this.settingsFor(schoolId);
    if (!settings.enabled) return { status: 'SKIPPED', reason: 'channel-off' };

    const address = await this.addressFor(schoolId, to);
    if (!address) return { status: 'SKIPPED', reason: 'no-address' };
    const { phone } = address;

    // The dedup claim is on the template REQUESTED, not the one chosen: two
    // instances whose approval caches disagree could otherwise send v1 and v2 of
    // the same card to one phone within the minute. The ledger records the name
    // actually sent.
    const requested = templateFor(message, { child: address.child });
    const release = await this.claim(phone, requested);
    if (!release) return { status: 'SKIPPED', reason: 'duplicate' };
    // A new template waiting for Meta's review goes as its approved v1, or not
    // at all — and "not at all" is a SKIP, never a failure: retrying cannot
    // help until Meta approves it.
    const template = await chooseTemplate(requested, this.approval);
    if (!template) {
      await release();
      return { status: 'SKIPPED', reason: 'template-pending' };
    }
    const r = await this.sendOnce(cfg, schoolId, phone, message.kind, template, settings.phoneNumberId);
    if (r.ok) return { status: 'SENT', providerId: r.messageId };
    await release();
    return isTransientWhatsAppFailure(r.code, r.httpStatus) ? { status: 'RETRY', error: r.reason } : { status: 'FAILED', error: r.reason };
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
    // Only the provider call decides success. The ledger write has its own try:
    // a message Meta accepted must never be reported as failed because the
    // bookkeeping threw — callers react to `ok: false` by sending something else.
    let messageId: string;
    try {
      ({ messageId } = await fn(cfg, settings.phoneNumberId, this.fetchImpl));
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
    try {
      await this.prisma.whatsAppDelivery.create({ data: { schoolId, phone, kind, templateName: label, waMessageId: messageId, status: 'SENT', sentAt: new Date() } });
    } catch (ledgerErr) {
      // Meta has the message. Not recording it must never turn into "failed".
      this.logger.error(`WhatsApp ${label} to ${phone} was sent (${messageId}) but could not be recorded: ${(ledgerErr as Error).message}`);
    }
    return { ok: true, code: null };
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
    return (await this.sendOnce(cfg, schoolId, phone, kind, template, phoneNumberId)).ok;
  }

  /**
   * Send a template and write the ledger row. Only the provider call decides
   * success; the ledger write has its own try — a message Meta accepted is
   * never reported as failed because bookkeeping threw (that would release
   * the sibling dedup claim and send a second copy). A refusal keeps Meta's
   * code and HTTP status so the caller can tell "try again" from "never".
   */
  private async sendOnce(
    cfg: WhatsAppConfig,
    schoolId: string,
    phone: string,
    kind: string,
    template: WhatsAppTemplate,
    phoneNumberId: string | null,
  ): Promise<{ ok: true; messageId: string } | { ok: false; code: number | null; httpStatus: number | null; reason: string }> {
    let messageId: string;
    try {
      ({ messageId } = await sendTemplate(cfg, phone, template, { phoneNumberId, fetchImpl: this.fetchImpl }));
    } catch (e) {
      const api = e instanceof WhatsAppApiError ? e : null;
      const reason = api ? `${api.message} (code ${api.code ?? '?'})` : (e as Error).message;
      this.logger.warn(`WhatsApp send to ${phone} (${kind}) failed: ${reason}`);
      try {
        await this.prisma.whatsAppDelivery.create({
          data: { schoolId, phone, kind, templateName: template.name, status: 'FAILED', error: reason.slice(0, 500) },
        });
      } catch (ledgerErr) {
        this.logger.error(`Could not record WhatsApp failure: ${(ledgerErr as Error).message}`);
      }
      return { ok: false, code: api?.code ?? null, httpStatus: api?.httpStatus ?? null, reason: reason.slice(0, 500) };
    }
    try {
      await this.prisma.whatsAppDelivery.create({
        data: { schoolId, phone, kind, templateName: template.name, waMessageId: messageId, status: 'SENT', sentAt: new Date() },
      });
    } catch (ledgerErr) {
      // Meta has the message. Not recording it must never turn into "failed" —
      // that would release the sibling dedup claim and resend. Log loudly with
      // the waMessageId so the row can be reconciled.
      this.logger.error(`WhatsApp ${kind} to ${phone} was sent (${messageId}) but could not be recorded: ${(ledgerErr as Error).message}`);
    }
    return { ok: true, messageId };
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
      this.prisma.teacher.findFirst({ where: { schoolId, userId: user.id }, select: { phone: true, whatsappOptIn: true } }),
      this.prisma.staff.findFirst({ where: { schoolId, userId: user.id }, select: { phone: true } }),
    ]);
    const child = student
      ? { name: `${student.firstName} ${student.lastName}`.trim(), className: student.classSection ? `${student.classSection.grade.name}-${student.classSection.name}` : null }
      : null;
    // A TEACHER WHO SAID NO IS NOT MESSAGED.
    //
    // The record carries `whatsappOptIn` and the onboarding sheet asks for it
    // in as many words — "WhatsApp messages OK (YES/NO)" — and nothing read it
    // on the way out, so a teacher who declined was messaged anyway. That is
    // the wrong side of WhatsApp's own Business Messaging Policy, which allows
    // contact only where "you have received opt-in permission from the
    // recipient confirming that they wish to receive subsequent messages".
    //
    // It is also the fastest way to lose the templates: quality is driven by
    // people blocking and reporting, and a template that reaches the lowest
    // rating is paused for three hours, then six, then DISABLED for good.
    //
    // The gate is on the PERSON, not on the phone column. A teacher who
    // declined but happens to have a verified login number would otherwise
    // still be reachable through the first branch below.
    if (teacher && !teacher.whatsappOptIn) return null;

    // A number the person proved is theirs wins over anything the office typed.
    const phone = (user.phone && user.phoneVerifiedAt ? toE164(user.phone) : null) ?? toE164(student?.guardianPhone) ?? toE164(teacher?.phone) ?? toE164(staff?.phone);
    return phone ? { phone, child } : null;
  }
}

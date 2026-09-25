import { maskPhone } from '../../common/otp/phone-identity';
export { maskPhone };
import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { WhatsAppChannel } from '../../common/notifications/whatsapp.channel';
import { whatsAppConfig, whatsAppConfigProblem } from '../../common/notifications/whatsapp/graph.client';
import { codeFromError, failureAdvice, failureBlame } from '../../common/notifications/whatsapp/failure';
import { testNoticeTemplate } from '../../common/notifications/whatsapp/templates';
import { toE164 } from '../../common/notifications/whatsapp/phone';
import { HELLO_WORLD, SUBMISSIONS, TEMPLATE_NAMES } from '../../common/notifications/whatsapp/templates';

/**
 * The school's side of the WhatsApp channel: one switch, an optional own
 * number, the recent ledger, and a test send that proves the pipeline with
 * Meta's `hello_world` template before a single family is messaged.
 *
 * `platform.configured` is whether the PLATFORM can send at all (token +
 * number in the environment). A school flipping `enabled` on before that is
 * fine — nothing goes out until both are true, and the page says so.
 */
@Injectable()
export class WhatsAppSettingsService {
  constructor(private readonly channel: WhatsAppChannel) {}

  async get(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [settings, recent, since] = await Promise.all([
        tx.whatsAppSettings.findUnique({ where: { schoolId } }),
        tx.whatsAppDelivery.findMany({
          where: { schoolId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, phone: true, kind: true, status: true, error: true, createdAt: true, deliveredAt: true, readAt: true },
        }),
        tx.whatsAppDelivery.groupBy({
          by: ['status'],
          where: { schoolId, createdAt: { gte: monthStart() } },
          _count: { _all: true },
        }),
      ]);
      const thisMonth: Record<string, number> = {};
      for (const g of since) thisMonth[g.status] = g._count._all;
      return {
        settings: { enabled: settings?.enabled ?? false, phoneNumberId: settings?.phoneNumberId ?? null },
        platform: {
          configured: this.channel.configured,
          senderPhoneNumberId: whatsAppConfig()?.phoneNumberId ?? null,
          // WHY it is idle, not just that it is. A school staring at a dead
          // switch cannot tell a missing token from an id pasted in the
          // wrong box, and both look like "configured" from here.
          problem: whatsAppConfigProblem(),
        },
        templates: Object.entries(TEMPLATE_NAMES).map(([kind, name]) => ({ kind, name, body: SUBMISSIONS[kind as keyof typeof SUBMISSIONS].body })),
        thisMonth,
        // Each failure says WHOSE problem it is, so a school is not sent to
        // ring seven parents about an expired token of ours.
        recent: recent.map((r) => {
          const blame = r.status === 'FAILED' ? failureBlame(codeFromError(r.error)) : null;
          return { ...r, phone: maskPhone(r.phone), blame, advice: blame ? failureAdvice(blame) : null };
        }),
      };
    });
  }

  async update(schoolId: string, dto: { enabled?: boolean; phoneNumberId?: string | null }) {
    const data: { enabled?: boolean; phoneNumberId?: string | null } = {};
    if (typeof dto.enabled === 'boolean') data.enabled = dto.enabled;
    if (dto.phoneNumberId !== undefined) data.phoneNumberId = dto.phoneNumberId?.trim() || null;
    await withTenant(schoolId, (tx) =>
      tx.whatsAppSettings.upsert({ where: { schoolId }, create: { schoolId, ...data }, update: data }),
    );
    this.channel.forget(schoolId);
    return this.get(schoolId);
  }

  /** `hello_world` to one number: the smoke test an admin runs from the page. */
  async sendTest(schoolId: string, to: string) {
    const cfg = whatsAppConfig();
    if (!cfg) throw new ApiError('WHATSAPP_NOT_CONFIGURED', 'WhatsApp is not set up on the platform yet.', 409);
    const phone = toE164(to);
    if (!phone) throw new ApiError('BAD_PHONE', 'That does not look like a mobile number.', 400);
    const settings = await this.channel.settingsFor(schoolId);

    // `hello_world` is Meta's own sample and the clearest thing to receive —
    // but it is REFUSED on a real number with code 131058, "Hello World
    // templates can only be sent from the Public Test Numbers". So the test
    // button worked on the test number and broke the moment the school got a
    // live one, which is exactly when somebody presses it.
    //
    // Try it, and fall back to one of the school's own approved templates.
    // The fallback proves more anyway: it is the same path a real notice
    // takes, through a template Meta has actually reviewed.
    const ok = await this.channel.deliver(cfg, schoolId, phone, 'TEST', HELLO_WORLD, settings.phoneNumberId);
    if (ok) return { ok, phone: maskPhone(phone), template: HELLO_WORLD.name };

    // Through the tenant transaction — the school's own name needs no RLS
    // bypass, and every bypass has to be justified on a reviewed list.
    const school = await withTenant(schoolId, (tx) => tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }));
    const fallback = testNoticeTemplate(school?.name ?? 'Your school');
    const okFallback = await this.channel.deliver(cfg, schoolId, phone, 'TEST', fallback, settings.phoneNumberId);
    return { ok: okFallback, phone: maskPhone(phone), template: fallback.name };
  }
}

function monthStart(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** +919876543210 → +91 98••• •3210 — the office recognises it; a screenshot does not leak it. */

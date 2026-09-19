import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';

/**
 * Meta's webhook: one URL for every school, because the WABA is ours and a
 * school's number (Phase 2) still lives under it. Two kinds of event matter:
 *
 *  - STATUSES — sent / delivered / read / failed for a message we sent.
 *    Matched to the ledger by Meta's message id (unique), updated under the
 *    row's OWN schoolId. This is the receipt that makes "we told the family
 *    on WhatsApp at 09:43, read at 10:05" a fact.
 *  - MESSAGES — a family replying, or tapping a button. Logged for now; the
 *    Phase-4 button flows (approve leave, pay now, dispute absence) attach
 *    here. A reply also opens Meta's 24-hour free-text window.
 *
 * Runs on the platform client: a webhook has no tenant context, and the
 * tenant is derived from the row the event names, never from the request.
 */
export interface StatusEvent {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}
export interface InboundMessage {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body: string };
  button?: { payload: string; text: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
}
export interface WebhookBody {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        statuses?: StatusEvent[];
        messages?: InboundMessage[];
      };
    }[];
  }[];
}

export interface WebhookOutcome {
  statuses: number;
  updated: number;
  inbound: number;
}

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  /** The GET handshake: Meta sends its token back and expects the challenge echoed. */
  verifyChallenge(mode: string | undefined, token: string | undefined, challenge: string | undefined): string | null {
    const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim();
    if (!expected || mode !== 'subscribe' || !token || !challenge) return null;
    return safeEqual(token, expected) ? challenge : null;
  }

  /**
   * `X-Hub-Signature-256: sha256=<hmac of the raw body with the app secret>`.
   * Without the secret configured, nothing is accepted — an unsigned webhook
   * would let anyone mark a family's notice "read".
   */
  signatureValid(rawBody: Buffer | string | undefined, header: string | undefined): boolean {
    const secret = process.env.META_APP_SECRET?.trim();
    if (!secret || !rawBody || !header?.startsWith('sha256=')) return false;
    const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
    return safeEqual(header.slice('sha256='.length), digest);
  }

  async handle(body: WebhookBody): Promise<WebhookOutcome> {
    const db = getPlatformPrisma();
    const out: WebhookOutcome = { statuses: 0, updated: 0, inbound: 0 };
    if (body.object !== 'whatsapp_business_account') return out;
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value;
        if (!v) continue;
        for (const s of v.statuses ?? []) {
          out.statuses += 1;
          if (await this.applyStatus(db, s)) out.updated += 1;
        }
        for (const m of v.messages ?? []) {
          out.inbound += 1;
          const what = m.button?.payload ?? m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.text?.body ?? m.type;
          this.logger.log(`WhatsApp inbound from ${m.from} via ${v.metadata?.phone_number_id ?? '?'}: ${String(what).slice(0, 120)}`);
        }
      }
    }
    return out;
  }

  private async applyStatus(db: ReturnType<typeof getPlatformPrisma>, s: StatusEvent): Promise<boolean> {
    const row = await db.whatsAppDelivery.findUnique({ where: { waMessageId: s.id }, select: { id: true, schoolId: true, status: true } });
    if (!row) return false;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
    // Statuses can arrive out of order (read before delivered on a fast
    // network); never let an earlier stage overwrite a later one.
    const rank: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
    const next = s.status === 'sent' ? 'SENT' : s.status === 'delivered' ? 'DELIVERED' : s.status === 'read' ? 'READ' : s.status === 'failed' ? 'FAILED' : null;
    if (!next) return false;
    const data: Record<string, unknown> = {};
    if (next === 'DELIVERED') data.deliveredAt = at;
    if (next === 'READ') { data.readAt = at; data.deliveredAt = undefined; }
    if (next === 'FAILED') {
      const e = s.errors?.[0];
      data.error = e ? `${e.title ?? e.message ?? 'failed'} (code ${e.code ?? '?'})`.slice(0, 500) : 'failed';
    }
    if ((rank[next] ?? 0) > (rank[row.status] ?? 0)) data.status = next;
    // The `where` carries the row's own schoolId: a receipt can only ever
    // touch the tenant that sent the message.
    await db.whatsAppDelivery.updateMany({ where: { id: row.id, schoolId: row.schoolId }, data });
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

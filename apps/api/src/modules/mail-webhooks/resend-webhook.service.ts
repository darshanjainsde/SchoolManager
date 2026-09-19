import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';

/**
 * Resend's webhook — the receipts for every email the platform sent through
 * it. Signed with Svix: `svix-id`, `svix-timestamp`, `svix-signature`
 * (space-separated `v1,<base64 hmac>` entries) over `${id}.${ts}.${rawBody}`
 * with the base64 secret after `whsec_`. Without the secret nothing is
 * accepted: an unsigned webhook would let anyone suppress a family's address.
 *
 * Events → ledger, by Resend's email id (unique on the row):
 *   email.delivered → DELIVERED; email.bounced → BOUNCED (+ suppression when
 *   permanent); email.complained → COMPLAINED (+ suppression);
 *   email.delivery_delayed → noted, status unchanged. Statuses never regress.
 *
 * Runs on the platform client: a webhook has no tenant context, and the
 * tenant is whatever the row it names carries.
 */
export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    bounce?: { message?: string; type?: string; subType?: string };
  };
}

export interface ResendOutcome {
  events: number;
  updated: number;
  suppressed: number;
}

const TOLERANCE_S = 5 * 60;

@Injectable()
export class ResendWebhookService {
  private readonly logger = new Logger(ResendWebhookService.name);

  signatureValid(rawBody: Buffer | string | undefined, headers: { id?: string; timestamp?: string; signature?: string }, now = Date.now()): boolean {
    const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
    if (!secret || !rawBody || !headers.id || !headers.timestamp || !headers.signature) return false;
    const ts = Number(headers.timestamp);
    if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_S) return false;
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`).digest('base64');
    return headers.signature.split(' ').some((part) => {
      const [version, sig] = part.split(',');
      return version === 'v1' && sig && safeEqual(sig, expected);
    });
  }

  async handle(event: ResendEvent): Promise<ResendOutcome> {
    const db = getPlatformPrisma();
    const out: ResendOutcome = { events: 1, updated: 0, suppressed: 0 };
    const id = event.data?.email_id;
    if (!id) return out;
    const row = await db.emailDelivery.findUnique({ where: { providerId: id }, select: { id: true, schoolId: true, to: true, status: true } });
    if (!row) return out;
    const at = event.created_at ? new Date(event.created_at) : new Date();
    const rank: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, BOUNCED: 3, COMPLAINED: 3, FAILED: 3 };
    let next: string | null = null;
    const data: Record<string, unknown> = {};
    switch (event.type) {
      case 'email.delivered':
        next = 'DELIVERED';
        data.deliveredAt = at;
        break;
      case 'email.bounced': {
        next = 'BOUNCED';
        data.bouncedAt = at;
        const b = event.data?.bounce;
        data.error = `${b?.message ?? 'bounced'}${b?.type ? ` (${b.type}${b.subType ? `/${b.subType}` : ''})` : ''}`.slice(0, 500);
        // A transient bounce (full mailbox, greylisting) is not a dead address.
        if (!b?.type || /permanent|hard/i.test(b.type)) {
          await this.suppress(db, row.to, row.schoolId, 'BOUNCE', b?.message ?? null);
          out.suppressed += 1;
        }
        break;
      }
      case 'email.complained':
        next = 'COMPLAINED';
        data.bouncedAt = at;
        data.error = 'marked as spam by the recipient';
        await this.suppress(db, row.to, row.schoolId, 'COMPLAINT', null);
        out.suppressed += 1;
        break;
      case 'email.delivery_delayed':
        data.error = 'delivery delayed by the receiving server';
        break;
      default:
        return out;
    }
    if (next && (rank[next] ?? 0) > (rank[row.status] ?? 0)) data.status = next;
    // The where names the row's own school (or its absence): a receipt can
    // only ever touch the tenant that sent the message.
    await db.emailDelivery.updateMany({ where: { id: row.id, schoolId: row.schoolId }, data });
    out.updated += 1;
    return out;
  }

  private async suppress(db: ReturnType<typeof getPlatformPrisma>, email: string, schoolId: string | null, reason: 'BOUNCE' | 'COMPLAINT', detail: string | null): Promise<void> {
    try {
      await db.emailSuppression.upsert({
        where: { email },
        create: { email, schoolId, reason, detail: detail?.slice(0, 500) ?? null },
        update: { reason, detail: detail?.slice(0, 500) ?? null },
      });
    } catch (e) {
      this.logger.error(`Could not suppress ${email}: ${(e as Error).message}`);
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

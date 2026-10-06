import { Logger } from '@nestjs/common';
import { whatsAppConfig, type WhatsAppConfig } from './graph.client';
import { GATED_TEMPLATES, TEMPLATE_LANGUAGE, type WhatsAppTemplate } from './templates';

/**
 * IS THIS NEW TEMPLATE APPROVED YET?
 *
 * Meta reviews a template in hours or days, and a button cannot be added to
 * an approved template in place — a template that gains one is a new name
 * (`_v2`). The code that sends it ships before the review ends, so the
 * channel asks Meta's own list whether the new name is APPROVED; until it is,
 * the approved v1 goes instead, or (for a name with no v1) WhatsApp is
 * skipped and email + push still go. No deploy when Meta approves: the next
 * lookup, at most ten minutes later, sees it.
 *
 * Only names in GATED_TEMPLATES are asked about. Every other name was
 * approved before its code shipped, and a failed lookup must never stop one.
 *
 * Tier 4 replaces the lookup with `WhatsAppTemplateState`, written by Meta's
 * `message_template_status_update` webhook. The question stays the same.
 */
export const APPROVAL_TTL_MS = 10 * 60_000;
/** After a failed lookup: ask again sooner, keep the last answer meanwhile. */
export const APPROVAL_RETRY_MS = 60_000;

interface Known {
  at: number;
  ttl: number;
  approved: Set<string>;
}

export class TemplateApproval {
  private readonly logger = new Logger(TemplateApproval.name);
  private known: Known | null = null;
  private inflight: Promise<Set<string>> | null = null;

  constructor(
    private readonly config: () => WhatsAppConfig | null = () => whatsAppConfig(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async isApproved(name: string): Promise<boolean> {
    if (!GATED_TEMPLATES.has(name)) return true;
    return (await this.approvedNames()).has(name);
  }

  private approvedNames(): Promise<Set<string>> {
    const k = this.known;
    if (k && this.now() - k.at < k.ttl) return Promise.resolve(k.approved);
    this.inflight ??= this.lookup().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async lookup(): Promise<Set<string>> {
    const previous = this.known?.approved ?? new Set<string>();
    const cfg = this.config();
    if (!cfg?.wabaId) {
      // Without the business account id there is no list to read: nothing new
      // is sent until WHATSAPP_WABA_ID is set, and v1 keeps going.
      this.known = { at: this.now(), ttl: APPROVAL_TTL_MS, approved: previous };
      return previous;
    }
    try {
      const res = await this.fetchImpl(
        `https://graph.facebook.com/${cfg.graphVersion}/${cfg.wabaId}/message_templates?fields=name,status,language&limit=200`,
        { headers: { Authorization: `Bearer ${cfg.token}` } },
      );
      if (!res.ok) throw new Error(`Graph API ${res.status}`);
      const body = (await res.json()) as { data?: { name?: string; status?: string; language?: string }[] };
      const approved = new Set(
        (body.data ?? [])
          .filter((t) => t.status === 'APPROVED' && t.language === TEMPLATE_LANGUAGE && !!t.name)
          .map((t) => t.name as string),
      );
      this.known = { at: this.now(), ttl: APPROVAL_TTL_MS, approved };
      return approved;
    } catch (e) {
      this.logger.warn(`Template approval lookup failed; keeping what was known: ${(e as Error).message}`);
      this.known = { at: this.now(), ttl: APPROVAL_RETRY_MS, approved: previous };
      return previous;
    }
  }
}

/** The template to send: this one once approved, else its v1, else nothing. */
export async function chooseTemplate(t: WhatsAppTemplate, approval: Pick<TemplateApproval, 'isApproved'>): Promise<WhatsAppTemplate | null> {
  if (await approval.isApproved(t.name)) return t;
  return t.fallback ?? null;
}

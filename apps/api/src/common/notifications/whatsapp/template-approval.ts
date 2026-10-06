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
/** One Graph call may take at most this long. */
export const APPROVAL_FETCH_TIMEOUT_MS = 5_000;
/** Pages of the template list followed per lookup (200 templates a page). */
export const APPROVAL_MAX_PAGES = 5;

interface Known {
  at: number;
  ttl: number;
  approved: Set<string>;
}

export class TemplateApproval {
  private readonly logger = new Logger(TemplateApproval.name);
  private known: Known | null = null;
  private inflight: Promise<Set<string>> | null = null;
  private warnedPageCap = false;

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
      const approved = new Set<string>();
      let url: string | undefined =
        `https://graph.facebook.com/${cfg.graphVersion}/${cfg.wabaId}/message_templates?fields=name,status,language&limit=200`;
      for (let page = 1; url; page++) {
        // A hung Graph call must not hold every gated send behind the shared in-flight promise.
        const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(APPROVAL_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`Graph API ${res.status}`);
        const body = (await res.json()) as { data?: { name?: string; status?: string; language?: string }[]; paging?: { next?: string } };
        for (const t of body.data ?? []) {
          if (t.status === 'APPROVED' && t.language === TEMPLATE_LANGUAGE && t.name) approved.add(t.name);
        }
        url = body.paging?.next;
        if (url && page >= APPROVAL_MAX_PAGES) {
          if (!this.warnedPageCap) {
            this.warnedPageCap = true;
            this.logger.warn(`Template list has more than ${APPROVAL_MAX_PAGES} pages; later templates are not looked at.`);
          }
          break;
        }
      }
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

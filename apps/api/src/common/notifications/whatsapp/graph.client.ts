import { forGraph } from './phone';
import type { WhatsAppTemplate } from './templates';

/**
 * The thin edge of Meta's Graph API. Credentials come from the environment
 * (placed in Vercel, never in a row): `WHATSAPP_TOKEN` is the system-user
 * token, `WHATSAPP_PHONE_NUMBER_ID` the platform's sending number. A school
 * that brings its own number (Phase 2) overrides the phone number id per
 * call; the token stays ours because the number lives under our WABA.
 */
export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  wabaId: string | null;
  graphVersion: string;
}

/**
 * Why the WABA id is checked here.
 *
 * Both ids are long digit strings that sit next to each other in Meta's UI
 * and in our own docs, and pasting the account id where the NUMBER id goes
 * is the easy mistake. Nothing complains: the config looks present, the
 * channel reports itself configured, the settings screen shows a plausible
 * id — and every send dies at Meta with code 100 "Object with ID … does not
 * exist", which reads like a permissions problem rather than a typo.
 *
 * That is exactly what staging was doing, silently, until somebody asked why
 * WhatsApp had never worked. A sending number is never the business account,
 * so the two being equal is always wrong and is worth refusing outright.
 */
export function whatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return null;
  const wabaId = env.WHATSAPP_WABA_ID?.trim() || null;
  if (wabaId && phoneNumberId === wabaId) return null;
  return { token, phoneNumberId, wabaId, graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim() || 'v21.0' };
}

/**
 * Why the channel is idle, in words a person can act on.
 *
 * `whatsAppConfig` returning null is the only signal the channel has, and
 * "not configured" sent everybody to check a token that was fine.
 */
export function whatsAppConfigProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const wabaId = env.WHATSAPP_WABA_ID?.trim() || null;
  if (!token) return 'WHATSAPP_TOKEN is not set.';
  if (!phoneNumberId) return 'WHATSAPP_PHONE_NUMBER_ID is not set.';
  if (wabaId && phoneNumberId === wabaId) {
    return 'WHATSAPP_PHONE_NUMBER_ID is the same as WHATSAPP_WABA_ID. The sending number is not the business account — take the phone number id from WhatsApp Manager → Phone numbers, not the account id. Every send fails with Meta code 100 until this is fixed.';
  }
  return null;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; error_data?: { details?: string } };
}

export interface SendResult {
  messageId: string;
}

/**
 * Send one template message. Resolves the Meta message id (the key the
 * webhook uses to report delivered/read); throws `WhatsAppApiError` with
 * Meta's code so the ledger can record WHY (131026 = not on WhatsApp,
 * 132001 = template missing, 130429 = rate limited, 131047 = outside the
 * 24-h window for a non-template message…).
 */
export async function sendTemplate(
  cfg: WhatsAppConfig,
  to: string,
  template: WhatsAppTemplate,
  opts: { phoneNumberId?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<SendResult> {
  const f = opts.fetchImpl ?? fetch;
  const phoneNumberId = opts.phoneNumberId || cfg.phoneNumberId;
  const components: unknown[] = [];
  if (template.params.length) components.push({ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) });
  for (const b of template.buttons ?? []) {
    if (b.type === 'quick_reply') components.push({ type: 'button', sub_type: 'quick_reply', index: b.index, parameters: [{ type: 'payload', payload: b.payload }] });
    else if (b.type === 'url') components.push({ type: 'button', sub_type: 'url', index: b.index, parameters: [{ type: 'text', text: b.text }] });
    else if (b.type === 'copy_code') components.push({ type: 'button', sub_type: 'url', index: b.index, parameters: [{ type: 'text', text: b.text }] });
  }
  const body = {
    messaging_product: 'whatsapp',
    to: forGraph(to),
    type: 'template',
    template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) },
  };
  return post(cfg, phoneNumberId, body, f);
}

/** Free text — allowed only inside the 24-hour window the person opened by writing or tapping. */
export function sendText(cfg: WhatsAppConfig, to: string, text: string, opts: { phoneNumberId?: string | null; fetchImpl?: typeof fetch } = {}): Promise<SendResult> {
  return post(cfg, opts.phoneNumberId || cfg.phoneNumberId, { messaging_product: 'whatsapp', to: forGraph(to), type: 'text', text: { body: text.slice(0, 4096), preview_url: false } }, opts.fetchImpl ?? fetch);
}

export interface ListRow { id: string; title: string; description?: string }

/** An interactive list (up to 10 rows) — the "who covers period 3?" picker. Same 24-hour rule as text. */
export function sendList(
  cfg: WhatsAppConfig,
  to: string,
  list: { body: string; button: string; rows: ListRow[]; header?: string; footer?: string },
  opts: { phoneNumberId?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<SendResult> {
  const rows = list.rows.slice(0, 10).map((r) => ({ id: r.id.slice(0, 200), title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) }));
  return post(
    cfg,
    opts.phoneNumberId || cfg.phoneNumberId,
    {
      messaging_product: 'whatsapp',
      to: forGraph(to),
      type: 'interactive',
      interactive: {
        type: 'list',
        ...(list.header ? { header: { type: 'text', text: list.header.slice(0, 60) } } : {}),
        body: { text: list.body.slice(0, 1024) },
        ...(list.footer ? { footer: { text: list.footer.slice(0, 60) } } : {}),
        action: { button: list.button.slice(0, 20), sections: [{ title: 'Free this period', rows }] },
      },
    },
    opts.fetchImpl ?? fetch,
  );
}

/** Up to three reply buttons on a free-form message. Same 24-hour rule. */
export function sendButtons(
  cfg: WhatsAppConfig,
  to: string,
  msg: { body: string; buttons: { id: string; title: string }[] },
  opts: { phoneNumberId?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<SendResult> {
  return post(
    cfg,
    opts.phoneNumberId || cfg.phoneNumberId,
    {
      messaging_product: 'whatsapp',
      to: forGraph(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: msg.body.slice(0, 1024) },
        action: { buttons: msg.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) },
      },
    },
    opts.fetchImpl ?? fetch,
  );
}

async function post(cfg: WhatsAppConfig, phoneNumberId: string, body: unknown, f: typeof fetch): Promise<SendResult> {
  const res = await f(`https://graph.facebook.com/${cfg.graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as GraphErrorBody & { messages?: { id: string }[] };
  if (!res.ok || !json.messages?.[0]?.id) {
    const e = json.error ?? {};
    throw new WhatsAppApiError(
      e.error_data?.details || e.message || `Graph API ${res.status}`,
      e.code ?? null,
      e.error_subcode ?? null,
      res.status,
    );
  }
  return { messageId: json.messages[0].id };
}

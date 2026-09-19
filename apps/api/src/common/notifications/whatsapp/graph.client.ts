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

export function whatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId, wabaId: env.WHATSAPP_WABA_ID?.trim() || null, graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim() || 'v21.0' };
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
  const body = {
    messaging_product: 'whatsapp',
    to: forGraph(to),
    type: 'template',
    template: {
      name: template.name,
      language: { code: template.language },
      ...(template.params.length
        ? { components: [{ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) }] }
        : {}),
    },
  };
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

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Button payloads — what Meta hands back when someone taps.
 *
 *   v2:<body>:<exp>:<sig>
 *   body = lv:a:<leaveId> | lv:r:<leaveId> | cv:<subId>:<teacherId|skip> | ca:<subId> | cn:<subId>:<teacherId>
 *   exp  = minutes since the epoch, base 36, when the button stops working
 *   sig  = HMAC-SHA256("v2:<body>:<exp>").hex[0..12]
 *
 * Signed with WHATSAPP_ACTION_SECRET; verified against it, the PREVious one
 * (a rotation keeps delivered buttons alive) and META_APP_SECRET (what signed
 * everything before 2026-10-06). v1 payloads — no "v2:" and no expiry — are
 * accepted until V1_ACCEPTED_UNTIL, then refused.
 *
 * Expiry is checked AFTER the signature: "this button has expired" is only
 * ever said about a payload we really sent.
 */
export type Action =
  | { kind: 'leave'; decision: 'approve' | 'reject'; leaveId: string }
  | { kind: 'cover'; substitutionId: string; teacherId: string | 'skip' }
  | { kind: 'ack'; substitutionId: string }
  /**
   * "Can't". `teacherId` is the substitute the card was SENT to, so a Can't
   * tapped after the desk moved the period can still be answered — to that
   * teacher, and nobody else. Null only on a card rendered before 2026-10-07
   * (`cn:<subId>`), which acts for whoever covers it now.
   */
  | { kind: 'cant'; substitutionId: string; teacherId: string | null };

export type ParsedAction = { ok: true; action: Action } | { ok: false; why: 'foreign' } | { ok: false; why: 'expired'; action: Action };
export interface ActionKeys { sign: string; verify: readonly string[]; legacy: string | null }

export const ACTION_TTL_MS = 7 * 24 * 60 * 60_000;
export const V1_ACCEPTED_UNTIL = Date.parse('2026-11-15T00:00:00Z');
const SIG_LEN = 12;
let ephemeral: string | null = null;

const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('hex').slice(0, SIG_LEN);
/** timingSafeEqual throws on buffers of different byte lengths, and a tapped
 *  payload is attacker-controlled (a multi-byte character keeps .length equal
 *  but not the byte length) — so compare the BUFFERS' lengths first. */
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function actionKeys(env: NodeJS.ProcessEnv = process.env): ActionKeys {
  const own = env.WHATSAPP_ACTION_SECRET?.trim() || null;
  const prev = env.WHATSAPP_ACTION_SECRET_PREV?.trim() || null;
  const meta = env.META_APP_SECRET?.trim() || null;
  const sign = own ?? meta ?? (ephemeral ??= randomBytes(32).toString('hex'));
  const verify = [...new Set([own, prev, meta].filter((s): s is string => !!s))];
  return { sign, verify: verify.length ? verify : [sign], legacy: meta };
}

function seal(body: string, keys: Pick<ActionKeys, 'sign'>, now: number): string {
  const exp = Math.floor((now + ACTION_TTL_MS) / 60_000).toString(36);
  const head = `v2:${body}:${exp}`;
  return `${head}:${mac(head, keys.sign)}`;
}

export const leavePayload = (decision: 'approve' | 'reject', leaveId: string, keys: Pick<ActionKeys, 'sign'>, now = Date.now()) =>
  seal(`lv:${decision === 'approve' ? 'a' : 'r'}:${leaveId}`, keys, now);
export const coverPayload = (substitutionId: string, teacherId: string | 'skip', keys: Pick<ActionKeys, 'sign'>, now = Date.now()) =>
  seal(`cv:${substitutionId}:${teacherId}`, keys, now);
export const ackPayload = (substitutionId: string, keys: Pick<ActionKeys, 'sign'>, now = Date.now()) => seal(`ca:${substitutionId}`, keys, now);
/**
 * The substitute's "Can't" — the cover goes back to the desk. Names the
 * teacher the card is for; `null` (an outbox row written before the payload
 * carried the substitute) acts for whoever covers it at tap time.
 */
export const cantPayload = (substitutionId: string, teacherId: string | null, keys: Pick<ActionKeys, 'sign'>, now = Date.now()) =>
  seal(teacherId ? `cn:${substitutionId}:${teacherId}` : `cn:${substitutionId}`, keys, now);

/**
 * What a payload ACTS ON, without when it expires or how it was signed:
 * `v2:lv:a:<leaveId>:<exp>:<sig>` → `lv:a:<leaveId>`. The same card rendered a
 * minute later carries a new exp and sig but the same action; a card for a
 * different leave does not. Anything else is returned unchanged.
 */
export function actionIdentity(payload: string): string {
  if (!payload.startsWith('v2:')) return payload;
  const parts = payload.split(':');
  return parts.length > 3 ? parts.slice(1, -2).join(':') : payload;
}

function shape(parts: string[]): Action | null {
  if (parts[0] === 'lv' && parts.length === 3 && (parts[1] === 'a' || parts[1] === 'r') && parts[2]) {
    return { kind: 'leave', decision: parts[1] === 'a' ? 'approve' : 'reject', leaveId: parts[2] };
  }
  if (parts[0] === 'cv' && parts.length === 3 && parts[1] && parts[2]) return { kind: 'cover', substitutionId: parts[1], teacherId: parts[2] };
  if (parts[0] === 'ca' && parts.length === 2 && parts[1]) return { kind: 'ack', substitutionId: parts[1] };
  if (parts[0] === 'cn' && parts.length === 3 && parts[1] && parts[2]) return { kind: 'cant', substitutionId: parts[1], teacherId: parts[2] };
  if (parts[0] === 'cn' && parts.length === 2 && parts[1]) return { kind: 'cant', substitutionId: parts[1], teacherId: null };
  return null;
}

const FOREIGN = { ok: false, why: 'foreign' } as const;

export function parseAction(payload: string, keys: Pick<ActionKeys, 'verify' | 'legacy'>, now = Date.now()): ParsedAction {
  const parts = payload.split(':');
  const sig = parts.pop() ?? '';
  if (sig.length !== SIG_LEN) return FOREIGN;
  const head = parts.join(':');
  if (parts[0] === 'v2') {
    if (!keys.verify.some((k) => same(sig, mac(head, k)))) return FOREIGN;
    const exp = parts.pop() ?? '';
    const action = shape(parts.slice(1));
    const expMs = parseInt(exp, 36) * 60_000;
    if (!action || !/^[0-9a-z]+$/.test(exp) || !Number.isFinite(expMs)) return FOREIGN;
    return now > expMs ? { ok: false, why: 'expired', action } : { ok: true, action };
  }
  if (now >= V1_ACCEPTED_UNTIL || !keys.legacy || !same(sig, mac(head, keys.legacy))) return FOREIGN;
  const action = shape(parts);
  return action ? { ok: true, action } : FOREIGN;
}

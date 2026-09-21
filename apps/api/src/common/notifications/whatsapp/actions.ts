import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Button payloads — the strings Meta hands back when someone taps. They are
 * signed, so a tap can only ever act on the leave or the gap WE named in
 * the message; a forged payload fails the signature before any lookup.
 *
 *   lv:a:<leaveId>:<sig>          approve a leave
 *   lv:r:<leaveId>:<sig>          reject a leave
 *   cv:<subId>:<teacherId>:<sig>  assign a cover to a gap
 *   cv:<subId>:skip:<sig>         "decide in the console"
 *   ca:<subId>:<sig>              a substitute acknowledging a cover
 *
 * Meta caps a quick-reply payload at 256 characters and a list row id at
 * 200; two UUIDs plus a 12-hex signature is 92. The key is the app secret:
 * it is already the credential that authenticates the webhook itself.
 */
export type Action =
  | { kind: 'leave'; decision: 'approve' | 'reject'; leaveId: string }
  | { kind: 'cover'; substitutionId: string; teacherId: string | 'skip' }
  | { kind: 'ack'; substitutionId: string };

const SIG_LEN = 12;

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex').slice(0, SIG_LEN);
}

export function leavePayload(decision: 'approve' | 'reject', leaveId: string, secret: string): string {
  const body = `lv:${decision === 'approve' ? 'a' : 'r'}:${leaveId}`;
  return `${body}:${sign(body, secret)}`;
}

export function coverPayload(substitutionId: string, teacherId: string | 'skip', secret: string): string {
  const body = `cv:${substitutionId}:${teacherId}`;
  return `${body}:${sign(body, secret)}`;
}

export function ackPayload(substitutionId: string, secret: string): string {
  const body = `ca:${substitutionId}`;
  return `${body}:${sign(body, secret)}`;
}

/** Null for anything that is not one of ours, or is ours but tampered with. */
export function parseAction(payload: string, secret: string): Action | null {
  const parts = payload.split(':');
  const sig = parts.pop();
  const body = parts.join(':');
  if (!sig || sig.length !== SIG_LEN) return null;
  const want = sign(body, secret);
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (parts[0] === 'lv' && parts.length === 3 && (parts[1] === 'a' || parts[1] === 'r')) {
    return { kind: 'leave', decision: parts[1] === 'a' ? 'approve' : 'reject', leaveId: parts[2] };
  }
  if (parts[0] === 'cv' && parts.length === 3) return { kind: 'cover', substitutionId: parts[1], teacherId: parts[2] };
  if (parts[0] === 'ca' && parts.length === 2) return { kind: 'ack', substitutionId: parts[1] };
  return null;
}

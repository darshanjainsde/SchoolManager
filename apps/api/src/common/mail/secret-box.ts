import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadEnv } from '@skoolos/config';

/**
 * AES-256-GCM for the one secret this product stores on a school's behalf:
 * the password to their own mailbox.
 *
 * WHAT THIS BUYS AND WHAT IT DOES NOT (the honest version, per the repo's
 * "name the new failure mode" rule): letting schools send from their own
 * mailbox means holding a live credential, which a database dump would
 * otherwise hand over wholesale. Encrypting at rest with a key that lives only
 * in the environment separates the two — an attacker needs the dump AND the
 * running environment. It does NOT protect against an attacker who already has
 * code execution on the API, and it never will; that is the accepted ceiling.
 *
 * GCM (not CBC) because we need tamper-evidence: a flipped ciphertext bit must
 * fail loudly at decrypt rather than silently produce a wrong password that
 * then gets typed at someone's SMTP server.
 *
 * Wire format: `v1.<iv-b64>.<tag-b64>.<ciphertext-b64>` — versioned so a future
 * key rotation can recognise and re-wrap old values instead of guessing.
 */

const VERSION = 'v1';

function key(): Buffer | null {
  const raw = loadEnv().EMAIL_SECRET_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  // Accept hex or base64 so operators can paste whatever their generator gave.
  const buf = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) {
    throw new Error('EMAIL_SECRET_KEY must decode to 32 bytes (64 hex chars or base64 of 32 bytes)');
  }
  return buf;
}

/** Whether custom senders can be stored at all in this environment. */
export function secretBoxAvailable(): boolean {
  try {
    return key() !== null;
  } catch {
    // A malformed key is not "unavailable" — it is a misconfiguration the
    // operator must see. Surface it at the point of use, not here.
    return true;
  }
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error('EMAIL_SECRET_KEY is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

/**
 * Returns null rather than throwing when the value cannot be read — a school
 * whose credential is unreadable (key rotated, row copied between
 * environments) must fall back to the platform sender, not break every email
 * that school sends.
 */
export function decryptSecret(packed: string | null | undefined): string | null {
  if (!packed) return null;
  try {
    const k = key();
    if (!k) return null;
    const [version, ivB64, tagB64, dataB64] = packed.split('.');
    if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) return null;
    const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

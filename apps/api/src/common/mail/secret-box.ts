import { mailKeyFrom, openMailSecret, sealMailSecret } from '../crypto/machine-secrets';
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

function key(): Buffer | null {
  return mailKeyFrom(loadEnv().EMAIL_SECRET_KEY);
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
  return sealMailSecret(k, plain);
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
    return openMailSecret(key(), packed);
  } catch {
    return null;
  }
}

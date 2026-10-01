import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * SECRETS LOCKED TO ONE MACHINE.
 *
 * A school stores two credentials we must be able to use but never show:
 *  - payment-gateway secrets (SchoolPaymentConfig.secrets), locked with a key
 *    derived from FEES_SECRET_KEY and the school's id;
 *  - the password to the school's own mailbox (EmailSettings.smtpPassEnc),
 *    locked with EMAIL_SECRET_KEY.
 *
 * Both keys live only in a server's environment, so a sealed value is
 * unreadable on any other machine. That is the point for a database dump —
 * and the problem for a school backup that must work anywhere. The backup
 * engine therefore OPENS these with the source machine's keys, carries the
 * plaintext inside the password-locked .sckools file, and SEALS them again
 * with the target machine's keys.
 *
 * These are the only two sealing schemes in the API. Every place that seals or
 * opens one calls a function here, so the backup engine and the feature that
 * wrote the value can never disagree about the format. A test fails if a new
 * file starts calling createCipheriv without registering here.
 */

/* ── Fee gateway secrets: AES-256-GCM, key = scrypt(master, "fees:<schoolId>") ── */

const feeKey = (master: string, schoolId: string): Buffer => scryptSync(master, `fees:${schoolId}`, 32);

/** Wire format `iv.tag.ciphertext`, each base64. */
export function sealFeeSecret(master: string, schoolId: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', feeKey(master, schoolId), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

/** Throws when the value was sealed under a different key or school. */
export function openFeeSecret(master: string, schoolId: string, blob: string): string {
  const [iv, tag, data] = blob.split('.');
  if (!iv || !tag || data === undefined) throw new Error('not a sealed fee secret');
  const decipher = createDecipheriv('aes-256-gcm', feeKey(master, schoolId), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/* ── School mailbox password: AES-256-GCM with EMAIL_SECRET_KEY, `v1.iv.tag.ct` ── */

const MAIL_VERSION = 'v1';

/** Accepts hex or base64 of 32 bytes; null when unset. Throws on a malformed key. */
export function mailKeyFrom(raw: string | undefined | null): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) {
    throw new Error('EMAIL_SECRET_KEY must decode to 32 bytes (64 hex chars or base64 of 32 bytes)');
  }
  return buf;
}

export function sealMailSecret(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [MAIL_VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

/** Returns null when the value cannot be read — wrong key, damaged, or not a sealed value. */
export function openMailSecret(key: Buffer | null, packed: string | null | undefined): string | null {
  if (!packed || !key) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = packed.split('.');
    if (version !== MAIL_VERSION || !ivB64 || !tagB64 || dataB64 === undefined) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

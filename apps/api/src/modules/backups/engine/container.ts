import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * THE .sckools FILE — one school, sealed with a password the operator holds.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ HEADER   "SCKOOLS\x01" · u32 length · JSON (kdf, nonce, check) │  plaintext
 *   │ CHUNK 0  u32 length · AES-256-GCM(ciphertext ‖ tag)            │
 *   │ CHUNK 1  …                                                     │  every entry
 *   │ …                                                              │  starts on a
 *   │ CHUNK n  the TRAILER (index + manifest), sealed as FINAL       │  chunk boundary
 *   │ FOOTER   "SCKOOLS\xFF" · u64 trailer offset · u32 counter      │  plaintext
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Why this shape, and not a gzip of a JSON blob:
 *  - It is WRITTEN IN STEPS. A request may run 60 s and a school can take
 *    longer, so the writer must be able to stop after any chunk and carry on in
 *    a later request from a few numbers (counter, offset). Every chunk is
 *    sealed on its own, so nothing about chunk N depends on chunk N-1.
 *  - It is READ BY SEEKING. The trailer at the end lists where every entry
 *    starts, so an import can load tables in whatever order the TARGET
 *    machine's schema needs — which may differ from the order they were
 *    written in, if the target runs newer code.
 *  - It cannot be quietly cut short or re-ordered. The nonce of every chunk
 *    carries its position and whether it is the last one, so a chunk moved,
 *    dropped or replayed fails authentication, and a file truncated before its
 *    final chunk has no valid trailer at all.
 *  - The key comes from a PASSWORD (scrypt), never from a server secret, so the
 *    file opens on any machine whose operator knows the password — and on none
 *    whose operator does not.
 */

export const MAGIC = Buffer.from('SCKOOLS\x01', 'latin1');
export const FOOTER_MAGIC = Buffer.from('SCKOOLS\xff', 'latin1');
export const FORMAT = 1;
export const FOOTER_BYTES = FOOTER_MAGIC.length + 8 + 4;
export const TAG_BYTES = 16;
/** A plaintext chunk never exceeds this; big entries span several chunks. */
export const CHUNK_BYTES = 1024 * 1024;
/** The trailer is one final chunk; bounded so a corrupt length cannot OOM a reader. */
export const MAX_TRAILER_BYTES = 64 * 1024 * 1024;

export interface KdfParams { name: 'scrypt'; N: number; r: number; p: number; salt: string }
export interface Header {
  format: number;
  kdf: KdfParams;
  /** 7 random bytes, base64. Nonce = prefix ‖ u32 counter ‖ u8 final. */
  nonce: string;
  /** HMAC(key, 'sckools-check') — tells "wrong password" apart from "damaged file". */
  check: string;
}

export class ArchiveError extends Error {
  constructor(public readonly code: 'BAD_FORMAT' | 'WRONG_PASSWORD' | 'DAMAGED' | 'TOO_NEW', message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

/** scrypt N=2^15 — ~60 ms on a server core; re-derived once per job step. */
export const DEFAULT_KDF = { N: 1 << 15, r: 8, p: 1 } as const;

export function deriveKey(password: string, kdf: KdfParams): Buffer {
  if (!password) throw new ArchiveError('WRONG_PASSWORD', 'A backup password is required.');
  return scryptSync(password.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, {
    N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r,
  });
}

function checkValue(key: Buffer): string {
  return createHmac('sha256', key).update('sckools-check').digest('base64').slice(0, 16);
}

/** A fresh header for a new archive, and the key it implies. */
export function newHeader(password: string, kdf: { N: number; r: number; p: number } = DEFAULT_KDF): { header: Header; key: Buffer } {
  const params: KdfParams = { name: 'scrypt', ...kdf, salt: randomBytes(16).toString('base64') };
  const key = deriveKey(password, params);
  return { header: { format: FORMAT, kdf: params, nonce: randomBytes(7).toString('base64'), check: checkValue(key) }, key };
}

export function encodeHeader(h: Header): Buffer {
  const json = Buffer.from(JSON.stringify(h), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length);
  return Buffer.concat([MAGIC, len, json]);
}

/** Parses the plaintext header at the start of a file. `buf` must hold at least the header. */
export function decodeHeader(buf: Buffer): { header: Header; bytes: Buffer } {
  if (buf.length < MAGIC.length + 4 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new ArchiveError('BAD_FORMAT', 'This is not a Sckools backup file.');
  }
  const len = buf.readUInt32BE(MAGIC.length);
  if (len > 64 * 1024) throw new ArchiveError('BAD_FORMAT', 'The backup header is damaged.');
  const end = MAGIC.length + 4 + len;
  if (buf.length < end) throw new ArchiveError('BAD_FORMAT', 'The backup file is cut short.');
  let header: Header;
  try {
    header = JSON.parse(buf.subarray(MAGIC.length + 4, end).toString('utf8'));
  } catch {
    throw new ArchiveError('BAD_FORMAT', 'The backup header is damaged.');
  }
  if (typeof header.format !== 'number' || header.format > FORMAT) {
    throw new ArchiveError('TOO_NEW', `This backup uses format ${header.format}; this code reads up to ${FORMAT}. Update the code first.`);
  }
  if (header.kdf?.name !== 'scrypt' || !header.nonce || !header.check) {
    throw new ArchiveError('BAD_FORMAT', 'The backup header is damaged.');
  }
  return { header, bytes: buf.subarray(0, end) };
}

/** Derives the key and proves the password before any chunk is touched. */
export function unlock(header: Header, password: string): Buffer {
  const key = deriveKey(password, header.kdf);
  const want = Buffer.from(header.check);
  const got = Buffer.from(checkValue(key));
  if (want.length !== got.length || !timingSafeEqual(want, got)) {
    throw new ArchiveError('WRONG_PASSWORD', 'That backup password is not the one this file was locked with.');
  }
  return key;
}

/** Binds every chunk to this exact header, so a header swap fails authentication. */
export function headerAad(headerBytes: Buffer): Buffer {
  return createHash('sha256').update(headerBytes).digest();
}

function nonceFor(header: Header, counter: number, final: boolean): Buffer {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffffffff) throw new Error(`chunk counter out of range: ${counter}`);
  const n = Buffer.alloc(12);
  Buffer.from(header.nonce, 'base64').copy(n, 0, 0, 7);
  n.writeUInt32BE(counter, 7);
  n[11] = final ? 1 : 0;
  return n;
}

/** One sealed chunk, length-prefixed, ready to append. */
export function sealChunk(key: Buffer, header: Header, aad: Buffer, counter: number, plain: Buffer, final: boolean): Buffer {
  const cipher = createCipheriv('aes-256-gcm', key, nonceFor(header, counter, final));
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

/** Opens the chunk body (without its length prefix). Throws DAMAGED on any mismatch. */
export function openChunk(key: Buffer, header: Header, aad: Buffer, counter: number, body: Buffer, final: boolean): Buffer {
  if (body.length < TAG_BYTES) throw new ArchiveError('DAMAGED', 'The backup file is damaged (short chunk).');
  try {
    const d = createDecipheriv('aes-256-gcm', key, nonceFor(header, counter, final));
    d.setAAD(aad);
    d.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([d.update(body.subarray(0, body.length - TAG_BYTES)), d.final()]);
  } catch {
    throw new ArchiveError('DAMAGED', 'The backup file is damaged or was changed after it was made.');
  }
}

export function encodeFooter(trailerOffset: number, trailerCounter: number): Buffer {
  const b = Buffer.alloc(FOOTER_BYTES);
  FOOTER_MAGIC.copy(b, 0);
  b.writeBigUInt64BE(BigInt(trailerOffset), FOOTER_MAGIC.length);
  b.writeUInt32BE(trailerCounter, FOOTER_MAGIC.length + 8);
  return b;
}

export function decodeFooter(b: Buffer): { trailerOffset: number; trailerCounter: number } {
  if (b.length !== FOOTER_BYTES || !b.subarray(0, FOOTER_MAGIC.length).equals(FOOTER_MAGIC)) {
    throw new ArchiveError('DAMAGED', 'The backup file is incomplete — it ends before its index. It may have been cut short while copying.');
  }
  return {
    trailerOffset: Number(b.readBigUInt64BE(FOOTER_MAGIC.length)),
    trailerCounter: b.readUInt32BE(FOOTER_MAGIC.length + 8),
  };
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

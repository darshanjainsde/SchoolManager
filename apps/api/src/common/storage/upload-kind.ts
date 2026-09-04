import { ApiError, type ErrorCode } from '../errors/api-error';

/**
 * What an uploaded file actually is, decided from its bytes rather than from
 * what the client said it was.
 *
 * Five upload paths validated only `file.mimetype.startsWith('image/')` — a
 * string the browser sends and anyone can set — and then wrote that same
 * string back as the stored object's Content-Type. `image/svg+xml` passed all
 * of them, and an SVG is a script container: opened directly from the storage
 * origin it executes, which makes it phishing and malware hosting on a domain
 * the school trusts. The gift-attachment path already did this correctly
 * (gifts.service.ts) with an explicit allowlist; this generalises it and adds
 * the part that was missing everywhere — checking the bytes.
 *
 * Magic numbers, not a library: the four raster formats plus PDF are a short,
 * stable list, and a dependency for twenty bytes of comparison is not worth
 * the supply-chain surface on an upload path.
 */

export type UploadKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf';

const SNIFFERS: { kind: UploadKind; mime: string; test: (b: Buffer) => boolean }[] = [
  { kind: 'png',  mime: 'image/png',  test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { kind: 'jpeg', mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'gif',  mime: 'image/gif',  test: (b) => b.length >= 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a') },
  // RIFF....WEBP — the size field sits between the two markers.
  { kind: 'webp', mime: 'image/webp', test: (b) => b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { kind: 'pdf',  mime: 'application/pdf', test: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export const IMAGE_KINDS: UploadKind[] = ['png', 'jpeg', 'gif', 'webp'];
export const IMAGE_OR_PDF_KINDS: UploadKind[] = [...IMAGE_KINDS, 'pdf'];

/** The sniffed kind, or null when the bytes match nothing we accept. */
export function sniffUploadKind(buffer: Buffer): { kind: UploadKind; mime: string } | null {
  for (const s of SNIFFERS) {
    if (s.test(buffer)) return { kind: s.kind, mime: s.mime };
  }
  return null;
}

/**
 * Accept the file only if its BYTES are one of `allowed`, and return the
 * content type to store — derived from the bytes, never from the request, so
 * a mislabelled or hostile upload cannot choose how it is later served.
 */
export interface UploadRejection {
  /** Keep each call site's existing error contract — these already differ
   *  (photos answered UNSUPPORTED_TYPE/415, fee proofs VALIDATION/400) and
   *  tightening the CHECK should not quietly change the ANSWER. */
  code?: ErrorCode;
  status?: number;
  field?: string;
  message?: string;
}

export function assertUploadKind(
  buffer: Buffer,
  allowed: UploadKind[],
  what = 'file',
  reject: UploadRejection = {},
): { kind: UploadKind; mime: string } {
  const sniffed = sniffUploadKind(buffer);
  if (!sniffed || !allowed.includes(sniffed.kind)) {
    const names = allowed.map((k) => (k === 'jpeg' ? 'JPG' : k.toUpperCase())).join(', ');
    throw new ApiError(
      reject.code ?? 'UNSUPPORTED_FILE_TYPE',
      reject.message ?? `That ${what} must be one of: ${names}.`,
      reject.status ?? 400,
      reject.field,
    );
  }
  return sniffed;
}

import { sniffUploadKind, assertUploadKind, IMAGE_KINDS, IMAGE_OR_PDF_KINDS } from './upload-kind';

const png  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const gif  = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(8)]);
const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')]);
const pdf  = Buffer.concat([Buffer.from('%PDF-1.7', 'latin1'), Buffer.alloc(8)]);

/** The payload the old `startsWith('image/')` check waved through. */
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>',
  'utf8',
);

describe('sniffUploadKind', () => {
  it.each([
    ['png', png], ['jpeg', jpeg], ['gif', gif], ['webp', webp], ['pdf', pdf],
  ])('recognises %s from its bytes', (kind, buf) => {
    expect(sniffUploadKind(buf)?.kind).toBe(kind);
  });

  it('does not recognise an SVG, whatever the client called it', () => {
    // This is the whole point. An SVG is a script container: served from the
    // storage origin and opened directly, it executes.
    expect(sniffUploadKind(svg)).toBeNull();
  });

  it('does not recognise an HTML page', () => {
    expect(sniffUploadKind(Buffer.from('<!doctype html><script>1</script>', 'utf8'))).toBeNull();
  });

  it('handles a buffer too short to hold any signature', () => {
    expect(sniffUploadKind(Buffer.from([0xff]))).toBeNull();
    expect(sniffUploadKind(Buffer.alloc(0))).toBeNull();
  });

  it('is not fooled by a PNG signature that appears later in the file', () => {
    const late = Buffer.concat([Buffer.from('not-an-image'), png]);
    expect(sniffUploadKind(late)).toBeNull();
  });
});

describe('assertUploadKind', () => {
  it('returns the content type derived from the BYTES, not the request', () => {
    // The stored Content-Type must never be a string the caller chose, or a
    // hostile upload picks how it is served back.
    expect(assertUploadKind(png, IMAGE_KINDS).mime).toBe('image/png');
  });

  it('rejects an SVG even when images are allowed', () => {
    expect(() => assertUploadKind(svg, IMAGE_KINDS)).toThrow(/must be one of/);
  });

  it('rejects a PDF where only images are allowed', () => {
    expect(() => assertUploadKind(pdf, IMAGE_KINDS)).toThrow(/must be one of/);
  });

  it('accepts a PDF where PDFs are allowed', () => {
    expect(assertUploadKind(pdf, IMAGE_OR_PDF_KINDS).kind).toBe('pdf');
  });

  it('names the accepted formats in the message, so the error is actionable', () => {
    expect(() => assertUploadKind(svg, IMAGE_KINDS, 'photo')).toThrow(/PNG, JPG, GIF, WEBP/);
    expect(() => assertUploadKind(svg, IMAGE_KINDS, 'photo')).toThrow(/photo/);
  });

  it('answers 400, not 500 — a bad upload is the caller’s mistake', () => {
    try {
      assertUploadKind(svg, IMAGE_KINDS);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { getStatus?: () => number }).getStatus?.()).toBe(400);
    }
  });
});

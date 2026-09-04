import { PRIVATE_PREFIXES } from './storage.service';

/**
 * Which key prefixes belong in the private bucket.
 *
 * The public bucket answers an unsigned GET of
 * /object/public/<bucket>/<key> — verified against both staging and
 * production during the 4 Sept 2026 audit, on a real uploaded document. That
 * is correct for site media and wrong for a parent's bank screenshot or an
 * exam paper that has not been sat yet.
 */
describe('private key prefixes', () => {
  const match = (key: string) =>
    PRIVATE_PREFIXES.some((p) => key.startsWith(p) || key.includes(`/${p}`));

  it('covers print orders, wherever the prefix sits in the key', () => {
    expect(match('print-orders/school-1/abc-Maths_Final.pdf')).toBe(true);
  });

  it('covers fee proofs, which are nested under the school', () => {
    expect(match('schools/school-1/fee-proofs/abc-screenshot.png')).toBe(true);
  });

  it('leaves genuine site media public — that content is meant to be served', () => {
    for (const key of [
      'schools/s1/logo/abc.png',
      'schools/s1/hero/abc.jpg',
      'schools/s1/gallery/abc.jpg',
      'schools/s1/staff/abc.jpg',
    ]) {
      expect(match(key)).toBe(false);
    }
  });

  // Documented gap rather than a silent one. Avatars and gift attachments are
  // resolved from a stored public URL rather than presigned on read, so moving
  // them needs a read-path change across the UI — a product decision, not a
  // one-line security fix.
  it('does not yet cover avatars or gift attachments', () => {
    expect(match('schools/s1/avatar/abc.jpg')).toBe(false);
    expect(match('schools/s1/gifts/p1/abc.jpg')).toBe(false);
  });

  it('names exactly the two categories that already presign on read', () => {
    expect([...PRIVATE_PREFIXES].sort()).toEqual(['fee-proofs/', 'print-orders/']);
  });
});

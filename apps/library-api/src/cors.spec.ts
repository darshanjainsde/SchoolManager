import { isAllowedOrigin } from './cors';

/**
 * The origin check is the only thing standing between "any website can drive a
 * librarian's session" and not, so the rejections matter more than the
 * acceptances. Each rejected case below is a real way an unanchored or
 * unescaped regex leaks.
 */
describe('isAllowedOrigin', () => {
  it.each([
    'https://library.trackyour.in',
    'https://raffles.library.trackyour.in',
    'https://northgate.library.trackyour.in',
    'https://library-web-abc123-finokraft.vercel.app',
  ])('allows %s', (origin) => {
    expect(isAllowedOrigin(origin, true)).toBe(true);
  });

  it.each([
    ['a suffix attack', 'https://library.trackyour.in.evil.com'],
    ['a prefix attack', 'https://notlibrary.trackyour.in'],
    ['a lookalike domain', 'https://library.trackyour.in.co'],
    ['plain http on the real domain', 'http://raffles.library.trackyour.in'],
    ['a different site entirely', 'https://evil.com'],
    ['the dot treated as any-char', 'https://libraryXtrackyour.in'],
  ])('rejects %s', (_label, origin) => {
    expect(isAllowedOrigin(origin, true)).toBe(false);
  });

  it('allows a request with no Origin at all — curl, health checks, server-to-server', () => {
    expect(isAllowedOrigin(undefined, true)).toBe(true);
  });

  it('allows localhost in development but NOT in production', () => {
    expect(isAllowedOrigin('http://localhost:3000', false)).toBe(true);
    expect(isAllowedOrigin('http://localhost:3000', true)).toBe(false);
  });
});

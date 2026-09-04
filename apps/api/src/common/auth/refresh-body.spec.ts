import { shouldEchoRefreshToken, shapeTokenResponse } from './refresh-body';

const req = (headers: Record<string, string | undefined>) => ({ headers } as never);
const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };

describe('who still gets the refresh token in the body', () => {
  it('withholds it from a browser, which has the HttpOnly cookie instead', () => {
    expect(shouldEchoRefreshToken(req({ origin: 'https://raffles.sckools.com' }))).toBe(false);
  });

  it('gives it to a native client, which has no cookie jar', () => {
    // apps/mobile reads tokens.refreshToken at login and replays it on
    // refresh. Dropping it here would break every mobile sign-in.
    expect(shouldEchoRefreshToken(req({}))).toBe(true);
  });

  it('honours an explicit native opt-in even when an Origin is present', () => {
    expect(shouldEchoRefreshToken(req({ origin: 'https://x', 'x-skoolos-client': 'native' }))).toBe(true);
  });

  it('honours an explicit browser declaration even with no Origin', () => {
    expect(shouldEchoRefreshToken(req({ 'x-skoolos-client': 'browser' }))).toBe(false);
  });

  it('is case-insensitive about the opt-in value', () => {
    expect(shouldEchoRefreshToken(req({ origin: 'https://x', 'x-skoolos-client': 'NATIVE' }))).toBe(true);
  });
});

describe('shapeTokenResponse', () => {
  it('removes only the refresh token, leaving the session usable', () => {
    const out = shapeTokenResponse(TOKENS, req({ origin: 'https://raffles.sckools.com' }));
    expect(out).toEqual({ accessToken: 'a', expiresIn: 900 });
    expect('refreshToken' in out).toBe(false);
  });

  it('passes everything through for a native client', () => {
    expect(shapeTokenResponse(TOKENS, req({}))).toEqual(TOKENS);
  });

  it('does not mutate the tokens it was handed', () => {
    shapeTokenResponse(TOKENS, req({ origin: 'https://x' }));
    expect(TOKENS.refreshToken).toBe('r');
  });
});

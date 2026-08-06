import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient } from './api';

/**
 * A RELOAD MUST NOT COST SOMEBODY THEIR PASSWORD.
 *
 * The refresh token ROTATES: `auth.service` mints a new one and marks the old
 * revoked. The in-flight dedupe lived on the instance, and `useApi()` builds an
 * ApiClient per component — 78 files call it, so a layout and its page each
 * hold their own.
 *
 * So on reload: several queries fire with no access token, each 401s, and TWO
 * clients start a refresh with the SAME cookie token. The first rotates and
 * revokes it; the second arrives with a revoked token, 401s, and calls
 * onUnauthenticated — which clears the store to 'anon' and bounces every
 * console to /login. A warm navigation never showed it, because there is
 * already an access token and nothing 401s.
 *
 * The dedupe therefore has to be shared by every client that could be holding
 * the same cookie.
 */
const OK = { accessToken: 'new-access', refreshToken: 'new-refresh' };

function makeClient(onUnauthenticated?: () => void) {
  return new ApiClient({
    baseUrl: 'https://api.test',
    audience: 'school',
    getAccessToken: () => undefined,
    getRefreshToken: () => undefined,
    setTokens: vi.fn(),
    onUnauthenticated,
  });
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('two clients reloading the same page', () => {
  it('spends the rotating refresh token ONCE, not once per client', async () => {
    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/auth/refresh')) {
          refreshCalls += 1;
          // The rotation the server really does: the second caller would be
          // presenting a token the first one just revoked.
          if (refreshCalls > 1) return new Response('revoked', { status: 401 });
          return new Response(JSON.stringify(OK), { status: 200 });
        }
        return new Response('unauthorised', { status: 401 });
      }),
    );

    const a = makeClient();
    const b = makeClient();
    // Both hit a 401 at the same instant, exactly as two ungated queries do.
    await Promise.allSettled([a.get('/me/profile'), b.get('/manage/classes')]);

    expect(refreshCalls).toBe(1);
  });

  it('does not sign the user out when the second client loses the race', async () => {
    const onUnauthenticated = vi.fn();
    let refreshCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/auth/refresh')) {
          refreshCalls += 1;
          if (refreshCalls > 1) return new Response('revoked', { status: 401 });
          return new Response(JSON.stringify(OK), { status: 200 });
        }
        return new Response('unauthorised', { status: 401 });
      }),
    );

    const a = makeClient(onUnauthenticated);
    const b = makeClient(onUnauthenticated);
    await Promise.allSettled([a.get('/me/profile'), b.get('/manage/classes')]);

    // This is the bug the user reported: a valid session cleared on reload.
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('still signs out when the refresh genuinely fails', async () => {
    const onUnauthenticated = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    const a = makeClient(onUnauthenticated);
    await a.get('/me/profile').catch(() => {});
    expect(onUnauthenticated).toHaveBeenCalled();
  });
});

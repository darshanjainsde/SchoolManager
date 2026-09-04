import type { Request, Response } from 'express';
import {
  SCHOOL_REFRESH_COOKIE,
  clearRefreshCookie,
  firstValidToken,
  readCookie,
  readCookies,
  resolveRefreshToken,
  resolveRefreshTokens,
  setRefreshCookie,
  schoolRefreshCookie,
  resolveSchoolRefreshTokens,
} from './refresh-cookie';

const prodEnv = { PLATFORM_HOST: 'sckools.com', JWT_REFRESH_TTL: 2_592_000, NODE_ENV: 'production' };
const devEnv = { PLATFORM_HOST: 'localhost', JWT_REFRESH_TTL: 2_592_000, NODE_ENV: 'development' };

function req(cookieHeader?: string): Request {
  return { headers: cookieHeader ? { cookie: cookieHeader } : {} } as unknown as Request;
}

function res(): Response & { cookie: jest.Mock; clearCookie: jest.Mock } {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
}

describe('readCookie', () => {
  it('finds the value among several cookies', () => {
    expect(readCookie(req('a=1; skoolos_rt=abc123; b=2'), SCHOOL_REFRESH_COOKIE)).toBe('abc123');
  });

  it('is undefined when the cookie or the header is absent', () => {
    expect(readCookie(req('other=1'), SCHOOL_REFRESH_COOKIE)).toBeUndefined();
    expect(readCookie(req(), SCHOOL_REFRESH_COOKIE)).toBeUndefined();
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    expect(readCookie(req('not_skoolos_rt=nope'), SCHOOL_REFRESH_COOKIE)).toBeUndefined();
  });

  it('decodes percent-encoded values', () => {
    expect(readCookie(req('skoolos_rt=a%2Bb'), SCHOOL_REFRESH_COOKIE)).toBe('a+b');
  });
});

describe('resolveRefreshToken', () => {
  it('prefers the cookie over the body', () => {
    expect(resolveRefreshToken(req('skoolos_rt=from-cookie'), SCHOOL_REFRESH_COOKIE, 'from-body')).toBe(
      'from-cookie',
    );
  });

  it('falls back to the body — the migration path for pre-cookie sessions', () => {
    expect(resolveRefreshToken(req(), SCHOOL_REFRESH_COOKIE, 'from-body')).toBe('from-body');
  });

  it('is undefined when neither is present', () => {
    expect(resolveRefreshToken(req(), SCHOOL_REFRESH_COOKIE, undefined)).toBeUndefined();
  });
});

describe('setRefreshCookie', () => {
  it('is HttpOnly, Secure, Lax and scoped to the parent domain in production', () => {
    const r = res();
    setRefreshCookie(r, SCHOOL_REFRESH_COOKIE, 'tok', prodEnv);
    expect(r.cookie).toHaveBeenCalledWith('skoolos_rt', 'tok', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: '.sckools.com',
      maxAge: 2_592_000_000,
    });
  });

  it('drops the domain and Secure flag on localhost, where neither works', () => {
    const r = res();
    setRefreshCookie(r, SCHOOL_REFRESH_COOKIE, 'tok', devEnv);
    expect(r.cookie).toHaveBeenCalledWith(
      'skoolos_rt',
      'tok',
      expect.objectContaining({ domain: undefined, secure: false }),
    );
  });
});

describe('clearRefreshCookie', () => {
  it('clears with the same attributes it was set with, or the browser keeps it', () => {
    const r = res();
    clearRefreshCookie(r, SCHOOL_REFRESH_COOKIE, prodEnv);
    expect(r.clearCookie).toHaveBeenCalledWith('skoolos_rt', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: '.sckools.com',
    });
  });
});

/**
 * The bug these cover, in one sentence: a cookie NAME does not identify one
 * cookie.
 *
 * A browser stores one cookie per (name, domain, path) and sends every match in
 * a single header, with no way for the server to tell them apart. A stale
 * `skoolos_rt` from an earlier deploy sat beside the live one under different
 * attributes — `Set-Cookie` could not overwrite it and `clearCookie` could not
 * remove it — and the reader returned whichever came first. That was the dead
 * one, so every refresh answered 401, every session died at the next page load,
 * and signing out could not clear it.
 *
 * Proven on staging before the fix: logout, then a fresh login returning a new
 * Set-Cookie, then refresh — still 401, never the 403 that a genuinely absent
 * cookie gives. Those three distinct answers (403 / 401 / 200) are what let the
 * cause be pinned down, which is why the 403-vs-401 split is asserted below.
 */
describe('duplicate cookies under one name', () => {
  it('readCookies returns EVERY value, in header order', () => {
    // The single-value read is the bug. If this ever returns one again, the
    // stale-cookie loop is back.
    expect(readCookies(req('skoolos_rt=stale; other=1; skoolos_rt=fresh'), SCHOOL_REFRESH_COOKIE)).toEqual([
      'stale',
      'fresh',
    ]);
  });

  it('readCookies is empty when the name is absent, and never throws on a bare header', () => {
    expect(readCookies(req('other=1'), SCHOOL_REFRESH_COOKIE)).toEqual([]);
    expect(readCookies(req(), SCHOOL_REFRESH_COOKIE)).toEqual([]);
  });

  it('readCookie still returns the first, so old callers are unchanged', () => {
    expect(readCookie(req('skoolos_rt=stale; skoolos_rt=fresh'), SCHOOL_REFRESH_COOKIE)).toBe('stale');
  });

  it('resolveRefreshTokens puts every cookie before the body token', () => {
    // Cookies first: the body token only exists for pre-cookie sessions being
    // migrated, so it is the least likely to be live.
    expect(
      resolveRefreshTokens(req('skoolos_rt=a; skoolos_rt=b'), SCHOOL_REFRESH_COOKIE, 'from-body'),
    ).toEqual(['a', 'b', 'from-body']);
  });

  it('resolveRefreshTokens dedupes, so the same value is never tried twice', () => {
    // A browser holding one value under two attribute sets would otherwise cost
    // two round trips to prove the same token invalid.
    expect(resolveRefreshTokens(req('skoolos_rt=same; skoolos_rt=same'), SCHOOL_REFRESH_COOKIE, 'same')).toEqual([
      'same',
    ]);
  });

  it('resolveRefreshTokens is empty when nothing is offered — a 403, not a 401', () => {
    expect(resolveRefreshTokens(req(), SCHOOL_REFRESH_COOKIE, undefined)).toEqual([]);
  });

  it('resolveRefreshToken still returns the single best, so old callers are unchanged', () => {
    expect(resolveRefreshToken(req('skoolos_rt=a; skoolos_rt=b'), SCHOOL_REFRESH_COOKIE)).toBe('a');
  });
});

describe('firstValidToken', () => {
  it('accepts the SECOND candidate when the first is stale — the whole point', () => {
    // This is the case that shipped broken: the live cookie sat behind a dead
    // one and was never tried.
    const attempt = jest.fn(async (t: string) => {
      if (t !== 'fresh') throw new Error('Invalid refresh token');
      return { accessToken: 'ok' };
    });
    return expect(firstValidToken(['stale', 'fresh'], attempt)).resolves.toEqual({ accessToken: 'ok' });
  });

  it('stops at the first success and does not spend later tokens', async () => {
    // Every attempt rotates a token server-side, so trying past a success would
    // revoke a session that had just been renewed.
    const attempt = jest.fn(async () => ({ accessToken: 'ok' }));
    await firstValidToken(['a', 'b', 'c'], attempt);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('rethrows the LAST error when every candidate fails', async () => {
    // The last candidate is the body token when one was sent, and its error
    // describes the session the caller believes it has.
    const attempt = jest.fn(async (t: string) => {
      throw new Error(`rejected ${t}`);
    });
    await expect(firstValidToken(['a', 'b'], attempt)).rejects.toThrow('rejected b');
  });

  it('tries every candidate before giving up', async () => {
    const attempt = jest.fn(async () => {
      throw new Error('nope');
    });
    await expect(firstValidToken(['a', 'b', 'c'], attempt)).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});

/**
 * Two schools signed in on one browser.
 *
 * The parent-domain scope is required (the API lives on a different subdomain
 * from the schools), so every school's session used to land under ONE cookie
 * key. The browser sent both, refresh took whichever validated first, and the
 * second school's console rendered while every request 401'd with "Token does
 * not match this tenant" — reproduced on production with an owner
 * impersonation. Signing out of one school also deleted the other's cookie,
 * because clearCookie can only address the shared key.
 *
 * Per-school NAMES fix both, while keeping the domain the API needs.
 */
describe('per-school refresh cookies', () => {
  it('gives each school its own cookie name', () => {
    expect(schoolRefreshCookie('raffles')).toBe('skoolos_rt_raffles');
    expect(schoolRefreshCookie('beacon')).toBe('skoolos_rt_beacon');
    expect(schoolRefreshCookie('raffles')).not.toBe(schoolRefreshCookie('beacon'));
  });

  it('never lets a slug forge a second cookie', () => {
    // A name carrying '=' or ';' would inject into the Set-Cookie header.
    const forged = schoolRefreshCookie('bad=x; skoolos_rt');
    expect(forged).toBe('skoolos_rt_badxskoolosrt');
    expect(forged).not.toMatch(/[=;\s]/);
    expect(schoolRefreshCookie('!!!')).toBe('skoolos_rt');
  });

  it('reads only THIS school’s cookie ahead of the legacy shared one', () => {
    const header = 'skoolos_rt=raffles-legacy; skoolos_rt_beacon=beacon-own; skoolos_rt_raffles=raffles-own';

    // Beacon sees its own token first; the shared cookie is still offered last
    // (it may hold a pre-migration session) but never ahead of its own.
    expect(resolveSchoolRefreshTokens(req(header), 'beacon')).toEqual(['beacon-own', 'raffles-legacy']);
    expect(resolveSchoolRefreshTokens(req(header), 'raffles')).toEqual(['raffles-own', 'raffles-legacy']);
  });

  it('still finds a pre-migration session stored under the shared name', () => {
    expect(resolveSchoolRefreshTokens(req('skoolos_rt=old-session'), 'beacon')).toEqual(['old-session']);
  });

  it('offers the body token last, and never duplicates', () => {
    expect(resolveSchoolRefreshTokens(req('skoolos_rt_beacon=a'), 'beacon', 'a')).toEqual(['a']);
    expect(resolveSchoolRefreshTokens(req('skoolos_rt_beacon=a'), 'beacon', 'b')).toEqual(['a', 'b']);
  });
});

describe('Secure is decided by the host, not NODE_ENV', () => {
  // NODE_ENV defaults to 'development' in the config schema, so keying Secure
  // on it meant one unset variable in a deployed environment shipped a 30-day
  // refresh cookie in cleartext, silently.
  const res = () => {
    const calls: { name: string; token: string; opts: Record<string, unknown> }[] = [];
    return {
      calls,
      cookie: (name: string, token: string, opts: Record<string, unknown>) =>
        calls.push({ name, token, opts }),
    };
  };

  const env = (over: Record<string, unknown>) =>
    ({ PLATFORM_HOST: 'sckools.com', NODE_ENV: 'production', JWT_REFRESH_TTL: 2_592_000, ...over }) as never;

  it('sets Secure on a real host even when NODE_ENV says development', () => {
    const r = res();
    setRefreshCookie(r as never, 'rt', 'tok', env({ NODE_ENV: 'development' }));
    expect(r.calls[0].opts.secure).toBe(true);
  });

  it('omits Secure on localhost, where there is no TLS to require', () => {
    const r = res();
    setRefreshCookie(r as never, 'rt', 'tok', env({ PLATFORM_HOST: 'localhost' }));
    expect(r.calls[0].opts.secure).toBe(false);
  });

  it('omits Secure on a bare IP too', () => {
    const r = res();
    setRefreshCookie(r as never, 'rt', 'tok', env({ PLATFORM_HOST: '127.0.0.1' }));
    expect(r.calls[0].opts.secure).toBe(false);
  });

  it('still sets HttpOnly and SameSite alongside it', () => {
    const r = res();
    setRefreshCookie(r as never, 'rt', 'tok', env({}));
    expect(r.calls[0].opts).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true });
  });
});

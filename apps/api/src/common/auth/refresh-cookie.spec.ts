import type { Request, Response } from 'express';
import {
  SCHOOL_REFRESH_COOKIE,
  clearRefreshCookie,
  readCookie,
  resolveRefreshToken,
  setRefreshCookie,
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

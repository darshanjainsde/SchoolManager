import type { Request, Response } from 'express';

/**
 * The refresh token as an HttpOnly cookie.
 *
 * It used to live in the web app's `localStorage`, which any XSS on any tenant
 * site could read. As a cookie the browser holds it and JavaScript cannot.
 *
 * `api.sckools.com` and every `*.sckools.com` school host share the registrable
 * domain, so a `Domain=.sckools.com` cookie is same-site: `SameSite=Lax` is
 * enough and no third-party-cookie rules apply.
 *
 * School and owner sessions get separate names on purpose — both are scoped to
 * the same parent domain, so one name would let an owner login clobber a school
 * login in the same browser.
 */
export const SCHOOL_REFRESH_COOKIE = 'skoolos_rt';
export const OWNER_REFRESH_COOKIE = 'skoolos_ort';

interface CookieEnv {
  PLATFORM_HOST: string;
  JWT_REFRESH_TTL: number;
  NODE_ENV?: string;
}

/**
 * `.sckools.com` in production so every school subdomain and the API share the
 * cookie; undefined on localhost, where a host-only cookie is what works.
 */
function cookieDomain(env: CookieEnv): string | undefined {
  const host = env.PLATFORM_HOST.toLowerCase().split(':')[0];
  if (host === 'localhost' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return undefined;
  }
  return `.${host}`;
}

export function setRefreshCookie(res: Response, name: string, token: string, env: CookieEnv): void {
  // Belt and braces: writing a literal "undefined" here would hand the browser
  // a cookie that can never refresh, i.e. a silently dead session.
  if (!token) return;
  res.cookie(name, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: cookieDomain(env),
    maxAge: env.JWT_REFRESH_TTL * 1000,
  });
}

export function clearRefreshCookie(res: Response, name: string, env: CookieEnv): void {
  // Same attributes as when it was set, or the browser keeps the old cookie.
  res.clearCookie(name, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    domain: cookieDomain(env),
  });
}

/** Minimal cookie-header parse — avoids pulling cookie-parser into the ncc bundle. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Cookie first, request body second. The body path is what keeps the migration
 * seamless: sessions created before this shipped still have their token in
 * localStorage, and the first refresh that arrives that way is answered with a
 * cookie — after which the client drops its copy.
 */
export function resolveRefreshToken(req: Request, name: string, bodyToken?: string): string | undefined {
  return readCookie(req, name) ?? bodyToken ?? undefined;
}

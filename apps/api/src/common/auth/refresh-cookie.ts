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
 * What that reasoning missed is that a browser can hold SEVERAL cookies under
 * one name — one per (name, domain, path) — and sends them all indistinguishably.
 * The attributes below only ever address a single (Domain=.<host>, Path=/) key,
 * so a copy written under any other attributes can be neither overwritten nor
 * cleared. See `readCookies` for what that cost.
 *
 * School and owner sessions get separate names on purpose — both are scoped to
 * the same parent domain, so one name would let an owner login clobber a school
 * login in the same browser.
 */
export const SCHOOL_REFRESH_COOKIE = 'skoolos_rt';
export const OWNER_REFRESH_COOKIE = 'skoolos_ort';

/**
 * One cookie NAME per school.
 *
 * The parent-domain scope above is not optional: the API lives on
 * `api.<host>` while schools live on `<slug>.<host>`, so a host-scoped cookie
 * would never reach the API at all. But that same scope means every school's
 * session lands under ONE (name, domain, path) key, and a browser signed into
 * two schools sends both indistinguishably. The consequences were real and
 * silent: refresh returned whichever token validated first, so the second
 * school's console rendered while every request 401'd
 * ("Token does not match this tenant"), and signing out of one school deleted
 * the other's cookie because `clearCookie` can only address the shared key.
 *
 * Putting the school in the NAME gives each session its own key while keeping
 * the domain scope the API needs. `SCHOOL_REFRESH_COOKIE` is still read as a
 * fallback so sessions created before this survive — they are re-issued under
 * the per-school name on their next refresh.
 *
 * The slug is `^[a-z0-9-]+$` (enforced at school creation), which is already a
 * valid cookie name; it is filtered here anyway rather than trusted, because a
 * name containing `=` or `;` would let a slug forge a second cookie.
 */
export function schoolRefreshCookie(schoolSlug: string): string {
  const safe = schoolSlug.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return safe ? `${SCHOOL_REFRESH_COOKIE}_${safe}` : SCHOOL_REFRESH_COOKIE;
}

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

/**
 * EVERY value sent under `name`, in header order.
 *
 * A cookie name does not identify one cookie. The browser stores a separate
 * cookie per (name, domain, path), sends all of the matching ones in a single
 * header, and gives the server no way to tell them apart — the Cookie header
 * carries names and values and nothing else.
 *
 * This bit hard. A stale `skoolos_rt` from an earlier deploy sat alongside the
 * current one under different attributes. `Set-Cookie` could not overwrite it
 * (different key) and `clearCookie` could not remove it (it only addresses
 * Domain=.<host> + Path=/), so both went up on every request and the reader
 * below returned whichever came first — the dead one. Every refresh answered
 * 401, every session died at the next page load, and signing out could not
 * clear it. Proven on staging: logout, then login with a fresh Set-Cookie,
 * then refresh — still 401, never the 403 that a genuinely absent cookie gives.
 *
 * So: return them all and let the caller try each. Reading only the first is
 * the bug, not an optimisation.
 */
export function readCookies(req: Request, name: string): string[] {
  const header = req.headers?.cookie;
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      values.push(decodeURIComponent(part.slice(eq + 1).trim()));
    }
  }
  return values;
}

/** The first value sent under `name`. Prefer `readCookies` — see above. */
export function readCookie(req: Request, name: string): string | undefined {
  return readCookies(req, name)[0];
}

/**
 * Every refresh token worth trying, best-first: cookies in header order, then
 * the request body.
 *
 * The body path keeps the migration seamless — sessions created before the
 * cookie shipped still have their token in localStorage, and the first refresh
 * that arrives that way is answered with a cookie, after which the client drops
 * its copy.
 *
 * Deduped, because a browser holding the same value under two attribute sets
 * would otherwise make the caller spend two round trips proving the same token
 * invalid.
 *
 * An empty array means no token was offered at all, which is a 403 ("No refresh
 * token"). That is a different answer from a token that was offered and
 * rejected (401), and callers must keep them distinct — collapsing the two is
 * what made this bug look like an expired session for months.
 */
export function resolveRefreshTokens(req: Request, name: string, bodyToken?: string): string[] {
  const candidates = readCookies(req, name);
  if (bodyToken) candidates.push(bodyToken);
  return [...new Set(candidates.filter(Boolean))];
}

/** The single best refresh token. Prefer `resolveRefreshTokens` — see above. */
export function resolveRefreshToken(req: Request, name: string, bodyToken?: string): string | undefined {
  return resolveRefreshTokens(req, name, bodyToken)[0];
}

/**
 * Runs `attempt` over each candidate and returns the first success.
 *
 * If every candidate fails, the LAST error is rethrown rather than the first:
 * the last candidate is the body token when one was sent, and its error is the
 * one that describes the session the caller actually believes it has.
 *
 * Callers must reject an empty `candidates` themselves — "nothing was offered"
 * is a 403, not a failed attempt, and this helper deliberately cannot tell the
 * difference.
 */
export async function firstValidToken<T>(
  candidates: string[],
  attempt: (token: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const token of candidates) {
    try {
      return await attempt(token);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * Every refresh token this browser might hold for ONE school: its own cookie
 * first, then the legacy shared cookie (a session from before per-school
 * names), then the body token.
 *
 * Order matters — the school's own cookie is the one that certainly belongs to
 * it, so it is tried before the shared name that may carry another school's
 * session. `AuthService.refresh` rejects a token whose schoolId does not match
 * the tenant, so a stale shared cookie can only ever be skipped, never
 * accepted.
 */
export function resolveSchoolRefreshTokens(
  req: Request,
  schoolSlug: string,
  bodyToken?: string,
): string[] {
  const own = readCookies(req, schoolRefreshCookie(schoolSlug));
  const legacy = readCookies(req, SCHOOL_REFRESH_COOKIE);
  const all = [...own, ...legacy];
  if (bodyToken) all.push(bodyToken);
  return [...new Set(all.filter(Boolean))];
}

import type { Request } from 'express';

/**
 * Should this response echo the refresh token in its JSON body?
 *
 * The refresh token is delivered as an HttpOnly cookie so that script running
 * on a tenant page cannot read it — `refresh-cookie.ts` says exactly that, and
 * the console's CSP ships `script-src 'self' 'unsafe-inline'`, so an injected
 * inline script is the threat the cookie exists to survive. Echoing the same
 * token in the response body hands it straight back: any script could call
 * /auth/refresh with credentials and read a fresh 30-day token out of the JSON.
 *
 * It cannot simply be deleted. apps/mobile/src/lib/api.ts reads
 * `tokens.refreshToken` at login and replays it on refresh — React Native has
 * no cookie jar doing this for it, so removing the field would break every
 * mobile sign-in, including builds already on phones.
 *
 * So: browsers get the cookie only, native clients still get the body.
 *
 * A browser always sends `Origin` on a cross-origin XHR, and the web app is
 * always cross-origin to the API host. React Native's fetch does not send one.
 * That makes `Origin` a reliable "is this a browser" signal here, and it fails
 * in the safe direction: an unrecognised client that does send Origin loses the
 * body copy but still has the cookie, while one that does not send Origin was
 * never protected by a cookie anyway.
 *
 * `X-Skoolos-Client: native` is the explicit opt-in for clients that would
 * rather say so than be inferred.
 */
export function shouldEchoRefreshToken(req: Pick<Request, 'headers'>): boolean {
  const client = String(req.headers['x-skoolos-client'] ?? '').trim().toLowerCase();
  if (client === 'native') return true;
  if (client === 'browser') return false;
  return !req.headers.origin;
}

/** Strip `refreshToken` unless this caller needs it in the body. */
export function shapeTokenResponse<T extends { refreshToken?: string }>(
  tokens: T,
  req: Pick<Request, 'headers'>,
): T | Omit<T, 'refreshToken'> {
  if (shouldEchoRefreshToken(req)) return tokens;
  const { refreshToken: _dropped, ...rest } = tokens;
  return rest;
}

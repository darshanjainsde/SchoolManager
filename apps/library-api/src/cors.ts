/**
 * Which browser origins may call this API.
 *
 * The console is served from a DIFFERENT origin to the API — the tenant's own
 * subdomain (`raffles.library.trackyour.in`) talking to `api.library…` — so
 * every request it makes is cross-origin and preflighted. Without CORS the
 * browser blocks all of them and the console shows "Could not reach the
 * library" while the API is perfectly healthy.
 *
 * This was invisible until the console was driven in a real browser: curl does
 * not preflight, so every check against the deployed API passed while the
 * product was unusable.
 *
 * A regex rather than a fixed list because tenants are wildcard subdomains and
 * there is no enumerable set of them. It is anchored at both ends and escapes
 * the dots, so `library.trackyour.in.evil.com` and
 * `notlibrary.trackyour.in` are both rejected — an unanchored or unescaped
 * pattern here would let any host with the right substring through.
 */
const TENANT_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?library\.trackyour\.in$/;

/** Vercel preview builds of the console, e.g. `library-web-abc123-finokraft.vercel.app`. */
const PREVIEW_ORIGIN = /^https:\/\/library-web-[a-z0-9-]+\.vercel\.app$/;

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function isAllowedOrigin(origin: string | undefined, isProduction: boolean): boolean {
  // A request with no Origin header is not a browser cross-origin request at
  // all — curl, a health check, a server-to-server call. CORS has nothing to
  // say about those, and rejecting them would break `/ready`.
  if (!origin) return true;

  if (TENANT_ORIGIN.test(origin) || PREVIEW_ORIGIN.test(origin)) return true;
  return !isProduction && LOCAL_ORIGIN.test(origin);
}

/**
 * Headers the console actually sends. `X-Library-Host` carries the tenant and
 * `Idempotency-Key` guards double-scans; both are custom, so both must be
 * listed or the preflight fails even when the origin is allowed.
 *
 * `credentials` is deliberately NOT enabled: the access token travels in the
 * Authorization header, never in a cookie, so the API has no reason to accept
 * credentialed cross-origin requests.
 */
export const ALLOWED_HEADERS = ['content-type', 'authorization', 'x-library-host', 'idempotency-key'];

export const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];

import { createHash } from 'node:crypto';

/**
 * Custom `@Throttle(...).getTracker` functions for `/auth/login` and
 * `/auth/refresh` (see `auth.controller.ts`). Both routes were throttled
 * per-IP by default, which is wrong for a school: many devices legitimately
 * share one NAT'd IP, so an IP-keyed bucket punishes a whole building for
 * being busy at once (see the controller's doc comments for the concrete
 * arithmetic). Both trackers below key on an IDENTITY instead — the thing
 * that's actually supposed to be rate-limited — while the routes' `default`
 * throttler (unmodified or lightly overridden) stays active as a second,
 * looser, IP-keyed layer. Pure functions: no Nest, no request mutation,
 * easy to unit-test directly against a plain request-shaped object.
 */

// Param type matches @nestjs/throttler's own `ThrottlerGetTrackerFunction`
// (`(req: Record<string, any>, context: ExecutionContext) => ...`) exactly —
// both trackers only need `req`, and a function with fewer parameters than
// its target type declares is a normal, safely-substitutable callback shape
// (same reasoning as Array.prototype.map's callback), so these are handed to
// `@Throttle({ ..., getTracker: loginIdentityTracker })` directly with no
// wrapper. `any` here mirrors the library's own declared type, not a
// shortcut — narrower fields are read out and validated below before use.
type Req = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function ipFallback(req: Req): string {
  return `ip:${String(req.ip ?? 'unknown')}`;
}

function orgKey(req: Req): string {
  const org = req.org as { kind?: string; orgId?: string; hostname?: string } | undefined;
  return org?.kind === 'tenant' && org.orgId ? org.orgId : `host:${org?.hostname ?? 'unknown'}`;
}

/**
 * Keys on (org, identifier) — spec §9.4's login-attempt bucket. Falls back
 * to the caller's IP only when the request carries no parseable identifier
 * at all (there is no identity yet to key on); this is not a way to opt out
 * of limiting, since a request that reaches here with no identifier will
 * also fail validation/business logic regardless of throttling.
 */
export function loginIdentityTracker(req: Req): string {
  const body = req.body as Record<string, unknown> | undefined;
  const identifier = typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
  if (!identifier) return ipFallback(req);
  return `login:${orgKey(req)}:${identifier}`;
}

/**
 * Keys on the refresh token itself, HASHED — the only identity available
 * before the token is verified, and the same "never a live secret at rest"
 * rule `RefreshToken.tokenHash`/`supersededAt` already follow (see
 * `refresh.service.ts`) applies equally to a Redis key. This is what fixes
 * the original bug: N devices behind one school's NAT each refresh their
 * OWN token, so each gets its own bucket instead of all N sharing a single
 * IP-keyed limit that legitimate concurrent traffic could cross on its own.
 */
export function refreshIdentityTracker(req: Req): string {
  const body = req.body as Record<string, unknown> | undefined;
  const token = typeof body?.refreshToken === 'string' ? body.refreshToken : '';
  if (!token) return ipFallback(req);
  return `refresh:${createHash('sha256').update(token).digest('hex')}`;
}

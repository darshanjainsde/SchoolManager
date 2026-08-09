import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { getLibraryPlatformPrisma } from '@library/db';
import { loadLibraryEnv } from '../../../config/env';
import { OrgLookupService, type OrgContext } from './org-lookup.service';
import { orgStore } from './org-context.service';

const env = loadLibraryEnv();
const redis = new Redis(env.LIBRARY_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });

async function connect(): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
}

const lookup = new OrgLookupService(
  {
    findDomain: (hostname) =>
      getLibraryPlatformPrisma().libraryDomain.findFirst({
        where: { hostname, status: 'LIVE' },
        select: { orgId: true, org: { select: { slug: true, status: true } } },
      }),
    findBySlug: (slug) =>
      getLibraryPlatformPrisma().libraryOrg.findFirst({
        where: { slug, status: { not: 'SUSPENDED' } },
        select: { id: true, slug: true },
      }),
  },
  {
    get: async (key) => { await connect(); return redis.get(key); },
    set: async (key, value, ttl) => { await connect(); await redis.set(key, value, 'EX', ttl); },
  },
  env.LIBRARY_PLATFORM_HOST,
);

/**
 * Tenant identity rides the request host. Resolution order:
 *   1. `X-Library-Host` — app-controlled, required because Vercel's ingress
 *      overwrites X-Forwarded-Host, which would collapse every request to one host.
 *   2. `req.hostname` — honours X-Forwarded-Host when trust proxy is on.
 *   3. `req.headers.host` — covers supertest, which sets Host directly.
 *
 * Functional middleware using module-level singletons rather than Nest DI:
 * middleware DI is unreliable under tsx because decorator metadata is not
 * consistently emitted at runtime, and these services have no Nest dependencies.
 *
 * Trust boundary (deliberate, ruled 2026-08-10): `X-Library-Host` is client-supplied.
 * Nothing here authenticates it, signs it, or checks it against anything the caller
 * doesn't also control — any client can put any hostname in it and be resolved into
 * that org's request context. That is intentional and does not need fixing: this
 * header only selects *which tenant context a request runs in*, it grants no
 * authority on its own. The control that makes that safe lives downstream, in the
 * Task 7 JWT guard, which rejects any request whose token's org does not match the
 * org this middleware resolved from the host. Because of that pairing, an endpoint
 * that skips the JWT guard is reachable under *any* org's context by anyone who sets
 * this header — such an endpoint must be treated as public by design, the same way
 * an unauthenticated endpoint is public today regardless of tenancy. Do not add
 * validation, a shared secret, or other enforcement here on the strength of a
 * "this header could be spoofed" observation alone; that was raised in review and
 * declined by design, on the same reasoning the sibling Sckools system's
 * `X-Skoolos-Host` header already relies on and that system's architecture baseline
 * records as correct.
 */
export function orgMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // A repeated header arrives as string[] — Array.isArray guards against
  // `.toString()` silently comma-joining it into a garbage host.
  const rawHeader = req.headers['x-library-host'];
  const explicit = (Array.isArray(rawHeader) ? rawHeader[0] ?? '' : rawHeader ?? '').toString().trim();
  const host = explicit || req.hostname || (req.headers.host ?? '').toString();
  void lookup
    .resolveByHostname(host)
    .then((ctx: OrgContext) => {
      (req as Request & { org?: OrgContext }).org = ctx;
      orgStore.run(ctx, () => next());
    })
    .catch((err) => next(err));
}

import type { NextFunction, Request, Response } from 'express';
import { TenantContext, TenantContextService, tenantStore } from './tenant-context.service';
import { SchoolLookupService } from './school-lookup.service';

/**
 * Functional Express middleware. We use the singleton TenantContextService /
 * SchoolLookupService directly (via module-level singletons) rather than DI
 * because NestJS middleware DI is unreliable under tsx (decorator metadata is
 * not consistently emitted at runtime). The two services have no transitive
 * NestJS-specific dependencies, so this is equivalent — DI just adds risk.
 */
const lookup = new SchoolLookupService();
const ctxService = new TenantContextService();

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Tenant identity is carried by the request host. Resolution order:
  //   1. `X-Skoolos-Host` — an explicit, app-controlled header. Required on
  //      platforms whose ingress rewrites `X-Forwarded-Host` (e.g. Vercel
  //      overwrites it with the real deployment host), which would otherwise
  //      make every request resolve to the same host. This is also
  //      forward-compatible with per-tenant custom domains: when a real
  //      subdomain Host arrives, the client simply doesn't send this header.
  //   2. `req.hostname` — honours `X-Forwarded-Host` when `trust proxy` is
  //      enabled (set in main.ts); correct for real subdomain hosting.
  //   3. `req.headers.host` — covers trust-proxy-off cases (e.g. supertest
  //      integration tests set the Host header directly).
  const customHost = (req.headers['x-skoolos-host'] ?? '').toString().trim();
  const fromExpress = typeof req.hostname === 'string' && req.hostname.length > 0 ? req.hostname : null;
  const rawHostHeader = (req.headers.host ?? '').toString();
  const host = customHost || fromExpress || rawHostHeader;
  void lookup
    .resolveByHostname(host)
    .then((resolved) => {
      let context: TenantContext;
      if (resolved.kind === 'tenant') {
        context = {
          kind: 'tenant',
          schoolId: resolved.schoolId,
          schoolSlug: resolved.schoolSlug,
          hostname: host,
        };
      } else if (resolved.kind === 'platform') {
        context = { kind: 'platform', hostname: host };
      } else {
        context = { kind: 'unknown', hostname: host };
      }
      (req as Request & { tenant?: TenantContext }).tenant = context;
      tenantStore.run(context, () => next());
    })
    .catch((err) => next(err));
}

// Re-export the singleton ctx service so Nest DI can find an instance shared
// with the middleware (we register it as a value provider in the module).
export { ctxService };

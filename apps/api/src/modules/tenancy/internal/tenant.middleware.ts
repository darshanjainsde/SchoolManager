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
  // `req.hostname` honours `X-Forwarded-Host` when `trust proxy` is enabled
  // (set in main.ts). Falling back to `req.headers.host` covers cases where
  // trust proxy is off (e.g. integration tests via supertest, where the
  // browser-equivalent Host header is set directly).
  const fromExpress = typeof req.hostname === 'string' && req.hostname.length > 0 ? req.hostname : null;
  const rawHostHeader = (req.headers.host ?? '').toString();
  const host = fromExpress ?? rawHostHeader;
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

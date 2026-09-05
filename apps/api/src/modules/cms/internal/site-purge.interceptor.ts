import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { TenantContextService } from '../../tenancy';

/**
 * When a school changes its site, drop that school's cached pages.
 *
 * Public school pages are cached at the edge for 60 seconds so a visit does
 * not re-run eleven database queries. That 60s is the only freshness cost the
 * caching work introduced, and it lands on the worst possible person: a head
 * teacher who fixes a wrong phone number, reloads, still sees the old one, and
 * reasonably concludes the save failed.
 *
 * WHY AN INTERCEPTOR: the eight `site/*` controllers hold twenty-three write
 * endpoints between them, and the next person to add a twenty-fourth would
 * have to remember to purge. Here the rule is structural — "a write to a
 * school's site drops that school's cache" holds for endpoints nobody has
 * written yet. Same argument as OwnerCacheInterceptor.
 *
 * Purges every host that school is reachable on, because each host is its own
 * cache entry: the platform subdomain plus every LIVE custom domain. Never
 * touches another tenant's pages.
 */
@Injectable()
export class SitePurgeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SitePurgeInterceptor.name);
  private readonly env = loadEnv();
  private static readonly READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(private readonly tenant: TenantContextService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SitePurgeInterceptor.READ_ONLY.has(req.method)) return next.handle();

    const tenantCtx = this.tenant.get();
    const schoolId = tenantCtx?.kind === 'tenant' ? tenantCtx.schoolId : null;
    if (!schoolId) return next.handle();

    // After the handler resolves, never before: a write that throws must not
    // pay for a purge, and a cache dropped ahead of a failed write is refilled
    // from the same state anyway.
    return next.handle().pipe(tap({ next: () => void this.purge(schoolId) }));
  }

  private async purge(schoolId: string): Promise<void> {
    const { WEB_REVALIDATE_URL: url, REVALIDATE_SECRET: secret } = this.env;
    // Not configured is a valid state: the 60s revalidate window is the
    // backstop, so the pages are stale rather than wrong.
    if (!url || !secret) return;

    try {
      const db = getPlatformPrisma();
      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { slug: true, domains: { where: { status: 'LIVE' }, select: { hostname: true } } },
      });
      if (!school) return;

      const hosts = [
        `${school.slug}.${this.env.PLATFORM_HOST}`,
        ...school.domains.map((d) => d.hostname),
      ];

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ hosts }),
        // A slow web app must not hold a school's save open.
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        this.logger.warn(`Purge for ${school.slug} returned ${res.status}`);
      }
    } catch (e) {
      // Never allowed to surface: the write has already committed, and the
      // TTL will catch up within a minute regardless.
      this.logger.warn(`Purge failed for school ${schoolId}: ${(e as Error).message}`);
    }
  }
}

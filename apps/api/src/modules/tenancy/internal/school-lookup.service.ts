import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../../../common/redis/redis.client';

type LookupResult =
  | { kind: 'tenant'; schoolId: string; schoolSlug: string }
  | { kind: 'platform' }
  | { kind: 'unknown' };

const CACHE_TTL_SECONDS = 60;
const CACHE_PREFIX = 'host:';

/**
 * Resolves a request hostname to a tenant. Reads first from Redis cache,
 * falls back to Postgres (slug match or verified Domain), and back-fills
 * the cache. Cache entries are short-TTL'd so domain changes propagate quickly.
 */
@Injectable()
export class SchoolLookupService {
  private readonly logger = new Logger(SchoolLookupService.name);
  private readonly env = loadEnv();

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: SharedRedis = sharedRedis()) {}

  async resolveByHostname(rawHost: string): Promise<LookupResult> {
    const hostname = rawHost.split(':')[0].toLowerCase();

    if (hostname === this.env.PLATFORM_OWNER_HOST) return { kind: 'platform' };

    const cached = await this.cacheGet(hostname);
    if (cached) return cached;

    const fresh = await this.lookupInDb(hostname);
    await this.cacheSet(hostname, fresh);
    return fresh;
  }

  /** Invalidate cache for a hostname — called when a domain changes status. */
  async invalidate(hostname: string): Promise<void> {
    try {
      await ensureConnected(this.redis);
      await this.redis?.del(CACHE_PREFIX + hostname.toLowerCase());
    } catch (e) {
      this.logger.warn(`Redis invalidate failed for ${hostname}: ${(e as Error).message}`);
    }
  }

  private async lookupInDb(hostname: string): Promise<LookupResult> {
    const platform = getPlatformPrisma();

    // Our OWN space is decided by the slug convention alone, and this branch
    // runs FIRST so no Domain row can ever reinterpret it.
    //
    // Order is the security property here, not a preference. A `Domain` row is
    // written from an operator-supplied string; the slug is the school's own
    // identity. Consulting rows first let one school claim another's address —
    // and nothing collided, because a school on the wildcard has no row of its
    // own to clash with. Deciding by slug first makes that unreachable no
    // matter what any row says, including rows written before this rule
    // existed. `add` refuses such names too; this is the half that does not
    // depend on every future write path remembering to ask.
    const platformHost = this.env.PLATFORM_HOST.toLowerCase();
    if (hostname.endsWith('.' + platformHost) && hostname !== platformHost) {
      const slug = hostname.slice(0, -('.' + platformHost).length);
      if (/^[a-z0-9-]{2,32}$/.test(slug)) {
        const school = await platform.school.findUnique({
          where: { slug },
          select: { id: true, slug: true, status: true },
        });
        if (school && school.status !== 'SUSPENDED') {
          return { kind: 'tenant', schoolId: school.id, schoolSlug: school.slug };
        }
      }
      // Under our host but not a school: api.<host>, a typo, a retired slug.
      // Deliberately NOT falling through — a row naming one of these must not
      // be able to turn a control-plane address into a tenant.
      return { kind: 'unknown' };
    }

    // Custom domain — must be LIVE.
    const domain = await platform.domain.findFirst({
      where: { hostname, status: 'LIVE' },
      include: { school: { select: { id: true, slug: true, status: true } } },
    });
    if (domain && domain.school.status !== 'SUSPENDED') {
      return { kind: 'tenant', schoolId: domain.school.id, schoolSlug: domain.school.slug };
    }

    return { kind: 'unknown' };
  }

  private async cacheGet(hostname: string): Promise<LookupResult | null> {
    try {
      if (!(await ensureConnected(this.redis))) return null;
      const raw = await this.redis!.get(CACHE_PREFIX + hostname);
      return raw ? (JSON.parse(raw) as LookupResult) : null;
    } catch (e) {
      this.logger.warn(`Redis cacheGet failed for ${hostname}: ${(e as Error).message}`);
      return null;
    }
  }

  private async cacheSet(hostname: string, value: LookupResult): Promise<void> {
    try {
      if (!(await ensureConnected(this.redis))) return;
      await this.redis!.set(
        CACHE_PREFIX + hostname,
        JSON.stringify(value),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (e) {
      this.logger.warn(`Redis cacheSet failed for ${hostname}: ${(e as Error).message}`);
    }
  }

}

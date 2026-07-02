import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';

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
  private readonly redis: Redis;
  private readonly env = loadEnv();

  constructor() {
    this.redis = new Redis(this.env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }

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
      await this.connectIfNeeded();
      await this.redis.del(CACHE_PREFIX + hostname.toLowerCase());
    } catch (e) {
      this.logger.warn(`Redis invalidate failed for ${hostname}: ${(e as Error).message}`);
    }
  }

  private async lookupInDb(hostname: string): Promise<LookupResult> {
    const platform = getPlatformPrisma();
    // Custom domain — must be LIVE.
    const domain = await platform.domain.findFirst({
      where: { hostname, status: 'LIVE' },
      include: { school: { select: { id: true, slug: true, status: true } } },
    });
    if (domain && domain.school.status !== 'SUSPENDED') {
      return { kind: 'tenant', schoolId: domain.school.id, schoolSlug: domain.school.slug };
    }

    // Subdomain of platform host: <slug>.localhost / <slug>.skoolos.app
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
    }

    return { kind: 'unknown' };
  }

  private async cacheGet(hostname: string): Promise<LookupResult | null> {
    try {
      await this.connectIfNeeded();
      const raw = await this.redis.get(CACHE_PREFIX + hostname);
      return raw ? (JSON.parse(raw) as LookupResult) : null;
    } catch (e) {
      this.logger.warn(`Redis cacheGet failed for ${hostname}: ${(e as Error).message}`);
      return null;
    }
  }

  private async cacheSet(hostname: string, value: LookupResult): Promise<void> {
    try {
      await this.connectIfNeeded();
      await this.redis.set(
        CACHE_PREFIX + hostname,
        JSON.stringify(value),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (e) {
      this.logger.warn(`Redis cacheSet failed for ${hostname}: ${(e as Error).message}`);
    }
  }

  private async connectIfNeeded(): Promise<void> {
    if (this.redis.status === 'ready' || this.redis.status === 'connecting') return;
    await this.redis.connect().catch(() => undefined);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { loadEnv } from '@skoolos/config';
import { getLibraryPlatformPrisma } from '@library/db';

/**
 * Resolves a Sckools `School.id` to its `LibraryOrg.id`.
 *
 * THE WHOLE TENANCY BRIDGE, and deliberately the only one. The library service
 * resolves its own tenant from an `X-Library-Host` header via `orgMiddleware`.
 * Inside `apps/api` that must NOT happen: `tenantMiddleware` has already run and
 * `req.tenant.schoolId` is in the ALS store before any library code executes. A
 * second host header resolving a second tenant identity for the same request is
 * not redundancy — it is a second answer that can disagree with the first, and
 * the disagreement would be a cross-tenant read.
 *
 * So the org comes from the school, through `LibraryOrg.schoolId`, which is
 * `@unique` precisely so this is one indexed lookup.
 *
 * Cached in the same Redis at the same 60s TTL as `SchoolLookupService`, and
 * with the same known consequence: a school suspended in the last 60s still
 * resolves. Sckools already tolerates exactly that for its own tenant lookup,
 * so this inherits a known behaviour rather than inventing a second one.
 *
 * Fails OPEN onto the database — a Redis outage makes this slower, not broken.
 * That is cache-aside, unlike the throttler's fail-open, because here there IS
 * a fallback source of truth.
 */

const CACHE_PREFIX = 'sk:liborg:';
const CACHE_TTL_SECONDS = 60;
/** Cached explicitly so a school with no library does not hit the DB every request. */
const NONE = 'none';

@Injectable()
export class LibraryOrgService {
  private readonly logger = new Logger(LibraryOrgService.name);
  private readonly redis: Redis;

  constructor() {
    const env = loadEnv();
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  }

  /** `null` when this school has no library provisioned. Never throws for that case. */
  async orgIdForSchool(schoolId: string): Promise<string | null> {
    const cached = await this.cacheGet(schoolId);
    if (cached !== undefined) return cached;

    // `getLibraryPlatformPrisma()` is lazy, so a deployment where LIBRARY is off
    // for every school never opens a library connection and never needs the
    // library DB URLs. The moment one school turns it on, `apps/api` needs
    // LIBRARY_DATABASE_URL_APP and LIBRARY_DATABASE_URL_PLATFORM — and without
    // them the raw failure is a bare "must be set" throw surfacing as a 500 on
    // an unrelated-looking route. Naming the cause here is the difference
    // between a five-minute fix and an outage nobody can place.
    let org: { id: string; status: string } | null;
    try {
      org = await getLibraryPlatformPrisma().libraryOrg.findUnique({
        where: { schoolId },
        select: { id: true, status: true },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('LIBRARY_DATABASE_URL')) {
        this.logger.error(
          'LIBRARY is enabled for a school but this deployment has no library database configured. ' +
            'Set LIBRARY_DATABASE_URL_APP and LIBRARY_DATABASE_URL_PLATFORM on this project.',
        );
      }
      throw err;
    }

    // A SUSPENDED or SETUP org resolves to null rather than to an id: the
    // caller's only question is "can this school use its library right now",
    // and answering with an id for a suspended org would push that check out to
    // every call site, where one of them would eventually forget it.
    const orgId = org && org.status === 'LIVE' ? org.id : null;
    await this.cacheSet(schoolId, orgId);
    return orgId;
  }

  /**
   * Whether this library is usable, and whether it is LIVE.
   *
   * `live` is the second of the two gates on the student and teacher menu item:
   * the first is the LIBRARY feature flag, this is "are there actually books in
   * it". Deliberately NOT cached — it changes the moment a librarian adds the
   * first copy, and a 60s stale "not live" would have her adding books while
   * the tab stubbornly refuses to appear.
   */
  async statusFor(orgId: string): Promise<{
    provisioned: boolean;
    live: boolean;
    members: number;
    copies: number;
  }> {
    const prisma = getLibraryPlatformPrisma();
    const [members, copies] = await Promise.all([
      prisma.member.count({ where: { orgId, status: 'ACTIVE' } }),
      prisma.copy.count({ where: { orgId } }),
    ]);
    return { provisioned: true, live: copies > 0, members, copies };
  }

  /**
   * Does this school have a library with at least one book in it?
   *
   * Answers false — never throws — for a school that is unprovisioned, still in
   * SETUP, or suspended. This is read on every `/auth/me`, which is the call
   * every portal makes on load, so it must never be the thing that breaks a
   * login for a school whose library is merely unfinished.
   */
  async isLiveForSchool(schoolId: string): Promise<boolean> {
    try {
      const orgId = await this.orgIdForSchool(schoolId);
      if (!orgId) return false;
      const { live } = await this.statusFor(orgId);
      return live;
    } catch (err) {
      // A library database that is unreachable or unconfigured must not take
      // /auth/me down with it — every portal in the product calls this.
      this.logger.warn(
        `library liveness check failed for school ${schoolId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private async cacheGet(schoolId: string): Promise<string | null | undefined> {
    try {
      await this.connect();
      const raw = await this.redis.get(`${CACHE_PREFIX}${schoolId}`);
      if (raw === null) return undefined; // not cached
      return raw === NONE ? null : raw;
    } catch (err) {
      // Cache-aside: fall through to the database rather than failing the
      // request. Logged because a permanently unreachable Redis turns every
      // library request into a database round trip, which is a real cost that
      // should not be silent.
      this.logger.warn(`library org cache read failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private async cacheSet(schoolId: string, orgId: string | null): Promise<void> {
    try {
      await this.connect();
      await this.redis.set(`${CACHE_PREFIX}${schoolId}`, orgId ?? NONE, 'EX', CACHE_TTL_SECONDS);
    } catch {
      // A failed cache WRITE is not worth a log line per request — the read
      // path above already reports an unreachable Redis.
    }
  }

  private async connect(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end') {
      await this.redis.connect();
    }
  }
}

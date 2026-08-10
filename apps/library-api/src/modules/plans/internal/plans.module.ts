import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { getLibraryPlatformPrisma } from '@library/db';
import { loadLibraryEnv } from '../../../config/env';
import { PlanResolverService, type PlanCache, type PlanStore } from './plan-resolver.service';
import type { PlanKey } from './resolve';

/**
 * BYPASSRLS platform client: `forOrg` is called by guards *before* any
 * tenant-scoped session exists (it decides whether the request may proceed
 * at all), the same reasoning `org.middleware.ts` and `auth.module.ts`
 * already document for host lookup and login.
 */
class PrismaPlanStore implements PlanStore {
  async findOrgPlan(
    orgId: string,
  ): Promise<{ plan: PlanKey; overrides: { key: string; enabled: boolean }[] } | null> {
    const org = await getLibraryPlatformPrisma().libraryOrg.findUnique({
      where: { id: orgId },
      select: { plan: true, overrides: { select: { key: true, enabled: true } } },
    });
    return org ? { plan: org.plan as PlanKey, overrides: org.overrides } : null;
  }
}

/**
 * Own `ioredis` connection, module-scoped — same shape as `org.middleware.ts`
 * and the sibling Sckools `FeatureResolverService`, not a shared client, so
 * this module's failure mode is isolated from tenancy's.
 */
function makeRedisPlanCache(): PlanCache {
  const env = loadLibraryEnv();
  const redis = new Redis(env.LIBRARY_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const connect = async (): Promise<void> => {
    if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
  };
  return {
    get: async (key) => { await connect(); return redis.get(key); },
    set: async (key, value, ttl) => { await connect(); await redis.set(key, value, 'EX', ttl); },
    del: async (key) => { await connect(); await redis.del(key); },
  };
}

@Module({
  providers: [
    { provide: 'PLAN_STORE', useClass: PrismaPlanStore },
    { provide: 'PLAN_CACHE', useFactory: makeRedisPlanCache },
    {
      provide: PlanResolverService,
      // Explicit factory + inject tokens, not a bare `@Injectable() useClass`:
      // tsx does not reliably emit `design:paramtypes`, so constructor
      // injection of bare-typed params can silently resolve to `undefined`.
      useFactory: (store: PlanStore, cache: PlanCache) => new PlanResolverService(store, cache),
      inject: ['PLAN_STORE', 'PLAN_CACHE'],
    },
  ],
  exports: [PlanResolverService],
})
export class PlansModule {}

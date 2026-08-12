import { Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
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
/**
 * The connection is exposed alongside the cache so `PlanCacheLifecycle` below
 * can close it. Without that, this client kept the Node event loop alive after
 * `app.close()` — harmless in a serverless function that is frozen rather than
 * stopped, but in the e2e suite it meant Jest ran all 162 tests in ~14s and
 * then **never exited**. Anything waiting for that process to finish waited
 * forever, which is what made the suite look like it "takes several minutes"
 * and is what several subagents died waiting on.
 */
function makeRedisPlanCache(): PlanCache & { close: () => Promise<void> } {
  const env = loadLibraryEnv();
  const redis = new Redis(env.LIBRARY_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  const connect = async (): Promise<void> => {
    if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
  };
  return {
    get: async (key) => { await connect(); return redis.get(key); },
    set: async (key, value, ttl) => { await connect(); await redis.set(key, value, 'EX', ttl); },
    del: async (key) => { await connect(); await redis.del(key); },
    close: async () => {
      // `end`/`close` are already-closed states; quitting again throws.
      if (redis.status !== 'end' && redis.status !== 'close') await redis.quit().catch(() => undefined);
    },
  };
}

/**
 * Nest only runs lifecycle hooks on class providers, and 'PLAN_CACHE' is a
 * value provider — so the hook lives on this tiny class, which is registered
 * purely to own the shutdown. Every long-lived handle a module opens needs an
 * owner like this, or `app.close()` is a lie.
 */
@Injectable()
class PlanCacheLifecycle implements OnModuleDestroy {
  constructor(@Inject('PLAN_CACHE') private readonly cache: PlanCache & { close?: () => Promise<void> }) {}
  async onModuleDestroy(): Promise<void> {
    await this.cache.close?.();
  }
}

@Module({
  providers: [
    { provide: 'PLAN_STORE', useClass: PrismaPlanStore },
    { provide: 'PLAN_CACHE', useFactory: makeRedisPlanCache },
    PlanCacheLifecycle,
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

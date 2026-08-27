import { Inject, Injectable, Optional } from '@nestjs/common';
import { getPlatformPrisma, resolveFeatures, type FeatureKey } from '@skoolos/db';
import type { Tier } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { REDIS_CLIENT, ensureConnected, sharedRedis, type SharedRedis } from '../../../common/redis/redis.client';

@Injectable()
export class FeatureResolverService {
  private readonly env = loadEnv();
  private static readonly TTL = 300;

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: SharedRedis = sharedRedis()) {}

  /** Pure merge — unit-testable without IO. */
  computeFor(tier: Tier, overrides: { featureKey: string; enabled: boolean }[]): Set<FeatureKey> {
    return resolveFeatures(tier, overrides);
  }

  async getFeatures(schoolId: string): Promise<Set<FeatureKey>> {
    const key = `feat:${schoolId}`;
    try {
      if (!(await ensureConnected(this.redis))) throw new Error('redis unavailable');
      const cached = await this.redis!.get(key);
      if (cached) return new Set(JSON.parse(cached) as FeatureKey[]);
    } catch { /* fall through to DB */ }

    const prisma = getPlatformPrisma();
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { tier: true, featureOverrides: { select: { featureKey: true, enabled: true } } },
    });
    if (!school) return new Set();
    const set = this.computeFor(school.tier, school.featureOverrides);
    try { await this.redis?.set(key, JSON.stringify([...set]), 'EX', FeatureResolverService.TTL); } catch { /* ignore */ }
    return set;
  }

  async invalidate(schoolId: string): Promise<void> {
    try { await ensureConnected(this.redis); await this.redis?.del(`feat:${schoolId}`); } catch { /* ignore */ }
  }
}

import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { getPlatformPrisma, resolveFeatures, type FeatureKey } from '@skoolos/db';
import type { Tier } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';

@Injectable()
export class FeatureResolverService {
  private readonly env = loadEnv();
  private readonly redis = new Redis(this.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
  private static readonly TTL = 300;

  /** Pure merge — unit-testable without IO. */
  computeFor(tier: Tier, overrides: { featureKey: string; enabled: boolean }[]): Set<FeatureKey> {
    return resolveFeatures(tier, overrides);
  }

  async getFeatures(schoolId: string): Promise<Set<FeatureKey>> {
    const key = `feat:${schoolId}`;
    try {
      await this.connect();
      const cached = await this.redis.get(key);
      if (cached) return new Set(JSON.parse(cached) as FeatureKey[]);
    } catch { /* fall through to DB */ }

    const prisma = getPlatformPrisma();
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { tier: true, featureOverrides: { select: { featureKey: true, enabled: true } } },
    });
    if (!school) return new Set();
    const set = this.computeFor(school.tier, school.featureOverrides);
    try { await this.redis.set(key, JSON.stringify([...set]), 'EX', FeatureResolverService.TTL); } catch { /* ignore */ }
    return set;
  }

  async invalidate(schoolId: string): Promise<void> {
    try { await this.connect(); await this.redis.del(`feat:${schoolId}`); } catch { /* ignore */ }
  }

  private async connect(): Promise<void> {
    if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
  }
}

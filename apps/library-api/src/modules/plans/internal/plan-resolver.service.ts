import { Injectable } from '@nestjs/common';
import { resolvePlan, type CapabilityKey, type PlanKey, type Quotas } from './resolve';

export interface PlanStore {
  findOrgPlan(
    orgId: string,
  ): Promise<{ plan: PlanKey; overrides: { key: string; enabled: boolean }[] } | null>;
}

export interface PlanCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

type Resolved = { capabilities: Set<CapabilityKey>; quotas: Quotas };

/** On-wire shape. `null` stands in for `Infinity` — see serializePlan. */
interface CachedPlanV1 {
  v: 1;
  capabilities: string[];
  quotas: { branches: number | null; adminSeats: number | null };
}

const TTL_SECONDS = 300;
const keyFor = (orgId: string): string => `libfeat:${orgId}`;

/**
 * `JSON.stringify(Infinity)` produces `null`, and a naive `JSON.parse` of that
 * yields `null`, which coerces to `0` in arithmetic — an unlimited PRO quota
 * would silently become a *zero* quota once round-tripped through Redis. So
 * quotas are serialised as `number | null`, with `null` meaning "unlimited",
 * and restored to `Infinity` explicitly on read.
 */
export function serializePlan(resolved: Resolved): string {
  const payload: CachedPlanV1 = {
    v: 1,
    capabilities: [...resolved.capabilities],
    quotas: {
      branches: Number.isFinite(resolved.quotas.branches) ? resolved.quotas.branches : null,
      adminSeats: Number.isFinite(resolved.quotas.adminSeats) ? resolved.quotas.adminSeats : null,
    },
  };
  return JSON.stringify(payload);
}

/**
 * Tolerant of anything that isn't exactly the expected shape — a payload
 * cached by an older/newer version of this service, or garbage — so a stale
 * or foreign value is treated as a cache miss (fall through to the database)
 * rather than crashing the request or silently handing back wrong quotas.
 */
export function deserializePlan(raw: string): Resolved | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Partial<CachedPlanV1>;
  // A future version bump to this payload shape (or a value some older
  // deployment cached before `v` existed) is treated as a miss, not
  // force-fit into today's shape — safer to recompute from the database
  // than to guess at a schema this code was never written to parse.
  if (obj.v !== 1) return null;
  if (!Array.isArray(obj.capabilities) || !obj.capabilities.every((c) => typeof c === 'string')) return null;
  if (!obj.quotas || typeof obj.quotas !== 'object') return null;

  const { branches, adminSeats } = obj.quotas as { branches: unknown; adminSeats: unknown };
  if (branches !== null && typeof branches !== 'number') return null;
  if (adminSeats !== null && typeof adminSeats !== 'number') return null;

  return {
    capabilities: new Set(obj.capabilities as CapabilityKey[]),
    quotas: {
      branches: branches === null ? Infinity : branches,
      adminSeats: adminSeats === null ? Infinity : adminSeats,
    },
  };
}

/**
 * Same fail-open cache-aside shape as the sibling Sckools system's
 * `FeatureResolverService`: try Redis first, fall through to the platform
 * database on *any* cache error (a cache is never a source of truth), write
 * back best-effort, and expose an explicit `invalidate`.
 */
@Injectable()
export class PlanResolverService {
  constructor(
    private readonly store: PlanStore,
    private readonly cache: PlanCache,
  ) {}

  async forOrg(orgId: string): Promise<Resolved> {
    const key = keyFor(orgId);
    try {
      const cached = await this.cache.get(key);
      if (cached) {
        const resolved = deserializePlan(cached);
        if (resolved) return resolved;
      }
    } catch {
      /* cache is never a source of truth — fall through to the database */
    }

    const row = await this.store.findOrgPlan(orgId);
    // An org with no row (or none found) gets FREE with no overrides — the
    // safest default, never a wider grant than the lowest tier.
    const plan = row?.plan ?? 'FREE';
    const overrides = row?.overrides ?? [];
    const resolved = resolvePlan(plan, overrides);

    try {
      await this.cache.set(key, serializePlan(resolved), TTL_SECONDS);
    } catch {
      /* best-effort write; a cache miss next time just re-reads the database */
    }
    return resolved;
  }

  async invalidate(orgId: string): Promise<void> {
    try {
      await this.cache.del(keyFor(orgId));
    } catch {
      /* ignore */
    }
  }
}

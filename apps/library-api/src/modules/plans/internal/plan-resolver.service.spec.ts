import { PlanResolverService, serializePlan, deserializePlan, type PlanStore, type PlanCache } from './plan-resolver.service';
import { resolvePlan } from './resolve';

const ORG = '33333333-3333-4333-8333-333333333333';

function deps(
  overrides: Partial<{
    row: { plan: 'FREE' | 'MINI' | 'PRO'; overrides: { key: string; enabled: boolean }[] } | null;
    cached: string | null;
    cacheGetThrows: boolean;
    cacheSetThrows: boolean;
  }> = {},
) {
  const calls = { db: 0, cacheGet: 0, cacheSet: 0, cacheDel: 0 };
  const store: PlanStore = {
    findOrgPlan: async () => { calls.db++; return overrides.row === undefined ? { plan: 'FREE', overrides: [] } : overrides.row; },
  };
  const cache: PlanCache = {
    get: async () => {
      calls.cacheGet++;
      if (overrides.cacheGetThrows) throw new Error('redis down');
      return overrides.cached ?? null;
    },
    set: async () => {
      calls.cacheSet++;
      if (overrides.cacheSetThrows) throw new Error('redis down');
    },
    del: async () => { calls.cacheDel++; },
  };
  return { calls, service: new PlanResolverService(store, cache) };
}

describe('serialize / deserialize round-trip', () => {
  it('preserves Infinity quotas for a PRO plan through JSON round-trip via Redis', () => {
    const resolved = resolvePlan('PRO', []);
    const raw = serializePlan(resolved);

    // The trap: JSON.stringify(Infinity) === 'null', and a naive JSON.parse
    // round-trip would silently turn an unlimited quota into 0 downstream.
    expect(JSON.parse(raw).quotas).toEqual({ branches: null, adminSeats: null });

    const back = deserializePlan(raw);
    expect(back).not.toBeNull();
    expect(back!.quotas.branches).toBe(Infinity);
    expect(back!.quotas.adminSeats).toBe(Infinity);
    expect(back!.quotas.branches).not.toBe(0);
    expect([...back!.capabilities]).toEqual([...resolved.capabilities]);
  });

  it('preserves finite quotas for a FREE plan through JSON round-trip', () => {
    const resolved = resolvePlan('FREE', []);
    const back = deserializePlan(serializePlan(resolved));
    expect(back!.quotas).toEqual({ branches: 1, adminSeats: 1 });
  });

  it('returns null (cache miss) for a malformed/older cached payload rather than crashing', () => {
    expect(deserializePlan('{"nonsense":true}')).toBeNull();
    expect(deserializePlan('not json at all')).toBeNull();
    expect(deserializePlan('{"capabilities":["CATALOG"],"quotas":{"branches":"lots"}}')).toBeNull();
  });

  it('treats a payload missing the version tag (e.g. a pre-versioning cached value) as a miss, not a guess', () => {
    const unversioned = JSON.stringify({ capabilities: ['CATALOG'], quotas: { branches: 1, adminSeats: 1 } });
    expect(deserializePlan(unversioned)).toBeNull();
    const wrongVersion = JSON.stringify({ v: 2, capabilities: ['CATALOG'], quotas: { branches: 1, adminSeats: 1 } });
    expect(deserializePlan(wrongVersion)).toBeNull();
  });
});

describe('PlanResolverService', () => {
  it('resolves FREE org from the database on a cache miss and writes back', async () => {
    const { service, calls } = deps({ row: { plan: 'FREE', overrides: [] } });
    const { capabilities, quotas } = await service.forOrg(ORG);
    expect(capabilities.has('CATALOG')).toBe(true);
    expect(quotas).toEqual({ branches: 1, adminSeats: 1 });
    expect(calls.db).toBe(1);
    expect(calls.cacheSet).toBe(1);
  });

  it('serves a PRO org from cache without touching the database, Infinity intact', async () => {
    const cached = serializePlan(resolvePlan('PRO', []));
    const { service, calls } = deps({ cached });
    const { quotas } = await service.forOrg(ORG);
    expect(quotas).toEqual({ branches: Infinity, adminSeats: Infinity });
    expect(calls.db).toBe(0);
  });

  it('falls open to the database when the cache read throws', async () => {
    const { service, calls } = deps({ row: { plan: 'MINI', overrides: [] }, cacheGetThrows: true });
    const { quotas } = await service.forOrg(ORG);
    expect(quotas).toEqual({ branches: 1, adminSeats: 1 });
    expect(calls.db).toBe(1);
  });

  it('does not throw when the cache write fails', async () => {
    const { service } = deps({ row: { plan: 'FREE', overrides: [] }, cacheSetThrows: true });
    await expect(service.forOrg(ORG)).resolves.toMatchObject({ quotas: { branches: 1, adminSeats: 1 } });
  });

  it('treats a missing org row as FREE with no overrides', async () => {
    const { service } = deps({ row: null });
    const { quotas } = await service.forOrg(ORG);
    expect(quotas).toEqual({ branches: 1, adminSeats: 1 });
  });

  it('invalidate deletes the cache key and does not throw on cache error', async () => {
    const { service, calls } = deps();
    await service.invalidate(ORG);
    expect(calls.cacheDel).toBe(1);

    const cache: PlanCache = {
      get: async () => null,
      set: async () => {},
      del: async () => { throw new Error('redis down'); },
    };
    const other = new PlanResolverService({ findOrgPlan: async () => ({ plan: 'FREE', overrides: [] }) }, cache);
    await expect(other.invalidate(ORG)).resolves.toBeUndefined();
  });
});

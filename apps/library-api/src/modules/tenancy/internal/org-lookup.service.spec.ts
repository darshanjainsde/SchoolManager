import { OrgLookupService } from './org-lookup.service';

const ORG = '22222222-2222-4222-8222-222222222222';

function deps(
  overrides: Partial<{
    domainRow: { orgId: string; org: { slug: string } } | null;
    slugRow: { id: string; slug: string } | null;
    cached: string | null;
  }> = {},
) {
  const calls = { db: 0, cacheGet: 0, cacheSet: 0 };
  return {
    calls,
    service: new OrgLookupService(
      {
        findDomain: async () => { calls.db++; return overrides.domainRow ?? null; },
        findBySlug: async () => { calls.db++; return overrides.slugRow ?? null; },
      },
      {
        get: async () => { calls.cacheGet++; return overrides.cached ?? null; },
        set: async () => { calls.cacheSet++; },
      },
      'library.trackyour.in',
    ),
  };
}

describe('OrgLookupService', () => {
  it('resolves a live custom domain to its org', async () => {
    const { service } = deps({ domainRow: { orgId: ORG, org: { slug: 'raffles' } } });
    await expect(service.resolveByHostname('books.raffles.edu')).resolves.toEqual({
      kind: 'tenant', orgId: ORG, orgSlug: 'raffles', hostname: 'books.raffles.edu',
    });
  });

  it('falls back to <slug>.<platform host> when no domain row exists', async () => {
    const { service } = deps({ slugRow: { id: ORG, slug: 'raffles' } });
    await expect(service.resolveByHostname('raffles.library.trackyour.in')).resolves.toEqual({
      kind: 'tenant', orgId: ORG, orgSlug: 'raffles', hostname: 'raffles.library.trackyour.in',
    });
  });

  it('returns unknown for an unrecognised host rather than guessing', async () => {
    const { service } = deps();
    await expect(service.resolveByHostname('nope.example.com')).resolves.toEqual({
      kind: 'unknown', hostname: 'nope.example.com',
    });
  });

  it('serves from cache without touching the database', async () => {
    const { service, calls } = deps({ cached: JSON.stringify({ orgId: ORG, orgSlug: 'raffles' }) });
    await service.resolveByHostname('raffles.library.trackyour.in');
    expect(calls.db).toBe(0);
  });

  it('falls open to the database when the cache throws', async () => {
    const service = new OrgLookupService(
      { findDomain: async () => ({ orgId: ORG, org: { slug: 'raffles' } }), findBySlug: async () => null },
      { get: async () => { throw new Error('redis down'); }, set: async () => { throw new Error('redis down'); } },
      'library.trackyour.in',
    );
    await expect(service.resolveByHostname('books.raffles.edu')).resolves.toMatchObject({ kind: 'tenant' });
  });
});

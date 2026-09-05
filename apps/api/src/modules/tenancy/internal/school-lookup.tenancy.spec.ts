const domainFindFirst = jest.fn();
const schoolFindUnique = jest.fn();

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => ({
    domain: { findFirst: domainFindFirst },
    school: { findUnique: schoolFindUnique },
  }),
}));

import { SchoolLookupService } from './school-lookup.service';

/**
 * Which school does this hostname mean?
 *
 * The read side of the tenancy rule. `add` refusing a sibling's address is a
 * guard on ONE write path; this is the half that holds even for rows written
 * before that guard existed, or by any future path that forgets to ask.
 */
describe('SchoolLookupService — a Domain row cannot reinterpret our own space', () => {
  function svc() {
    const s = new SchoolLookupService(null as never);
    (s as unknown as { env: Record<string, string> }).env = {
      PLATFORM_HOST: 'sckools.com',
      PLATFORM_OWNER_HOST: 'owner.sckools.com',
    };
    return s as unknown as {
      resolveByHostname(h: string): Promise<{ kind: string; schoolSlug?: string }>;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    domainFindFirst.mockResolvedValue(null);
    schoolFindUnique.mockResolvedValue(null);
  });

  it('resolves a school subdomain by its slug', async () => {
    schoolFindUnique.mockResolvedValue({ id: 's-beacon', slug: 'beacon', status: 'ACTIVE' });
    const r = await svc().resolveByHostname('beacon.sckools.com');
    expect(r).toMatchObject({ kind: 'tenant', schoolSlug: 'beacon' });
  });

  it('ignores a hostile row claiming another school’s subdomain', async () => {
    // The row that `add` used to allow: beacon.sckools.com owned by raffles.
    domainFindFirst.mockResolvedValue({
      hostname: 'beacon.sckools.com',
      school: { id: 's-raffles', slug: 'raffles', status: 'ACTIVE' },
    });
    schoolFindUnique.mockResolvedValue({ id: 's-beacon', slug: 'beacon', status: 'ACTIVE' });

    const r = await svc().resolveByHostname('beacon.sckools.com');
    expect(r).toMatchObject({ kind: 'tenant', schoolSlug: 'beacon' });
    expect(r.schoolSlug).not.toBe('raffles');
  });

  it('never lets a row turn the API host into a tenant', async () => {
    domainFindFirst.mockResolvedValue({
      hostname: 'api.sckools.com',
      school: { id: 's-raffles', slug: 'raffles', status: 'ACTIVE' },
    });
    expect(await svc().resolveByHostname('api.sckools.com')).toEqual({ kind: 'unknown' });
  });

  it('a suspended school does not fall through to a row either', async () => {
    schoolFindUnique.mockResolvedValue({ id: 's-beacon', slug: 'beacon', status: 'SUSPENDED' });
    domainFindFirst.mockResolvedValue({
      hostname: 'beacon.sckools.com',
      school: { id: 's-raffles', slug: 'raffles', status: 'ACTIVE' },
    });
    expect(await svc().resolveByHostname('beacon.sckools.com')).toEqual({ kind: 'unknown' });
  });

  it('real custom domains still resolve through their row', async () => {
    domainFindFirst.mockResolvedValue({
      hostname: 'archaiccandles.com',
      school: { id: 's-arch', slug: 'archaic', status: 'ACTIVE' },
    });
    const r = await svc().resolveByHostname('archaiccandles.com');
    expect(r).toMatchObject({ kind: 'tenant', schoolSlug: 'archaic' });
  });
});

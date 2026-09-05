const schoolFindUnique = jest.fn();
const domainFindUnique = jest.fn();
const domainCreate = jest.fn();

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  getPlatformPrisma: () => ({
    school: { findUnique: schoolFindUnique },
    domain: { findUnique: domainFindUnique, create: domainCreate, findMany: jest.fn(async () => []) },
  }),
}));

import { OwnerDomainsService } from './owner-domains.service';
import type { HostingProviderService } from './hosting-provider.service';
import type { SchoolLookupService } from '../../tenancy';

/**
 * The tenancy rule at the boundary, not in the classifier.
 *
 * domain-kind.spec.ts already proves `classifyDomain` refuses a sibling's
 * address. That is worth nothing on its own: if `add` stops CALLING it, those
 * tests stay green while the hole reopens. These cases go through the service.
 *
 * Why the hole is severe: a `<slug>.<platform>` address has no Domain row —
 * schools are served by the wildcard and the slug convention — so the
 * uniqueness check finds nothing to collide with. And SchoolLookupService
 * reads the Domain table BEFORE the slug convention, so the row that `add`
 * would write outranks the victim's own resolution.
 */
describe('OwnerDomainsService.add — which names may point at a school', () => {
  const attach = jest.fn(async () => ({ ok: true, detail: '' }));

  function svc() {
    const hosting = { configured: true, attach } as unknown as HostingProviderService;
    const s = new OwnerDomainsService({} as SchoolLookupService, hosting);
    (s as unknown as { env: Record<string, string> }).env = {
      PLATFORM_HOST: 'sckools.com',
      PLATFORM_OWNER_HOST: 'owner.sckools.com',
      INGRESS_CNAME_TARGET: 'ingress.sckools.com',
      INGRESS_A_RECORD: '216.198.79.1',
    };
    return s;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    schoolFindUnique.mockResolvedValue({ id: 'school-1', slug: 'raffles', name: 'Raffles' });
    domainFindUnique.mockResolvedValue(null);
  });

  const refuse = async (hostname: string) => {
    await expect(svc().add('school-1', hostname)).rejects.toThrow();
    expect(domainCreate).not.toHaveBeenCalled();
  };

  it("refuses a sibling school's address", async () => {
    await refuse('beacon.sckools.com');
  });

  it('refuses the API host', async () => {
    await refuse('api.sckools.com');
  });

  it('refuses the marketing apex', async () => {
    await refuse('sckools.com');
  });

  it('refuses the owner console', async () => {
    await refuse('owner.sckools.com');
  });

  it('refuses an unservable two-label name under the platform host', async () => {
    await refuse('www.raffles.sckools.com');
  });

  it('never attaches a name it refused — the hosting side stays clean', async () => {
    await refuse('beacon.sckools.com');
    expect(attach).not.toHaveBeenCalled();
  });

  describe('names that are legitimately this school’s', () => {
    it("accepts the school's own platform subdomain, typed as SUBDOMAIN", async () => {
      await svc().add('school-1', 'raffles.sckools.com');
      expect(domainCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'SUBDOMAIN' }) }),
      );
    });

    it('asks for NO www alias on a platform subdomain — that is the 409 that blocked removal', async () => {
      await svc().add('school-1', 'raffles.sckools.com');
      expect(attach).toHaveBeenCalledWith('raffles.sckools.com', { wwwAlias: false });
    });

    it('accepts a real custom domain, typed as CUSTOM, WITH the www alias', async () => {
      await svc().add('school-1', 'stmarys.edu.in');
      expect(domainCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'CUSTOM' }) }),
      );
      expect(attach).toHaveBeenCalledWith('stmarys.edu.in', { wwwAlias: true });
    });
  });
});

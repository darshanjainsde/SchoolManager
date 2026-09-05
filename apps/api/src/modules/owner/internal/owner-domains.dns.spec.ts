const resolveCname = jest.fn();
const resolve4 = jest.fn();

jest.mock('node:dns', () => ({ promises: { resolveCname, resolve4 } }));

import { OwnerDomainsService } from './owner-domains.service';
import type { HostingProviderService } from './hosting-provider.service';
import type { SchoolLookupService } from '../../tenancy';

/**
 * The DNS half of Verify, for the two kinds of name.
 *
 * A `<slug>.<platform>` address is answered by OUR wildcard, and the edge hands
 * every hostname its own anycast addresses — raffles.sckools.com came back
 * 216.198.79.1 while a healthy beacon.sckools.com came back 216.198.79.65.
 * Neither looks like ingress, so the custom-domain rule marked a perfectly
 * working school ERROR and told its operator to go fix a DNS record that only
 * we can see. Every school on the wildcard would have failed the same way.
 */
describe('OwnerDomainsService — does this name point here?', () => {
  function svc() {
    const s = new OwnerDomainsService({} as SchoolLookupService, {
      configured: true,
    } as HostingProviderService);
    (s as unknown as { env: Record<string, string> }).env = {
      PLATFORM_HOST: 'sckools.com',
      PLATFORM_OWNER_HOST: 'owner.sckools.com',
      INGRESS_CNAME_TARGET: 'ingress.sckools.com',
      INGRESS_A_RECORD: '198.51.100.7',
    };
    return s as unknown as {
      pointsHere(h: string, kind: 'SUBDOMAIN' | 'CUSTOM'): Promise<{ ok: boolean; detail: string }>;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resolveCname.mockRejectedValue(new Error('ENODATA'));
    resolve4.mockRejectedValue(new Error('ENODATA'));
  });

  describe('a platform subdomain', () => {
    // The addresses below are the real ones, and they are the whole point: the
    // wildcard's answer for a school shares NOTHING with what ingress resolves
    // to, so every branch of the custom-domain rule rejects it. If the
    // SUBDOMAIN branch is removed, these go red — which is how we know they
    // are testing that branch and not some other path that happens to accept.
    const ingressIps = ['198.51.100.7'];

    it('passes on the anycast addresses the wildcard actually returns', async () => {
      resolve4.mockImplementation(async (h: string) => {
        if (h === 'raffles.sckools.com') return ['216.198.79.1', '64.29.17.1'];
        if (h === 'ingress.sckools.com') return ingressIps;
        return [];
      });
      const r = await svc().pointsHere('raffles.sckools.com', 'SUBDOMAIN');
      expect(r.ok).toBe(true);
    });

    it('passes for a sibling whose anycast set is different again', async () => {
      resolve4.mockImplementation(async (h: string) => {
        if (h === 'beacon.sckools.com') return ['64.29.17.65', '216.198.79.65'];
        if (h === 'ingress.sckools.com') return ingressIps;
        return [];
      });
      expect((await svc().pointsHere('beacon.sckools.com', 'SUBDOMAIN')).ok).toBe(true);
    });

    it('never tells the operator to add a record they do not control', async () => {
      resolve4.mockImplementation(async (h: string) => {
        if (h === 'raffles.sckools.com') return ['216.198.79.1', '64.29.17.1'];
        if (h === 'ingress.sckools.com') return ingressIps;
        return [];
      });
      const r = await svc().pointsHere('raffles.sckools.com', 'SUBDOMAIN');
      expect(r.detail).not.toContain('CNAME');
      expect(r.detail).not.toContain('expected');
    });

    it('still fails when the name does not resolve at all — a missing wildcard is real', async () => {
      const r = await svc().pointsHere('raffles.sckools.com', 'SUBDOMAIN');
      expect(r.ok).toBe(false);
      expect(r.detail).toContain('wildcard');
    });
  });

  describe('a custom domain keeps the strict rule', () => {
    it('accepts a CNAME to our ingress', async () => {
      resolveCname.mockImplementation(async (h: string) =>
        h === 'sample.stmarys.edu.in' ? ['ingress.sckools.com'] : [],
      );
      expect((await svc().pointsHere('sample.stmarys.edu.in', 'CUSTOM')).ok).toBe(true);
    });

    it('accepts the published apex A record', async () => {
      resolve4.mockImplementation(async (h: string) => (h === 'stmarys.edu.in' ? ['198.51.100.7'] : []));
      expect((await svc().pointsHere('stmarys.edu.in', 'CUSTOM')).ok).toBe(true);
    });

    it('REFUSES a custom domain pointing somewhere else entirely', async () => {
      resolve4.mockImplementation(async (h: string) => (h === 'stmarys.edu.in' ? ['203.0.113.9'] : []));
      const r = await svc().pointsHere('stmarys.edu.in', 'CUSTOM');
      expect(r.ok).toBe(false);
      expect(r.detail).toContain('expected');
    });
  });
});

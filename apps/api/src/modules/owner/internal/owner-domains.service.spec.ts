import { OwnerDomainsService } from './owner-domains.service';
import type { HostingProviderService } from './hosting-provider.service';
import type { SchoolLookupService } from '../../tenancy';

/**
 * The DNS records this service hands out are typed into a registrar's form by
 * someone who cannot debug them. If the record is one the form rejects, the
 * school is simply stuck — which is exactly what happened: an apex domain was
 * told to create `A @ → ingress.skoolos.app`, and Hostinger answered "Value
 * must be a valid IPv4 address".
 */
describe('OwnerDomainsService — the records we hand a school', () => {
  function svc(configured: boolean) {
    const hosting = { configured } as HostingProviderService;
    const lookup = {} as SchoolLookupService;
    const s = new OwnerDomainsService(lookup, hosting);
    // The env is read once in the constructor; pin it so the assertions below
    // describe the contract rather than whatever .env happens to hold.
    (s as unknown as { env: Record<string, string> }).env = {
      INGRESS_CNAME_TARGET: 'ingress.sckools.com',
      INGRESS_A_RECORD: '216.198.79.1',
    };
    return s as unknown as {
      instructions(
        h: string,
        kind: 'SUBDOMAIN' | 'CUSTOM',
      ): { kind: string; host: string; value: string; note: string; alsoRequired: string };
    };
  }

  const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

  describe('an apex domain (archaiccandles.com)', () => {
    const i = svc(true).instructions('archaiccandles.com', 'CUSTOM');

    it('asks for an A record, because a root domain cannot hold a CNAME', () => {
      expect(i.kind).toBe('A');
      expect(i.host).toBe('@');
    });

    it('gives a literal IPv4 as the value — never a hostname', () => {
      expect(i.value).toMatch(IPV4);
      expect(i.value).toBe('216.198.79.1');
    });

    it('still names the CNAME target, for registrars that offer ALIAS/ANAME', () => {
      expect(i.note).toContain('ingress.sckools.com');
    });
  });

  describe('a subdomain (sample.archaiccandles.com)', () => {
    const i = svc(true).instructions('sample.archaiccandles.com', 'CUSTOM');

    it('asks for a CNAME on the leftmost label only', () => {
      expect(i.kind).toBe('CNAME');
      expect(i.host).toBe('sample');
      expect(i.value).toBe('ingress.sckools.com');
    });

    it('does not hand out a bare IP, so we can move hosts without touching the school', () => {
      expect(i.value).not.toMatch(IPV4);
    });
  });

  describe('the attach step', () => {
    it('is described as automatic when we hold hosting credentials', () => {
      expect(svc(true).instructions('archaiccandles.com', 'CUSTOM').alsoRequired).toContain('automatically');
    });

    it('is described as manual when we do not', () => {
      expect(svc(false).instructions('archaiccandles.com', 'CUSTOM').alsoRequired).toContain('hosting project');
    });
  });
});

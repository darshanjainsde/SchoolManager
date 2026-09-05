import { classifyDomain, platformHostFor, type HostPolicy } from './domain-kind';

const POLICY: HostPolicy = {
  platformHost: 'sckools.com',
  ownerHost: 'owner.sckools.com',
  ingressTarget: 'ingress.sckools.com',
};

const reason = (h: string, slug = 'raffles') => {
  const c = classifyDomain(h, POLICY, slug);
  if (c.ok) throw new Error(`expected ${h} to be refused, got kind ${c.kind}`);
  return c.reason;
};
const kind = (h: string, slug = 'raffles') => {
  const c = classifyDomain(h, POLICY, slug);
  if (!c.ok) throw new Error(`expected ${h} to be allowed, got: ${c.reason}`);
  return c.kind;
};

describe('classifyDomain', () => {
  describe('the platform is not a tenant', () => {
    it.each([
      ['sckools.com', 'the marketing apex'],
      ['owner.sckools.com', 'the owner console'],
      ['ingress.sckools.com', 'the ingress endpoint'],
    ])('refuses %s (%s)', (host) => {
      expect(reason(host)).toBeTruthy();
    });

    it('refuses the apex however it is typed', () => {
      expect(reason('SCKOOLS.COM')).toContain("platform's own address");
      expect(reason('sckools.com.')).toContain("platform's own address");
    });
  });

  describe("one school cannot claim another school's address", () => {
    it("refuses a sibling school's subdomain", () => {
      // The hijack: a LIVE Domain row outranks the slug convention in
      // SchoolLookupService, so beacon's URL would serve raffles' site.
      expect(reason('beacon.sckools.com', 'raffles')).toContain('reserved');
    });

    it('refuses api.sckools.com, which is the API, not a school', () => {
      expect(reason('api.sckools.com', 'raffles')).toContain('reserved');
    });

    it('allows a school its OWN subdomain', () => {
      expect(kind('raffles.sckools.com', 'raffles')).toBe('SUBDOMAIN');
    });

    it('is case-insensitive about the slug match', () => {
      expect(kind('RAFFLES.sckools.com', 'Raffles')).toBe('SUBDOMAIN');
    });
  });

  describe('a wildcard matches exactly one label', () => {
    it('refuses www.<school>.<platform> — unservable, and it caused a 409', () => {
      expect(reason('www.raffles.sckools.com', 'raffles')).toContain('single label');
    });

    it('refuses a deeper name even when the last label is the slug', () => {
      expect(reason('a.b.raffles.sckools.com', 'raffles')).toContain('single label');
    });
  });

  describe('real custom domains still work', () => {
    it.each(['stmarys.edu.in', 'www.stmarys.edu.in', 'archaiccandles.com', 'sckools.com.au'])(
      'classifies %s as CUSTOM',
      (host) => {
        expect(kind(host)).toBe('CUSTOM');
      },
    );

    it('does not mistake a lookalike suffix for the platform host', () => {
      // notsckools.com ends with "sckools.com" as a STRING but is a different
      // zone entirely; only a dot-delimited suffix counts.
      expect(kind('notsckools.com')).toBe('CUSTOM');
      expect(kind('mysckools.com')).toBe('CUSTOM');
    });
  });

  it('platformHostFor builds the always-on address', () => {
    expect(platformHostFor('raffles', 'sckools.com')).toBe('raffles.sckools.com');
  });
});

import { MailDomainCheck, reservedMailDomain } from './mail-domain';
import type { DnsResolver } from './email-check';

const dnsErr = (code: string) => Object.assign(new Error(code), { code });

function resolver(mx: () => Promise<{ exchange: string; priority: number }[]>, a: () => Promise<string[]> = async () => []) {
  const dns = { resolveMx: jest.fn(mx), resolve4: jest.fn(a) };
  return dns as DnsResolver & { resolveMx: jest.Mock; resolve4: jest.Mock };
}

describe('reservedMailDomain — names that can never take mail', () => {
  it.each([
    ['raffles.test', true],
    ['sample.TEST', true],
    ['school.example', true],
    ['x.invalid', true],
    ['box.localhost', true],
    ['office.local', true],
    ['example.com', true],
    ['mail.example.org', true],
    ['gmail.com', false],
    ['school.edu.in', false],
    // Ends in the letters, but is not the reserved name.
    ['notexample.com', false],
    ['contest', false],
  ])('%s → %s', (d, want) => expect(reservedMailDomain(d)).toBe(want));
});

describe('MailDomainCheck.whyUndeliverable', () => {
  it('a reserved test domain is refused without asking DNS', async () => {
    const dns = resolver(async () => [{ exchange: 'mx.raffles.test', priority: 1 }]);
    const why = await new MailDomainCheck(dns).whyUndeliverable('teacher1@raffles.test');
    expect(why).toMatch(/raffles\.test is a test domain/);
    expect(dns.resolveMx).not.toHaveBeenCalled();
  });

  it('a domain with a real MX takes mail', async () => {
    const dns = resolver(async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }]);
    expect(await new MailDomainCheck(dns).whyUndeliverable('ravi@gmail.com')).toBeNull();
  });

  it('a null MX (RFC 7505) says the domain accepts no mail', async () => {
    const dns = resolver(async () => [{ exchange: '.', priority: 0 }]);
    expect(await new MailDomainCheck(dns).whyUndeliverable('a@parked.in')).toMatch(/accepts no mail/);
  });

  it('no MX but an address record still takes mail (implicit MX)', async () => {
    const dns = resolver(async () => { throw dnsErr('ENODATA'); }, async () => ['203.0.113.7']);
    expect(await new MailDomainCheck(dns).whyUndeliverable('a@tiny-school.in')).toBeNull();
  });

  it('a name that does not exist at all is undeliverable', async () => {
    const dns = resolver(async () => { throw dnsErr('ENOTFOUND'); }, async () => { throw dnsErr('ENOTFOUND'); });
    expect(await new MailDomainCheck(dns).whyUndeliverable('a@gmial.cmo')).toBe('nothing receives mail at gmial.cmo');
  });

  it('a DNS outage is NOT a verdict: the letter goes, and nothing is remembered', async () => {
    const dns = resolver(async () => { throw dnsErr('ETIMEOUT'); });
    const check = new MailDomainCheck(dns);
    expect(await check.whyUndeliverable('a@school.in')).toBeNull();
    expect(await check.whyUndeliverable('b@school.in')).toBeNull();
    expect(dns.resolveMx).toHaveBeenCalledTimes(2);
  });

  it('a timeout on the address lookup after "no MX" is also not a verdict', async () => {
    const dns = resolver(async () => { throw dnsErr('ENODATA'); }, async () => { throw dnsErr('ESERVFAIL'); });
    expect(await new MailDomainCheck(dns).whyUndeliverable('a@school.in')).toBeNull();
  });

  it('asks DNS once per domain for a burst, and again after the answer expires', async () => {
    let now = 1_000;
    const dns = resolver(async () => { throw dnsErr('ENOTFOUND'); }, async () => { throw dnsErr('ENOTFOUND'); });
    const check = new MailDomainCheck(dns, () => now);
    for (let i = 0; i < 300; i += 1) expect(await check.whyUndeliverable(`p${i}@nowhere-school.in`)).not.toBeNull();
    expect(dns.resolveMx).toHaveBeenCalledTimes(1);
    now += 61 * 60_000;
    await check.whyUndeliverable('p@nowhere-school.in');
    expect(dns.resolveMx).toHaveBeenCalledTimes(2);
  });

  it('an address without a domain is refused', async () => {
    expect(await new MailDomainCheck(resolver(async () => [])).whyUndeliverable('no-at-sign')).toMatch(/no domain/);
  });
});

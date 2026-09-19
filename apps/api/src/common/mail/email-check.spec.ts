import { checkEmail, checkEmailSyntax, emailVerdictWords, normalizeEmail, type DnsResolver } from './email-check';

const dns = (mx: string[] = ['mx.example.com'], a: string[] = []): DnsResolver => ({
  resolveMx: async () => mx.map((exchange, i) => ({ exchange, priority: i })),
  resolve4: async () => a,
});
const none = async () => null;

describe('checkEmailSyntax', () => {
  it('normalises case and stray spaces', () => {
    expect(normalizeEmail('  Parent@Gmail.COM ')).toBe('parent@gmail.com');
  });
  it.each(['ravi', 'ravi@', '@gmail.com', 'ravi@gmail', 'ra vi@gmail.com', 'ravi..s@gmail.com'])('rejects %s as incomplete', (raw) => {
    expect(checkEmailSyntax(raw)).toMatchObject({ ok: false, reason: 'SYNTAX' });
  });
  it.each([
    ['ravi@gmial.com', 'ravi@gmail.com'],
    ['ravi@gmail.con', 'ravi@gmail.com'],
    ['ravi@yaho.com', 'ravi@yahoo.com'],
    ['ravi@hotmial.com', 'ravi@hotmail.com'],
    ['ravi@redifmail.com', 'ravi@rediffmail.com'],
  ])('offers the fix for %s', (raw, want) => {
    expect(checkEmailSyntax(raw)).toMatchObject({ ok: false, reason: 'TYPO', suggestion: want });
  });
  it('flags a throw-away provider', () => {
    expect(checkEmailSyntax('x@mailinator.com')).toMatchObject({ ok: false, reason: 'DISPOSABLE' });
  });
  it('accepts a good address', () => {
    expect(checkEmailSyntax('sunita.sharma@gmail.com')).toEqual({ ok: true, normalized: 'sunita.sharma@gmail.com' });
  });
});

describe('checkEmail (with the domain and our bounce memory)', () => {
  it('a domain with an MX passes', async () => {
    expect(await checkEmail('ravi@gmail.com', { dns: dns(), isSuppressed: none })).toEqual({ ok: true, normalized: 'ravi@gmail.com' });
  });
  it('no MX but an A record still passes (small school domains often have only A)', async () => {
    const d: DnsResolver = { resolveMx: async () => { throw new Error('ENODATA'); }, resolve4: async () => ['1.2.3.4'] };
    expect(await checkEmail('office@raffles.in', { dns: d, isSuppressed: none })).toMatchObject({ ok: true });
  });
  it('neither MX nor A means nothing will ever accept mail there', async () => {
    const d: DnsResolver = { resolveMx: async () => { throw new Error('ENOTFOUND'); }, resolve4: async () => { throw new Error('ENOTFOUND'); } };
    expect(await checkEmail('ravi@gmaail.co.in', { dns: d, isSuppressed: none })).toMatchObject({ ok: false, reason: 'NO_MAIL_SERVER' });
  });
  it('a null MX ("." — the domain refuses mail) counts as no server', async () => {
    expect(await checkEmail('ravi@nomail.example', { dns: dns(['.']), isSuppressed: none })).toMatchObject({ ok: false, reason: 'NO_MAIL_SERVER' });
  });
  it('an address that bounced before is called out with the reason', async () => {
    const v = await checkEmail('old@gmail.com', { dns: dns(), isSuppressed: async () => ({ reason: 'BOUNCE', detail: 'mailbox does not exist' }) });
    expect(v).toMatchObject({ ok: false, reason: 'BOUNCED_BEFORE', detail: 'mailbox does not exist' });
    expect(emailVerdictWords(v)).toBe('Mail to this address bounced before (mailbox does not exist). Confirm it with the family.');
  });
  it('syntax problems never touch the network', async () => {
    const d: DnsResolver = { resolveMx: jest.fn(), resolve4: jest.fn() };
    await checkEmail('nope', { dns: d, isSuppressed: none });
    expect(d.resolveMx).not.toHaveBeenCalled();
  });
});

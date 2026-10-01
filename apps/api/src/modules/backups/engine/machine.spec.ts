import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { openFeeSecret, openMailSecret, sealFeeSecret, sealMailSecret } from '../../../common/crypto/machine-secrets';
import {
  Machine, SEALED_COLUMNS, machineFromEnv, makeRewriter, openRowSecrets, resealSecret, rewritesFor, transformDomain,
} from './machine';

const SCHOOL = '834652cc-876d-417a-b3cf-498b46d2320f';
const fee = SEALED_COLUMNS.find((c) => c.kind === 'fee-map')!;
const mail = SEALED_COLUMNS.find((c) => c.kind === 'mail')!;
const key = (n: number) => Buffer.alloc(32, n);
const machine = (over: Partial<Machine> = {}): Machine => ({
  platformHost: 'test.sckools.com', publicBase: 'https://abc.supabase.co/storage/v1/object/public/sckool-files',
  feesMaster: 'staging-master', mailKey: key(1), ...over,
});
const laptop = machine({ platformHost: 'localhost', publicBase: 'http://localhost:9000/skoolos', feesMaster: 'laptop-master', mailKey: key(2) });

describe('fee gateway secrets move to a machine with different keys', () => {
  const src = machine();
  const row = { id: 'cfg-1', secrets: { merchantKey: sealFeeSecret('staging-master', SCHOOL, 'mk_live_123'), saltKey: sealFeeSecret('staging-master', SCHOOL, 'salt-9') } };

  it('opens on the source, re-seals on the target, and the target can use them', () => {
    const { secret, warnings } = openRowSecrets(fee, row, SCHOOL, src);
    expect(warnings).toEqual([]);
    const { value, warnings: w2 } = resealSecret(secret!, SCHOOL, laptop);
    expect(w2).toEqual([]);
    const v = value as Record<string, string>;
    expect(openFeeSecret('laptop-master', SCHOOL, v.merchantKey)).toBe('mk_live_123');
    expect(openFeeSecret('laptop-master', SCHOOL, v.saltKey)).toBe('salt-9');
    expect(() => openFeeSecret('staging-master', SCHOOL, v.merchantKey)).toThrow();
  });

  it('a value sealed under some OTHER key is reported and dropped — never carried as a dead credential', () => {
    const mixed = { id: 'cfg-2', secrets: { good: sealFeeSecret('staging-master', SCHOOL, 'ok'), stale: sealFeeSecret('old-rotated-key', SCHOOL, 'x') } };
    const { secret, warnings } = openRowSecrets(fee, mixed, SCHOOL, src);
    expect(warnings.map((w) => [w.column, w.reason])).toEqual([['secrets.stale', 'sealed with a different FEES_SECRET_KEY']]);
    const out = resealSecret(secret!, SCHOOL, laptop);
    expect(Object.keys(out.value as object)).toEqual(['good']);
    expect(out.warnings.map((w) => w.column)).toEqual(['secrets.stale']);
  });

  it('a source with no FEES_SECRET_KEY exports a warning, not a crash', () => {
    const { warnings } = openRowSecrets(fee, row, SCHOOL, machine({ feesMaster: null }));
    expect(warnings).toHaveLength(2);
    expect(warnings[0].reason).toBe('this machine has no FEES_SECRET_KEY');
  });

  it('a target with no FEES_SECRET_KEY stores nothing and says "enter it again"', () => {
    const { secret } = openRowSecrets(fee, row, SCHOOL, src);
    const out = resealSecret(secret!, SCHOOL, machine({ feesMaster: null }));
    expect(out.value).toEqual({});
    expect(out.warnings.every((w) => /enter it again/.test(w.reason))).toBe(true);
  });

  it('an empty or missing map carries nothing', () => {
    expect(openRowSecrets(fee, { id: 'x', secrets: {} }, SCHOOL, src).secret).toBeNull();
    expect(openRowSecrets(fee, { id: 'x', secrets: null }, SCHOOL, src).secret).toBeNull();
  });
});

describe('the school mailbox password moves the same way', () => {
  it('round-trips between machines', () => {
    const row = { id: 'em-1', smtpPassEnc: sealMailSecret(key(1), 'p@ss wörd') };
    const { secret } = openRowSecrets(mail, row, SCHOOL, machine());
    const { value } = resealSecret(secret!, SCHOOL, laptop);
    expect(openMailSecret(key(2), value as string)).toBe('p@ss wörd');
  });

  it('garbage, a wrong key, or no key on either side becomes "enter the password again"', () => {
    expect(openRowSecrets(mail, { id: 'e', smtpPassEnc: 'not-sealed' }, SCHOOL, machine()).warnings).toHaveLength(1);
    expect(openRowSecrets(mail, { id: 'e', smtpPassEnc: sealMailSecret(key(9), 'x') }, SCHOOL, machine()).warnings).toHaveLength(1);
    const { secret } = openRowSecrets(mail, { id: 'e', smtpPassEnc: sealMailSecret(key(1), 'x') }, SCHOOL, machine());
    expect(resealSecret(secret!, SCHOOL, machine({ mailKey: null })).value).toBeNull();
    expect(openRowSecrets(mail, { id: 'e', smtpPassEnc: null }, SCHOOL, machine()).secret).toBeNull();
  });

  it('a malformed EMAIL_SECRET_KEY makes the machine keyless instead of crashing the backup', () => {
    const m = machineFromEnv({ PLATFORM_HOST: 'Test.Sckools.com', S3_ENDPOINT: 'http://minio:9000/', S3_BUCKET: 'b', EMAIL_SECRET_KEY: 'too-short' }, null);
    expect(m.mailKey).toBeNull();
    expect(m.platformHost).toBe('test.sckools.com');
    expect(m.publicBase).toBe('http://minio:9000/b');
  });
});

describe('file links and the school address follow the target machine', () => {
  const src = { ...machine(), slug: 'snsps' };
  const dst = { ...laptop, slug: 'snsps' };
  const rw = makeRewriter(rewritesFor(src, dst));
  const S = src.publicBase;

  it('rewrites storage links in plain columns, arrays and deep JSON (page blocks, section variants)', () => {
    const row = {
      url: `${S}/schools/${SCHOOL}/logo/a.png`,
      footerLines: [`See ${S}/schools/${SCHOOL}/fees/p.pdf`],
      blocks: [{ t: 'img', url: `${S}/schools/${SCHOOL}/gallery/g.jpg`, caption: null }, { t: 'cta', href: 'https://snsps.test.sckools.com/admissions' }],
    };
    expect(rw(row)).toEqual({
      url: `http://localhost:9000/skoolos/schools/${SCHOOL}/logo/a.png`,
      footerLines: [`See http://localhost:9000/skoolos/schools/${SCHOOL}/fees/p.pdf`],
      blocks: [{ t: 'img', url: `http://localhost:9000/skoolos/schools/${SCHOOL}/gallery/g.jpg`, caption: null }, { t: 'cta', href: 'https://snsps.localhost/admissions' }],
    });
  });

  it('does not touch a neighbouring bucket whose name merely starts the same', () => {
    expect(rw(`${S}-archive/schools/x.png`)).toBe(`${S}-archive/schools/x.png`);
  });

  it('never re-rewrites its own output when the new address contains the old one', () => {
    const grow = makeRewriter(rewritesFor({ ...src }, { ...src, publicBase: `${S}/v2` }));
    expect(grow(`${S}/a.png`)).toBe(`${S}/v2/a.png`);
  });

  it('renames the address when the school is imported under a new slug', () => {
    const renamed = makeRewriter(rewritesFor(src, { ...src, slug: 'snsps-demo' }));
    expect(renamed('https://snsps.test.sckools.com/p/faculty')).toBe('https://snsps-demo.test.sckools.com/p/faculty');
    expect(renamed('https://xsnsps.test.sckools.com/')).toBe('https://xsnsps.test.sckools.com/');
  });

  it('changes nothing at all when restoring onto the same machine', () => {
    expect(rewritesFor(src, src)).toEqual([]);
    const same = makeRewriter([]);
    const v = { a: [`${S}/x`] };
    expect(same(v)).toBe(v);
  });

  it('leaves numbers, booleans, nulls and dates alone', () => {
    expect(rw({ n: 3, b: false, z: null, d: '2026-10-01T10:00:00' })).toEqual({ n: 3, b: false, z: null, d: '2026-10-01T10:00:00' });
  });
});

describe('domains on the new machine', () => {
  const src = { ...machine(), slug: 'snsps' };
  const dst = { ...laptop, slug: 'snsps' };

  it('the school’s own subdomain moves to the target host', () => {
    expect(transformDomain({ hostname: 'SNSPS.test.sckools.com', status: 'LIVE' }, src, dst)).toMatchObject({ hostname: 'snsps.localhost', status: 'LIVE', type: 'SUBDOMAIN' });
  });

  it('a custom domain must be verified again on a different machine', () => {
    expect(transformDomain({ hostname: 'www.snspsladwa.org', status: 'LIVE', type: 'CUSTOM' }, src, dst)).toMatchObject({ hostname: 'www.snspsladwa.org', status: 'PENDING' });
  });

  it('…but stays live when restoring onto the same machine', () => {
    expect(transformDomain({ hostname: 'www.snspsladwa.org', status: 'LIVE' }, src, src).status).toBe('LIVE');
  });
});

describe('nothing else in the API seals data with a machine key', () => {
  // The backup is only portable if every machine-bound secret is registered.
  // Any NEW file that encrypts with createCipheriv must be added to
  // SEALED_COLUMNS (and here) or backups would carry values no other machine can read.
  const ALLOWED = new Set([
    'common/crypto/machine-secrets.ts',
    'modules/backups/engine/container.ts',
  ]);
  it('every createCipheriv call is in the registry', () => {
    const root = join(__dirname, '../../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(n) && !/\.spec\.ts$/.test(n) && / 2\.ts$/.test(n) === false && /createCipheriv\s*\(/.test(readFileSync(p, 'utf8'))) {
          hits.push(relative(root, p));
        }
      }
    };
    walk(root);
    expect(hits.filter((h) => !ALLOWED.has(h))).toEqual([]);
  });
});

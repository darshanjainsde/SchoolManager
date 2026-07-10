import { authenticator } from 'otplib';
import { verifyTotp } from './owner-auth.service';

describe('verifyTotp', () => {
  const secret = 'AIRFGVZFLVAH6J2C';
  it('accepts a current code', () => {
    expect(verifyTotp(authenticator.generate(secret), secret)).toBe(true);
  });
  it('rejects a wrong code', () => {
    expect(verifyTotp('000000', secret)).toBe(false);
  });
  it('rejects when secret is null', () => {
    expect(verifyTotp('123456', null)).toBe(false);
  });
});

import { gatePasswordMatches } from './owner-auth.service';

describe('gatePasswordMatches', () => {
  it('accepts the exact configured password', () => {
    expect(gatePasswordMatches('s3cret-gate', 's3cret-gate')).toBe(true);
  });
  it('rejects a wrong password', () => {
    expect(gatePasswordMatches('nope', 's3cret-gate')).toBe(false);
  });
  it('rejects everything when the gate is not configured', () => {
    expect(gatePasswordMatches('anything', undefined)).toBe(false);
    expect(gatePasswordMatches('', undefined)).toBe(false);
  });
  it('is not fooled by different-length candidates (no length leak crash)', () => {
    expect(gatePasswordMatches('s3cret-gate-longer-than-expected', 's3cret-gate')).toBe(false);
  });
});

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

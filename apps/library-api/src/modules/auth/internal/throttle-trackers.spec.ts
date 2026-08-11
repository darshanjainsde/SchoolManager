import { createHash } from 'node:crypto';
import { loginIdentityTracker, refreshIdentityTracker } from './throttle-trackers';

const TENANT_A = { kind: 'tenant', orgId: 'org-a', hostname: 'a.example.com' };
const TENANT_B = { kind: 'tenant', orgId: 'org-b', hostname: 'b.example.com' };

describe('loginIdentityTracker', () => {
  it('keys on (org, identifier), not IP', () => {
    const key = loginIdentityTracker({ ip: '10.0.0.1', org: TENANT_A, body: { identifier: 'a@x.com' } });
    expect(key).toBe('login:org-a:a@x.com');
  });

  it('two different identifiers behind the same IP produce different keys', () => {
    const req = (identifier: string) => ({ ip: '10.0.0.1', org: TENANT_A, body: { identifier } });
    expect(loginIdentityTracker(req('a@x.com'))).not.toBe(loginIdentityTracker(req('b@x.com')));
  });

  it('the same identifier from two different IPs produces the SAME key', () => {
    const req = (ip: string) => ({ ip, org: TENANT_A, body: { identifier: 'a@x.com' } });
    expect(loginIdentityTracker(req('10.0.0.1'))).toBe(loginIdentityTracker(req('10.0.0.2')));
  });

  it('the same identifier in two different orgs produces different keys', () => {
    const req = (org: typeof TENANT_A) => ({ ip: '10.0.0.1', org, body: { identifier: 'a@x.com' } });
    expect(loginIdentityTracker(req(TENANT_A))).not.toBe(loginIdentityTracker(req(TENANT_B)));
  });

  it('normalises identifier case and surrounding whitespace, so they collide onto one bucket', () => {
    const a = loginIdentityTracker({ ip: '10.0.0.1', org: TENANT_A, body: { identifier: 'A@X.com' } });
    const b = loginIdentityTracker({ ip: '10.0.0.1', org: TENANT_A, body: { identifier: '  a@x.com  ' } });
    expect(a).toBe(b);
  });

  it('falls back to IP when the body has no identifier at all', () => {
    expect(loginIdentityTracker({ ip: '10.0.0.1', org: TENANT_A, body: {} })).toBe('ip:10.0.0.1');
  });

  it('falls back to hostname when no tenant org was resolved', () => {
    const key = loginIdentityTracker({
      ip: '10.0.0.1',
      org: { kind: 'unknown', hostname: 'nope.example.com' },
      body: { identifier: 'a@x.com' },
    });
    expect(key).toBe('login:host:nope.example.com:a@x.com');
  });
});

describe('refreshIdentityTracker', () => {
  const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

  it('keys on a hash of the refresh token, never the raw token', () => {
    const key = refreshIdentityTracker({ ip: '10.0.0.1', body: { refreshToken: 'raw-token-1' } });
    expect(key).toBe(`refresh:${hash('raw-token-1')}`);
    expect(key).not.toContain('raw-token-1');
  });

  it('two different tokens behind the same IP produce different keys', () => {
    const req = (t: string) => ({ ip: '10.0.0.1', body: { refreshToken: t } });
    expect(refreshIdentityTracker(req('token-a'))).not.toBe(refreshIdentityTracker(req('token-b')));
  });

  it('the same token from two different IPs produces the SAME key', () => {
    const req = (ip: string) => ({ ip, body: { refreshToken: 'token-a' } });
    expect(refreshIdentityTracker(req('10.0.0.1'))).toBe(refreshIdentityTracker(req('10.0.0.2')));
  });

  it('falls back to IP when the body has no refreshToken at all', () => {
    expect(refreshIdentityTracker({ ip: '10.0.0.1', body: {} })).toBe('ip:10.0.0.1');
  });
});

import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LibJwtGuard } from './lib-jwt.guard';
import { loadLibraryEnv } from '../../../config/env';

const ORG_A = '33333333-3333-4333-8333-333333333333';
const ORG_B = '44444444-4444-4444-8444-444444444444';

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

/**
 * Real JwtService, real jsonwebtoken sign/verify — no mocked crypto. Only
 * the request object (headers + host-resolved org) is faked. This is the
 * regression test for the cross-org binding: the sole reason the
 * unauthenticated `X-Library-Host` header is safe is that a token minted for
 * org A is provably rejected against org B's resolved context, and that
 * property needs a test that has been seen to fail (see report for the
 * deliberate-break run).
 */
function signToken(jwt: JwtService, overrides: Record<string, unknown> = {}): string {
  const payload = { sub: 'u1', org: ORG_A, role: 'LIBRARIAN', branches: [] as string[], aud: 'library', ...overrides };
  // No `audience` sign option: the payload already carries `aud` and
  // jsonwebtoken rejects signing when both are present (see auth.module.ts).
  return jwt.sign(payload, { secret: loadLibraryEnv().LIBRARY_JWT_SECRET, expiresIn: '15m' });
}

const TENANT_A = { kind: 'tenant', orgId: ORG_A, orgSlug: 'org-a', hostname: 'org-a.example.com' };
const TENANT_B = { kind: 'tenant', orgId: ORG_B, orgSlug: 'org-b', hostname: 'org-b.example.com' };

describe('LibJwtGuard', () => {
  const jwt = new JwtService();
  const guard = new LibJwtGuard(jwt);

  it('allows a valid token whose org matches the host-resolved org, and populates req.user', () => {
    const token = signToken(jwt);
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, org: TENANT_A };
    expect(guard.canActivate(makeContext(req))).toBe(true);
    expect(req.user).toMatchObject({ sub: 'u1', org: ORG_A, role: 'LIBRARIAN', aud: 'library' });
  });

  it('rejects a valid token for org A against a request whose resolved org is B', () => {
    const token = signToken(jwt, { org: ORG_A });
    const req = { headers: { authorization: `Bearer ${token}` }, org: TENANT_B };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects when no tenant has been resolved for the request (req.org absent)', () => {
    const token = signToken(jwt);
    const req = { headers: { authorization: `Bearer ${token}` } };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects when the resolved host is not a known tenant (kind: "unknown")', () => {
    const token = signToken(jwt);
    const req = { headers: { authorization: `Bearer ${token}` }, org: { kind: 'unknown', hostname: 'nope.example.com' } };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects a token with the wrong audience, even with a valid secret and matching org', () => {
    const token = signToken(jwt, { aud: 'not-library' });
    const req = { headers: { authorization: `Bearer ${token}` }, org: TENANT_A };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects a missing Authorization header', () => {
    const req = { headers: {}, org: TENANT_A };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects an Authorization header that does not start with "Bearer "', () => {
    const req = { headers: { authorization: 'Token abc123' }, org: TENANT_A };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });
});

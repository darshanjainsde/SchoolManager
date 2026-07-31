import { portalForRole, resolveStartRoute } from '../roles';
import type { Session } from '../session';

it.each([
  ['STUDENT', '/(family)/home'],
  ['TEACHER', '/(staff)/today'],
  ['SCHOOL_ADMIN', '/(staff)/today'],
  // STAFF gets its OWN group now — (staff) is actually the teacher/admin
  // portal (misleadingly named), which a non-teaching staff login must
  // never land in. See roles.ts's portalForRole doc.
  ['STAFF', '/(worker)/today'],
] as const)('%s → %s', (role, path) => {
  expect(portalForRole(role)).toBe(path);
});

it('rejects OWNER (web-only)', () => {
  expect(() => portalForRole('OWNER')).toThrow(/web/i);
});

describe('resolveStartRoute', () => {
  const sessionFor = (role: Session['role']): Session => ({
    accessToken: 'at', refreshToken: 'rt', role,
    schoolHost: 'raffles.sckools.com', displayName: 'id',
  });

  // Regression: a persisted OWNER session (web-only role) must never brick the
  // bootstrap — resolveStartRoute must fall back to a real route instead of
  // letting portalForRole's throw propagate.
  it('falls back to login for a persisted OWNER session with a stored host', () => {
    expect(resolveStartRoute(sessionFor('OWNER'), 'raffles.sckools.com')).toBe('/(auth)/login');
  });

  it('falls back to connect for a persisted OWNER session with no stored host', () => {
    expect(resolveStartRoute(sessionFor('OWNER'), null)).toBe('/(auth)/connect');
  });

  it('routes a valid session straight to its portal', () => {
    expect(resolveStartRoute(sessionFor('STUDENT'), 'raffles.sckools.com')).toBe('/(family)/home');
    expect(resolveStartRoute(sessionFor('TEACHER'), 'raffles.sckools.com')).toBe('/(staff)/today');
  });

  it('routes to login when there is no session but a host is stored', () => {
    expect(resolveStartRoute(null, 'raffles.sckools.com')).toBe('/(auth)/login');
  });

  it('routes to connect when there is no session and no stored host', () => {
    expect(resolveStartRoute(null, null)).toBe('/(auth)/connect');
  });
});

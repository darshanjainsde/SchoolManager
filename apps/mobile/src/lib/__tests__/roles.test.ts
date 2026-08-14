import { portalForRole, resolveStartRoute } from '../roles';
import type { Session } from '../session';

it.each([
  ['STUDENT', '/(family)/(tabs)/home'],
  ['TEACHER', '/(staff)/(tabs)/home'],
  // STAFF gets its OWN group now — (staff) is actually the teacher portal
  // (misleadingly named), which a non-teaching staff login must never land
  // in. See roles.ts's portalForRole doc.
  ['STAFF', '/(worker)/today'],
] as const)('%s → %s', (role, path) => {
  expect(portalForRole(role)).toBe(path);
});

it('rejects OWNER (web-only)', () => {
  expect(() => portalForRole('OWNER')).toThrow(/web/i);
});

// The app is for teachers and families — a school admin runs the school from
// the web console, and the mobile staff portal is teacher-shaped (their own
// day, their own registers). Same refusal contract as OWNER.
it('rejects SCHOOL_ADMIN (web-only)', () => {
  expect(() => portalForRole('SCHOOL_ADMIN')).toThrow(/web console/i);
});

// LIBRARIAN is a real tenant role with a real login, and the app has no
// counter to send her to. Before this case existed the switch fell through and
// returned undefined, which the bootstrap passed to the router as a route.
it('rejects LIBRARIAN (the counter is a web screen)', () => {
  expect(() => portalForRole('LIBRARIAN')).toThrow(/web console/i);
});

describe('resolveStartRoute', () => {
  const sessionFor = (role: Session['role']): Session => ({
    accessToken: 'at', refreshToken: 'rt', role,
    schoolHost: 'raffles.sckools.com', displayName: 'id',
  });

  // Regression: a persisted OWNER session (web-only role) must never brick the
  // bootstrap — resolveStartRoute must fall back to a real route instead of
  // letting portalForRole's throw propagate.
  it('falls back to the gate for a persisted OWNER session', () => {
    expect(resolveStartRoute(sessionFor('OWNER'))).toBe('/(auth)/login');
  });

  // Same contract for a librarian: the login screen surfaces the message and
  // clears the session rather than the app bricking on an undefined route.
  it('falls back to the gate for a persisted LIBRARIAN session', () => {
    expect(resolveStartRoute(sessionFor('LIBRARIAN'))).toBe('/(auth)/login');
  });

  it('routes a valid session straight to its portal', () => {
    expect(resolveStartRoute(sessionFor('STUDENT'))).toBe('/(family)/(tabs)/home');
    expect(resolveStartRoute(sessionFor('TEACHER'))).toBe('/(staff)/(tabs)/home');
  });

  // The connect (school-code) screen is gone: signed out always means the
  // gate, host cache or not — the identifier resolves the school by itself.
  it('routes to the gate when there is no session', () => {
    expect(resolveStartRoute(null)).toBe('/(auth)/login');
  });
});

import { portalForRole, portalForSession, resolveStartRoute } from '../roles';
import type { Session } from '../session';

it.each([
  ['STUDENT', '/(family)/(tabs)/home'],
  ['TEACHER', '/(staff)/(tabs)/home'],
  // STAFF gets its OWN group now — (staff) is actually the teacher portal
  // (misleadingly named), which a non-teaching staff login must never land
  // in. See roles.ts's portalForRole doc.
  ['STAFF', '/(worker)/(tabs)/today'],
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
it('rejects a legacy LIBRARIAN login as unmigrated, not as "the counter is on the web"', () => {
  expect(() => portalForRole('LIBRARIAN')).toThrow(/ask the office/i);
});

// An alumnus can sign in — the API applies no role filter to the password
// door — and the app had no case for them. The switch returned undefined,
// nothing threw, so the boot guard never cleared the session, and the app sat
// on the logo forever on every launch. This must THROW, because throwing is
// what makes the bootstrap clear the persisted session.
it('rejects ALUMNUS by throwing, so the bad session is cleared rather than kept', () => {
  expect(() => portalForRole('ALUMNUS')).toThrow(/website/i);
});

describe('portalForSession', () => {
  const staff = (staffRole: string, features: string[]): Session => ({
    accessToken: 'at', refreshToken: 'rt', role: 'STAFF', staffRole, features,
    schoolHost: 'raffles.sckools.com', displayName: 'id',
  });
  // An accounts officer opens on Pay when the school runs pay here, and on
  // Leave — not on a hidden tab — when it does not. Before, the job needed
  // SALARY to exist at all and they landed on the general Today.
  it('lands an accounts officer on the desk they are actually allowed', () => {
    expect(portalForSession(staff('ACCOUNTS', ['SALARY']))).toBe('/(worker)/(tabs)/paydesk');
    expect(portalForSession(staff('ACCOUNTS', []))).toBe('/(worker)/(tabs)/leavedesk');
    expect(portalForSession(staff('DRIVER', []))).toBe('/(worker)/(tabs)/today');
  });
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

describe('portalForSession — the worker portal has three desks', () => {
  const { portalForSession } = jest.requireActual('../roles') as typeof import('../roles');
  const base = { accessToken: 'a', refreshToken: 'r', schoolHost: 'x.sckools.com', displayName: 'S' };
  it('a sports teacher lands on the desk, a librarian on the counter, other staff on Today', () => {
    expect(portalForSession({ ...base, role: 'STAFF', staffRole: 'SPORTS', features: ['SPORTS'] })).toBe('/(worker)/(tabs)/desk');
    expect(portalForSession({ ...base, role: 'STAFF', staffRole: 'LIBRARIAN', features: ['LIBRARY'] })).toBe('/(worker)/(tabs)/counter');
    expect(portalForSession({ ...base, role: 'STAFF', staffRole: 'OFFICE', features: [] })).toBe('/(worker)/(tabs)/today');
  });
  it('non-staff roles are unchanged', () => {
    expect(portalForSession({ ...base, role: 'TEACHER' })).toBe('/(staff)/(tabs)/home');
    expect(portalForSession({ ...base, role: 'STUDENT' })).toBe('/(family)/(tabs)/home');
  });
});

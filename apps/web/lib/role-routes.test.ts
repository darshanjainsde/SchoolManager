import { describe, it, expect } from 'vitest';
import { homeForRole } from './role-routes';

describe('homeForRole', () => {
  it('routes STUDENT to /portal', () => {
    expect(homeForRole('STUDENT')).toBe('/portal');
  });

  it('routes TEACHER to /teacher', () => {
    expect(homeForRole('TEACHER')).toBe('/teacher');
  });

  it('routes STAFF to /staff — the new minimal portal, not the admin console', () => {
    expect(homeForRole('STAFF')).toBe('/staff');
  });

  it('routes SCHOOL_ADMIN to /app', () => {
    expect(homeForRole('SCHOOL_ADMIN')).toBe('/app');
  });

  it('falls back to /login for an unroutable or missing role (e.g. OWNER, undefined)', () => {
    expect(homeForRole('OWNER')).toBe('/login');
    expect(homeForRole(undefined)).toBe('/login');
  });

  it('sends a LIBRARIAN to the library counter, never the admin console', () => {
    // The whole point of LIBRARIAN being its own role: she must not land on
    // /app and see students, staff and fees.
    expect(homeForRole('LIBRARIAN')).toBe('/library');
  });

  it('keeps the counter OUTSIDE the /app segment', () => {
    // Not cosmetic. An App Router ancestor layout cannot be escaped, so a
    // counter under /app would inherit the admin sidebar and the admin
    // layout's own `role !== 'SCHOOL_ADMIN'` redirect no matter what its own
    // layout did. This assertion is what stops it drifting back.
    expect(homeForRole('LIBRARIAN').startsWith('/app')).toBe(false);
  });
});

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

  it('routes the librarian (STAFF + staffRole LIBRARIAN) to /library', () => {
    expect(homeForRole('STAFF', 'LIBRARIAN')).toBe('/library');
    // Any other staff kind — or an unknown/missing staffRole — stays on /staff.
    expect(homeForRole('STAFF', 'OFFICE')).toBe('/staff');
    expect(homeForRole('STAFF', null)).toBe('/staff');
    // staffRole never redirects other roles.
    expect(homeForRole('TEACHER', 'LIBRARIAN')).toBe('/teacher');
  });

  it('routes SCHOOL_ADMIN to /app', () => {
    expect(homeForRole('SCHOOL_ADMIN')).toBe('/app');
  });

  it('falls back to /login for an unroutable or missing role (e.g. OWNER, undefined)', () => {
    expect(homeForRole('OWNER')).toBe('/login');
    expect(homeForRole(undefined)).toBe('/login');
  });

  it('treats the retired LIBRARIAN login role as unroutable', () => {
    // The first library line modelled the librarian as a UserRole. The Library
    // Wing replaced that: the librarian is ordinary STAFF whose Staff.role is
    // LIBRARIAN (asserted above), and the library_wing migration folds any
    // legacy LIBRARIAN users back to STAFF. A token still carrying the old
    // role gets no portal — /login, where a fresh sign-in mints the new shape.
    expect(homeForRole('LIBRARIAN')).toBe('/login');
  });

  it('keeps the counter OUTSIDE the /app segment', () => {
    // Not cosmetic. An App Router ancestor layout cannot be escaped, so a
    // counter under /app would inherit the admin sidebar and the admin
    // layout's own `role !== 'SCHOOL_ADMIN'` redirect no matter what its own
    // layout did. This assertion is what stops it drifting back.
    expect(homeForRole('LIBRARIAN').startsWith('/app')).toBe(false);
  });

  it('sends an alumnus to the alumni page, not round the login loop', () => {
    // Before ALUMNUS was added here it fell to `default` and returned /login —
    // from which a successful login would route back to /login, forever.
    expect(homeForRole('ALUMNUS')).toBe('/alumni');
  });

  it('keeps the alumni page OUTSIDE /app', () => {
    // /alumni is the school's public site in the school's own theme. Under
    // /app it would inherit the admin sidebar and the admin layout's
    // `role !== 'SCHOOL_ADMIN'` redirect, which would bounce every alumnus.
    expect(homeForRole('ALUMNUS').startsWith('/app')).toBe(false);
  });
});

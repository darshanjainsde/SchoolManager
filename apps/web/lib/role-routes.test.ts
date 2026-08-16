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
});

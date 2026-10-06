import { describe, it, expect } from 'vitest';
import { deskModel } from '../app/app/nav-model';
import { consoleBounce, consoleDeskFor, homeForRole } from './role-routes';

describe('homeForRole', () => {
  it('routes the admissions officer (STAFF + staffRole ADMISSIONS) to the enquiries desk, and no other role there', () => {
    expect(homeForRole('STAFF', 'ADMISSIONS')).toBe('/app/enquiries');
    expect(homeForRole('TEACHER', 'ADMISSIONS')).toBe('/teacher');
    expect(homeForRole('SCHOOL_ADMIN', 'ADMISSIONS')).toBe('/app');
  });

  it('routes STUDENT to /portal', () => {
    expect(homeForRole('STUDENT')).toBe('/portal');
  });

  it('routes TEACHER to /teacher', () => {
    expect(homeForRole('TEACHER')).toBe('/teacher');
  });

  it('routes STAFF to /staff — the new minimal portal, not the admin console', () => {
    expect(homeForRole('STAFF')).toBe('/staff');
  });

  it('routes the accounts officer (STAFF + staffRole ACCOUNTS) to Pay, and no other role there', () => {
    // The JOB opens the door; SalaryGuard still asks whether they hold the
    // salary right. Landing them anywhere else would mean a login that has to
    // be told where its own work is.
    expect(homeForRole('STAFF', 'ACCOUNTS')).toBe('/app/pay');
    expect(homeForRole('TEACHER', 'ACCOUNTS')).toBe('/teacher');
    expect(homeForRole('SCHOOL_ADMIN', 'ACCOUNTS')).toBe('/app');
    expect(homeForRole('STAFF', null)).toBe('/staff');
  });

  it('routes the sports teacher (STAFF + staffRole SPORTS) to /sports, and no other role there', () => {
    expect(homeForRole('STAFF', 'SPORTS')).toBe('/sports');
    expect(homeForRole('TEACHER', 'SPORTS')).toBe('/teacher');
    expect(homeForRole('SCHOOL_ADMIN', 'SPORTS')).toBe('/app');
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

/**
 * The /app layout used to replace every non-admin to `homeForRole` on EVERY
 * path — including the desk's own sub-paths, so an accounts officer who opened
 * Pay → This month was thrown back to Pay's front page. A desk job may stand
 * anywhere inside its one room, and nowhere else in the console.
 */
describe('which console room a desk job may stand in', () => {
  it('names the one /app room of each desk job, and nothing for anyone else', () => {
    expect(consoleDeskFor('STAFF', 'ADMISSIONS')).toBe('/app/enquiries');
    expect(consoleDeskFor('STAFF', 'ACCOUNTS')).toBe('/app/pay');
    expect(consoleDeskFor('STAFF', 'LIBRARIAN')).toBeNull(); // the library lives outside /app
    expect(consoleDeskFor('STAFF', 'DRIVER')).toBeNull();
    expect(consoleDeskFor('SCHOOL_ADMIN', null)).toBeNull();
  });

  it('lets an admin stand anywhere, and says nothing before the role is known', () => {
    expect(consoleBounce('SCHOOL_ADMIN', null, '/app/students')).toBeNull();
    expect(consoleBounce(undefined, undefined, '/app/students')).toBeNull();
  });

  it('keeps the admissions officer on the enquiries desk and sends them back to it from every other room', () => {
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiries')).toBeNull();
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app')).toBe('/app/enquiries');
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/students')).toBe('/app/enquiries');
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/pay')).toBe('/app/enquiries');
    // A prefix match stops at a '/': this is not inside the desk.
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiriesx')).toBe('/app/enquiries');
  });

  it('lets the accounts officer use every tab of Pay, not only its front page', () => {
    expect(consoleBounce('STAFF', 'ACCOUNTS', '/app/pay')).toBeNull();
    expect(consoleBounce('STAFF', 'ACCOUNTS', '/app/pay/month')).toBeNull();
    expect(consoleBounce('STAFF', 'ACCOUNTS', '/app/enquiries')).toBe('/app/pay');
  });

  it('sends every other login to its own portal', () => {
    expect(consoleBounce('TEACHER', null, '/app/enquiries')).toBe('/teacher');
    expect(consoleBounce('STAFF', 'DRIVER', '/app/enquiries')).toBe('/staff');
  });

  it('does not bounce the admissions officer from a sub-path or query of the desk', () => {
    // usePathname() carries no query string, but the rule must hold either way.
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiries/abc-123')).toBeNull();
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiries/abc-123/notes')).toBeNull();
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiries?filter=NEW')).toBeNull();
  });

  it('does not count a sibling that merely starts with the desk name as the desk', () => {
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiries-something')).toBe('/app/enquiries');
    expect(consoleBounce('STAFF', 'ADMISSIONS', '/app/enquiries-something/x')).toBe('/app/enquiries');
  });

  it('gives a STAFF login with no staffRole the old bounce to /staff', () => {
    expect(consoleBounce('STAFF', null, '/app/enquiries')).toBe('/staff');
    expect(consoleBounce('STAFF', undefined, '/app/enquiries')).toBe('/staff');
    expect(consoleBounce('STAFF', undefined, '/app')).toBe('/staff');
    expect(consoleDeskFor('STAFF', null)).toBeNull();
    expect(consoleDeskFor('STAFF', undefined)).toBeNull();
  });

  it('never bounces a SCHOOL_ADMIN, whatever the staff kind or path', () => {
    for (const path of ['/app', '/app/enquiries', '/app/enquiries/x', '/app/pay', '/app/students']) {
      expect(consoleBounce('SCHOOL_ADMIN', null, path)).toBeNull();
      expect(consoleBounce('SCHOOL_ADMIN', 'ADMISSIONS', path)).toBeNull();
    }
  });
});

describe('the desk sidebar never offers a door that bounces', () => {
  it.each(['ACCOUNTS', 'ADMISSIONS'])('every %s sidebar link is a place the officer may stand', (job) => {
    const desk = consoleDeskFor('STAFF', job)!;
    expect(desk).toBeTruthy();
    const hrefs = deskModel(desk).map((e) => (e.kind === 'item' ? e.item.href : e.items.map((i) => i.href))).flat();
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(consoleBounce('STAFF', job, href)).toBeNull();
  });

  it('covers every staff job that has a desk in the console', () => {
    const jobs = ['OFFICE', 'SUPPORT', 'DRIVER', 'HELPER', 'SECURITY', 'LIBRARIAN', 'SPORTS', 'ACCOUNTS', 'ADMISSIONS', 'OTHER'];
    expect(jobs.filter((j) => consoleDeskFor('STAFF', j) !== null).sort()).toEqual(['ACCOUNTS', 'ADMISSIONS']);
  });
});

import type { Role, Session } from './session';

export function portalForRole(role: Role): '/(family)/home' | '/(staff)/today' | '/(worker)/today' {
  switch (role) {
    case 'STUDENT': return '/(family)/home';
    case 'TEACHER':
    case 'SCHOOL_ADMIN': return '/(staff)/today';
    // Non-teaching staff get their own minimal group — they used to land in
    // (staff), the TEACHER/SCHOOL_ADMIN group (a misleadingly-named folder:
    // it's the teacher+admin portal, not a "staff" one), which is exactly
    // the "wrong portal" gap this exists to close. See web's parallel fix
    // (apps/web/lib/role-routes.ts) for the same STAFF-portal split.
    case 'STAFF': return '/(worker)/today';
    case 'OWNER': throw new Error('Owner accounts use the web console.');
  }
}

// Pure bootstrap decision for app/index.tsx. A persisted session whose role
// can't be mapped to a mobile portal (currently only OWNER — a real tenant
// role that's web-only) must never propagate a throw up to the caller: that
// would leave the bootstrap screen stuck rendering null forever. Instead we
// fall back to a real route, exactly like having no session at all. Callers
// are responsible for clearing the unroutable session as a side effect.
//
// Signed out always means the gate: the school-code (connect) screen is gone —
// the login identifier resolves the school by itself (/auth/resolve-school),
// so a stored host is now only a login-order optimisation, never a route.
export function resolveStartRoute(session: Session | null): string {
  if (session) {
    try {
      return portalForRole(session.role);
    } catch {
      // fall through to the gate below
    }
  }
  return '/(auth)/login';
}

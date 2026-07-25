import type { Role, Session } from './session';

export function portalForRole(role: Role): '/(family)/home' | '/(staff)/today' {
  switch (role) {
    case 'STUDENT': return '/(family)/home';
    case 'TEACHER':
    case 'SCHOOL_ADMIN':
    case 'STAFF': return '/(staff)/today';
    case 'OWNER': throw new Error('Owner accounts use the web console.');
  }
}

// Pure bootstrap decision for app/index.tsx. A persisted session whose role
// can't be mapped to a mobile portal (currently only OWNER — a real tenant
// role that's web-only) must never propagate a throw up to the caller: that
// would leave the bootstrap screen stuck rendering null forever. Instead we
// fall back to a real route, exactly like having no session at all. Callers
// are responsible for clearing the unroutable session as a side effect.
export function resolveStartRoute(session: Session | null, storedHost: string | null): string {
  if (session) {
    try {
      return portalForRole(session.role);
    } catch {
      // fall through to the host-based fallback below
    }
  }
  return storedHost ? '/(auth)/login' : '/(auth)/connect';
}

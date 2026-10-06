/**
 * Where a school-audience login lands, keyed by `UserRole` (see
 * `packages/db/prisma/schema.prisma`). The single source of truth for
 * "which portal does this role belong in" — before this existed, the login
 * page, `/app/layout.tsx`, and `/teacher/layout.tsx` each hand-rolled their
 * own ternary/if-chain for the same decision, and `/app/layout.tsx`'s copy
 * was simply missing (see git history: it accepted ANY authenticated
 * school-audience role, including STAFF, with no redirect at all). Mirrors
 * `apps/mobile/src/lib/roles.ts`'s `portalForRole`.
 *
 * Never trust a client-chosen tab/slider for this — always resolve from the
 * role the API reports (`GET /auth/me`), exactly as the login page already
 * documents for itself.
 */
export function homeForRole(role: string | undefined, staffRole?: string | null): string {
  switch (role) {
    case 'STUDENT':
      return '/portal';
    case 'TEACHER':
      return '/teacher';
    case 'STAFF':
      // Which KIND of staff decides the door: the librarian's home is the
      // library, the sports teacher's is the sports desk; every other staff
      // kind lands on /staff. `staffRole` comes from `GET /auth/me` (never
      // from a client-chosen tab).
      if (staffRole === 'LIBRARIAN') return '/library';
      if (staffRole === 'SPORTS') return '/sports';
      // The accounts officer lands on Pay, which is their whole job here.
      if (staffRole === 'ACCOUNTS') return '/app/pay';
      // The admissions officer lands on the enquiries desk, the same way.
      if (staffRole === 'ADMISSIONS') return '/app/enquiries';
      return '/staff';
    case 'SCHOOL_ADMIN':
      return '/app';
    case 'ALUMNUS':
      // Alumni sign in at the school's ordinary login like everybody else. The
      // alumni routes accept that school JWT directly (AlumniSessionGuard), so
      // they land signed in rather than being asked for credentials twice.
      return '/alumni';
    default:
      // Unknown/missing role (e.g. OWNER, which is web-only via a different
      // audience and should never reach here) — no portal to send them to.
      return '/login';
  }
}

/**
 * The one room of the admin console a staff JOB is admitted to — `/app/pay`
 * for the accounts officer, `/app/enquiries` for the admissions officer — or
 * null for everybody else. Derived from `homeForRole`, so a desk is admitted
 * exactly where its login lands and the two can never disagree.
 */
export function consoleDeskFor(role: string | undefined, staffRole?: string | null): string | null {
  if (role !== 'STAFF') return null;
  const home = homeForRole(role, staffRole);
  return home.startsWith('/app/') ? home : null;
}

/**
 * Where the /app layout must send this person from `pathname`, or null when
 * they may stay. An admin stays anywhere; a desk job stays anywhere INSIDE its
 * room (Pay's tabs are sub-paths); everyone else goes to their own portal.
 * Chrome, not authorization — the API's guards are what refuse the data.
 */
export function consoleBounce(
  role: string | undefined,
  staffRole: string | null | undefined,
  pathname: string,
): string | null {
  if (!role || role === 'SCHOOL_ADMIN') return null;
  const desk = consoleDeskFor(role, staffRole);
  // `usePathname()` never carries a query or hash, but a caller handing in a
  // full href must not be bounced out of the desk's own filtered views.
  const path = pathname.split(/[?#]/)[0] ?? pathname;
  if (desk && (path === desk || path.startsWith(`${desk}/`))) return null;
  return homeForRole(role, staffRole);
}

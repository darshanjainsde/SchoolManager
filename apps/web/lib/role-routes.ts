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
      // library; every other staff kind lands on /staff. `staffRole` comes
      // from `GET /auth/me` (never from a client-chosen tab).
      return staffRole === 'LIBRARIAN' ? '/library' : '/staff';
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

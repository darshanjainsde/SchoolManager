import type { TabSpec } from '@/components/PortalTabBar';
import { hasFeature } from '@/lib/features';
import type { Session } from '@/lib/session';

/**
 * THE NON-TEACHING STAFF PORTAL'S NAV — office, support, driver, helper,
 * security, librarian, sports. One portal, three DESKS: which one a person
 * gets is decided by their staff job (`Session.staffRole`, from `/auth/me`)
 * and by whether the school has that module switched on. The server guards
 * every desk route as well (LibrarianGuard, SportsDeskGuard) — this file only
 * decides what is DRAWN.
 *
 * Same shape as `staff-nav.ts` and `family-nav.ts` so all three portals are
 * one product; kept free of React so route honesty is a filesystem test.
 */
export type WorkerJob = 'GENERAL' | 'SPORTS' | 'LIBRARIAN' | 'ACCOUNTS';

/** Which desk this session opens. A librarian at a school without the Library module is general staff. */
export function jobFor(s: Pick<Session, 'staffRole' | 'features'> | null | undefined): WorkerJob {
  if (!s) return 'GENERAL';
  if (s.staffRole === 'SPORTS' && hasFeature(s, 'SPORTS')) return 'SPORTS';
  if (s.staffRole === 'LIBRARIAN' && hasFeature(s, 'LIBRARY')) return 'LIBRARIAN';
  // An accounts officer is one on the strength of the JOB, not the module.
  // Half of the desk — deciding leave — needs only MANAGEMENT, which every
  // school on a real plan has; only the pay half needs the SALARY override,
  // which is switched on per school by hand. Gating the whole job on SALARY
  // sent an appointed accounts officer to the two-tab general portal with no
  // leave desk at all, while the API would have let them decide leave. The
  // pay tab is dropped on its own below when SALARY is off.
  if (s.staffRole === 'ACCOUNTS') return 'ACCOUNTS';
  // ADMISSIONS falls through to GENERAL on purpose: the Leads and Pipeline
  // tabs arrive in Tier C of the admissions design. Until then an officer has
  // Today and Profile here, and works the desk on the web (/app/enquiries).
  return 'GENERAL';
}

/**
 * Every tab directory the navigator knows. A tab is declared for ALL jobs
 * (expo-router needs the screen to exist) and hidden with `href: null` for
 * the jobs that do not use it — see `(tabs)/_layout.tsx`.
 */
export const ALL_TABS: readonly TabSpec[] = [
  { name: 'today', title: 'Today', icon: 'home' },
  // Sports desk
  { name: 'desk', title: 'Today', icon: 'home' },
  { name: 'meets', title: 'Meets', icon: 'sports' },
  { name: 'records', title: 'Records', icon: 'results' },
  { name: 'houses', title: 'Houses', icon: 'assignments' },
  // Library counter
  { name: 'counter', title: 'Counter', icon: 'library' },
  { name: 'hall', title: 'Hall', icon: 'take' },
  { name: 'books', title: 'Books', icon: 'notes' },
  { name: 'fines', title: 'Fines', icon: 'fees' },
  // Accounts desk
  { name: 'paydesk', title: 'Pay', icon: 'fees' },
  { name: 'leavedesk', title: 'Leave', icon: 'take' },
  { name: 'profile', title: 'Profile', icon: 'person' },
] as const;

const TAB_NAMES_BY_JOB: Record<WorkerJob, readonly string[]> = {
  GENERAL: ['today', 'profile'],
  // Five tabs: PortalTabBar tightens the labels past four.
  SPORTS: ['desk', 'meets', 'records', 'houses', 'profile'],
  LIBRARIAN: ['counter', 'hall', 'books', 'fines', 'profile'],
  // The standing-up half of the desk: the leave waiting on a decision, and
  // what the month costs. Leave comes FIRST: it is the job every accounts
  // officer has, while Pay needs a right an admin grants — opening on Pay
  // landed a new officer on "You do not have the right to see pay yet"
  // (re-audit 2026-10-08). Running a pay run is a sitting-down job and stays
  // on the web, the same way the library's Settings does.
  ACCOUNTS: ['leavedesk', 'paydesk', 'profile'],
};

type NavSession = Pick<Session, 'staffRole' | 'features'> | null | undefined;

/**
 * The tab NAMES a session actually gets: its job's list, minus any tab whose
 * module the school has not switched on. Today that is only `paydesk` — an
 * accounts officer keeps the leave desk at a school that does not run pay
 * here. Takes the session, not the job, because the job alone cannot know.
 */
export function tabNamesFor(s: NavSession): readonly string[] {
  const job = jobFor(s);
  const names = TAB_NAMES_BY_JOB[job];
  if (job === 'ACCOUNTS' && !hasFeature(s, 'SALARY')) return names.filter((n) => n !== 'paydesk');
  return names;
}

export function tabsFor(s: NavSession): readonly TabSpec[] {
  return tabNamesFor(s).map((n) => ALL_TABS.find((t) => t.name === n)!);
}

/** The general tabs — what an unknown or not-yet-loaded session draws. */
export const VISIBLE_TABS: readonly TabSpec[] = tabsFor(null);

/** The tab a session lands on when the portal opens: the first it is allowed. */
export function homeTabFor(s: NavSession): string {
  return tabNamesFor(s)[0];
}

/**
 * Screens pushed INSIDE a tab's own stack — they keep a back stack and the
 * positional back chip, and must never appear in the bar.
 */
export const HIDDEN_ROUTES: readonly string[] = [
  '(tabs)/today/notifications',
  '(tabs)/profile/appearance',
  '(tabs)/profile/password',
  '(tabs)/profile/phone',
  '(tabs)/profile/switch',
  '(tabs)/profile/salary',
  '(tabs)/desk/rules',
  '(tabs)/meets/[id]',
  '(tabs)/counter/member/[kind]/[id]',
] as const;

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
export type WorkerJob = 'GENERAL' | 'SPORTS' | 'LIBRARIAN';

/** Which desk this session opens. A librarian at a school without the Library module is general staff. */
export function jobFor(s: Pick<Session, 'staffRole' | 'features'> | null | undefined): WorkerJob {
  if (!s) return 'GENERAL';
  if (s.staffRole === 'SPORTS' && hasFeature(s, 'SPORTS')) return 'SPORTS';
  if (s.staffRole === 'LIBRARIAN' && hasFeature(s, 'LIBRARY')) return 'LIBRARIAN';
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
  { name: 'profile', title: 'Profile', icon: 'person' },
] as const;

const TAB_NAMES_BY_JOB: Record<WorkerJob, readonly string[]> = {
  GENERAL: ['today', 'profile'],
  // Five tabs: PortalTabBar tightens the labels past four.
  SPORTS: ['desk', 'meets', 'records', 'houses', 'profile'],
  LIBRARIAN: ['counter', 'hall', 'books', 'fines', 'profile'],
};

export function tabsFor(job: WorkerJob): readonly TabSpec[] {
  const names = TAB_NAMES_BY_JOB[job];
  return names.map((n) => ALL_TABS.find((t) => t.name === n)!);
}

/** The general tabs — what an unknown or not-yet-loaded session draws. */
export const VISIBLE_TABS: readonly TabSpec[] = tabsFor('GENERAL');

/** The tab a job lands on when the portal opens. */
export function homeTabFor(job: WorkerJob): string {
  return TAB_NAMES_BY_JOB[job][0];
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
  '(tabs)/desk/rules',
  '(tabs)/meets/[id]',
  '(tabs)/counter/member/[kind]/[id]',
] as const;

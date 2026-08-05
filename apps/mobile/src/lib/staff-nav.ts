/**
 * T3 menu-parity decision (2026-07-30): one agreed section list across web
 * and app. "Today" and "Announcements" are named to match the web nav
 * (apps/web/app/teacher/layout.tsx's NAV_ITEMS) — same features, same
 * labels.
 *
 * Menu-drawer revision (2026-08-01): the tab bar now shows FOUR core tabs
 * (Today, Attendance, Timetable, Announcements) with a central chevron FAB
 * between them that lifts a bottom-sheet tools drawer (see
 * `src/components/ToolsDrawer.tsx`) over whatever screen you're on. There is
 * no "More" tab any more — everything the web nav additionally lists (Tests,
 * Results, Requests, Holidays) plus Assignments, Messages, Notes and the
 * web's sidebar-foot profile link lives in that drawer instead. `MORE_ITEMS`
 * stays the single source of truth for those tools.
 *
 * Kept dependency-free (no React/expo-router imports) so route-honesty can
 * be checked by a plain filesystem test without mounting the screens —
 * mirroring apps/web/app/teacher/layout.test.tsx's "every NAV_ITEMS href
 * resolves" check.
 */

/**
 * FOUR TABS, AND EVERY LABEL FITS ON ONE LINE.
 *
 * "Announcements" is thirteen characters in a quarter-width tab; on any phone
 * narrower than a Pixel it wrapped to two lines, which pushed that one tab's
 * label off the shared baseline and made the whole bar look broken. The family
 * bar hit the identical problem with "Notices/Announcements" and fixed it on
 * 2026-08-02 by promoting Profile into the bar; staff was left behind.
 *
 * Profile is the right promotion rather than an arbitrary short word: it is
 * where a teacher signs out, and sign-out is the one action that must never be
 * more than a tap away from somewhere obvious. Announcements moves into the
 * tools drawer with the rest of the compose-style tools, which is where it
 * belongs — it is something a teacher does occasionally, not a place they live.
 */
export const VISIBLE_TABS = [
  { name: 'today', title: 'Today', icon: 'today-outline' as const },
  { name: 'attendance', title: 'Attendance', icon: 'checkbox-outline' as const },
  { name: 'timetable', title: 'Timetable', icon: 'calendar-outline' as const },
  { name: 'profile', title: 'Profile', icon: 'person-outline' as const },
];

/** Detail/utility routes — reachable via navigation (More rows, row taps), hidden from the tab bar. */
export const HIDDEN_ROUTES = [
  'holidays',
  'diary',
  'requests',
  'post',
  'take/[classSectionId]',
  'tests',
  'results/[examId]',
  'assignments',
  'messages',
  'messages/[threadId]',
  'notes',
  'notes/[classSectionId]',
  'notifications',
];

/**
 * More-screen rows. Tests and Results share ONE row ("Tests & Results"): the
 * tests screen lists scheduled tests, and tapping a test opens its results
 * entry (results/[examId] via (staff)/tests.tsx's `openResults`). Results has
 * no screen of its own — so two separate rows pointing at the same screen read
 * as a bug; one row that names both is the honest label. (Web keeps them as
 * two pages — /teacher/tests to schedule, /teacher/results to enter marks —
 * because it has the width for a top-level nav; mobile folds them here.)
 *
 * Assignments (Phase 4 Task 4) matches the web nav's label — see
 * apps/web/app/teacher/layout.tsx's NAV_ITEMS.
 */
/** Icon-tile colour family for a drawer tool — mirrors the pitch's tinted tiles. */
export type MoreTone = 'indigo' | 'amber' | 'green';

export interface MoreItem {
  label: string;
  icon: string;
  route:
    | '/(staff)/assignments'
    | '/(staff)/messages'
    | '/(staff)/notes'
    | '/(staff)/diary'
    | '/(staff)/tests'
    | '/(staff)/requests'
    | '/(staff)/holidays'
    | '/(staff)/post';
  /** Icon-tile tint. Defaults to indigo when omitted. */
  tone?: MoreTone;
}

export const MORE_ITEMS: readonly MoreItem[] = [
  { label: 'Diary', icon: '📔', route: '/(staff)/diary', tone: 'indigo' },
  { label: 'Assignments', icon: '📚', route: '/(staff)/assignments', tone: 'indigo' },
  { label: 'Messages', icon: '💬', route: '/(staff)/messages', tone: 'amber' },
  { label: 'Notes', icon: '📒', route: '/(staff)/notes', tone: 'indigo' },
  { label: 'Tests & Results', icon: '📊', route: '/(staff)/tests', tone: 'indigo' },
  { label: 'Requests', icon: '📝', route: '/(staff)/requests', tone: 'amber' },
  { label: 'Holidays', icon: '📅', route: '/(staff)/holidays', tone: 'green' },
  { label: 'Announcements', icon: '📣', route: '/(staff)/post', tone: 'amber' },
];

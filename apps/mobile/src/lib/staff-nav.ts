/**
 * T3 menu-parity decision (2026-07-30): one agreed section list across web
 * and app. "Today" and "Announcements" are named to match the web nav
 * (apps/web/app/teacher/layout.tsx's NAV_ITEMS) — same features, same
 * labels.
 *
 * Menu-drawer revision (2026-08-01): the tab bar now shows FOUR core tabs
 * (Today, Attendance, Timetable, Announcements) with a central chevron FAB
 * between them that lifts a bottom-sheet tools drawer (see
 * `components/HomeToolGrid.tsx`) as the 'Go to' block on Home. There is
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
  // 'home' is a DIRECTORY tab (its own Stack) since pitch №5 — the
  // route file moved from (tabs)/today.tsx to (tabs)/home/index.tsx.
  { name: 'home', title: 'Home', icon: 'today-outline' as const },
  { name: 'attendance', title: 'Attendance', icon: 'checkbox-outline' as const },
  { name: 'timetable', title: 'Timetable', icon: 'calendar-outline' as const },
  { name: 'profile', title: 'Profile', icon: 'person-outline' as const },
];

/** Detail/utility routes — reachable via navigation (More rows, row taps), hidden from the tab bar. */
export const HIDDEN_ROUTES = [
  // Pitch №5 (the frozen bar): every browsing tool lives INSIDE the Home
  // tab's own Stack, so the bottom bar stays while the screen keeps a real
  // back-stack. The one full-screen exception is the register (take/…): a
  // stray thumb on an always-there bar mid-register would discard a class's
  // unsaved marks, so it pushes over everything from the portal root.
  '(tabs)/home/holidays',
  '(tabs)/home/diary',
  '(tabs)/home/requests',
  '(tabs)/home/post',
  'take/[classSectionId]',
  // Reached by tapping the "right now" hero on Home — the LOOKING half of the
  // pair whose MARKING half is take/[classSectionId] above.
  '(tabs)/home/class/[classSectionId]',
  '(tabs)/home/tests',
  '(tabs)/home/results/[examId]',
  '(tabs)/home/assignments',
  '(tabs)/home/messages',
  '(tabs)/home/messages/[threadId]',
  '(tabs)/home/notes',
  '(tabs)/home/notes/[classSectionId]',
  '(tabs)/home/notifications',
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
  /**
   * A duotone glyph name from components/icons.tsx — not an emoji, and no
   * longer an Ionicons name. Emoji were drawn by the OS (different on iOS and
   * Android, pre-coloured, unable to take a school's colour); a single hairline
   * Ionicon then read as faint. See the icon set for why two layers.
   */
  icon: string;
  route:
    | '/(staff)/(tabs)/home/assignments'
    | '/(staff)/(tabs)/home/messages'
    | '/(staff)/(tabs)/home/notes'
    | '/(staff)/(tabs)/home/diary'
    | '/(staff)/(tabs)/home/tests'
    | '/(staff)/(tabs)/home/requests'
    | '/(staff)/(tabs)/home/holidays'
    | '/(staff)/(tabs)/home/post';
  /** Icon-tile tint. Defaults to indigo when omitted. */
  tone?: MoreTone;
}

export const MORE_ITEMS: readonly MoreItem[] = [
  { label: 'Diary', icon: 'diary', route: '/(staff)/(tabs)/home/diary', tone: 'indigo' },
  { label: 'Assignments', icon: 'assignments', route: '/(staff)/(tabs)/home/assignments', tone: 'indigo' },
  { label: 'Messages', icon: 'messages', route: '/(staff)/(tabs)/home/messages', tone: 'amber' },
  { label: 'Notes', icon: 'notes', route: '/(staff)/(tabs)/home/notes', tone: 'indigo' },
  { label: 'Tests & Results', icon: 'results', route: '/(staff)/(tabs)/home/tests', tone: 'indigo' },
  { label: 'Requests', icon: 'requests', route: '/(staff)/(tabs)/home/requests', tone: 'amber' },
  { label: 'Holidays', icon: 'timetable', route: '/(staff)/(tabs)/home/holidays', tone: 'green' },
  { label: 'Announcements', icon: 'notices', route: '/(staff)/(tabs)/home/post', tone: 'amber' },
];

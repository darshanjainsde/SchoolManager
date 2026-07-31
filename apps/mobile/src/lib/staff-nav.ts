/**
 * T3 menu-parity decision (2026-07-30): one agreed section list across web
 * and app. "Today" and "Announcements" are named to match the web nav
 * (apps/web/app/teacher/layout.tsx's NAV_ITEMS) — same features, same
 * labels. The tab bar itself stays at 5 entries; everything the web nav
 * additionally lists (Tests, Results, Requests, Holidays) plus the web's
 * sidebar-foot profile link is reachable from More instead.
 *
 * Kept dependency-free (no React/expo-router imports) so route-honesty can
 * be checked by a plain filesystem test without mounting the screens —
 * mirroring apps/web/app/teacher/layout.test.tsx's "every NAV_ITEMS href
 * resolves" check.
 */

export const VISIBLE_TABS = [
  { name: 'today', title: 'Today', icon: 'today-outline' as const },
  { name: 'attendance', title: 'Attendance', icon: 'checkbox-outline' as const },
  { name: 'timetable', title: 'Timetable', icon: 'calendar-outline' as const },
  { name: 'post', title: 'Announcements', icon: 'megaphone-outline' as const },
  { name: 'more', title: 'More', icon: 'ellipsis-horizontal' as const },
];

/** Detail/utility routes — reachable via navigation (More rows, row taps), hidden from the tab bar. */
export const HIDDEN_ROUTES = [
  'holidays',
  'requests',
  'take/[classSectionId]',
  'tests',
  'results/[examId]',
  'assignments',
  'profile',
];

/**
 * More-screen rows. Results has no screen of its own: like the web (whose
 * /teacher/results page is itself a class/exam picker), the entry point IS
 * the tests screen's scheduled-tests list — tapping a test opens its
 * results (see (staff)/tests.tsx's `openResults`).
 *
 * Assignments (Phase 4 Task 4) matches the web nav's label — see
 * apps/web/app/teacher/layout.tsx's NAV_ITEMS.
 */
export const MORE_ITEMS = [
  { label: 'Assignments', icon: '📚', route: '/(staff)/assignments' as const },
  { label: 'Tests', icon: '📊', route: '/(staff)/tests' as const },
  { label: 'Results', icon: '🏆', route: '/(staff)/tests' as const },
  { label: 'Requests', icon: '📝', route: '/(staff)/requests' as const },
  { label: 'Holidays', icon: '📅', route: '/(staff)/holidays' as const },
  { label: 'Profile', icon: '👤', route: '/(staff)/profile' as const },
];

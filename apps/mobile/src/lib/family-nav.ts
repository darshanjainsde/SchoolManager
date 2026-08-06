/**
 * Family-portal navigation source of truth — the (family) twin of
 * `staff-nav.ts` (see that file's T3 menu-parity / menu-drawer notes).
 *
 * Menu-drawer revision (2026-08-02): the family tab bar drops the stock
 * expo-router Tabs for the same pattern the staff portal ships — FOUR core
 * tabs (Home, Attendance, Results, Profile) with a central chevron FAB that
 * are rendered as the 'Go to' grid on Home (`components/HomeToolGrid.tsx`)
 * over whatever screen you're on. Profile replaces Notices in the bar (the
 * old fifth "More" tab is gone, and the two-line "Notices/Announcements"
 * label bug goes with it); Notices lives in the drawer with the rest of the
 * tools. `MORE_ITEMS` stays the single source of truth for those tools.
 *
 * Kept dependency-free (no React/expo-router imports) so route-honesty can
 * be checked by a plain filesystem test without mounting the screens —
 * mirroring `(staff)/__tests__/route-honesty.test.ts`.
 */

export const VISIBLE_TABS = [
  { name: 'home', title: 'Home', icon: 'home-outline' as const },
  { name: 'attendance', title: 'Attendance', icon: 'checkbox-outline' as const },
  { name: 'results', title: 'Results', icon: 'stats-chart-outline' as const },
  { name: 'profile', title: 'Profile', icon: 'person-outline' as const },
];

/** Detail/utility routes — reachable via navigation (drawer tiles, row taps), hidden from the tab bar. */
export const HIDDEN_ROUTES = [
  'timetable',
  'diary',
  'assignments',
  'messages',
  'messages/[threadId]',
  'notices',
  'holidays',
  'notifications',
  'shelf',
];

/** Icon-tile colour family for a drawer tool — mirrors staff-nav's `MoreTone`. */
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
    | '/(family)/diary'
    | '/(family)/timetable'
    | '/(family)/assignments'
    | '/(family)/messages'
    | '/(family)/notices'
    | '/(family)/holidays';
  /** Icon-tile tint. Defaults to indigo when omitted. */
  tone?: MoreTone;
}

export const MORE_ITEMS: readonly MoreItem[] = [
  { label: 'Diary', icon: 'diary', route: '/(family)/diary', tone: 'indigo' },
  { label: 'Timetable', icon: 'timetable', route: '/(family)/timetable', tone: 'indigo' },
  { label: 'Assignments', icon: 'assignments', route: '/(family)/assignments', tone: 'indigo' },
  { label: 'Messages', icon: 'messages', route: '/(family)/messages', tone: 'amber' },
  { label: 'Notices', icon: 'notices', route: '/(family)/notices', tone: 'amber' },
  { label: 'Holidays', icon: 'holidays', route: '/(family)/holidays', tone: 'green' },
];

/**
 * Family-portal navigation source of truth — the (family) twin of
 * `staff-nav.ts` (see that file's T3 menu-parity / menu-drawer notes).
 *
 * Menu-drawer revision (2026-08-02): the family tab bar drops the stock
 * expo-router Tabs for the same pattern the staff portal ships — FOUR core
 * tabs (Home, Attendance, Results, Profile) with a central chevron FAB that
 * lifts a bottom-sheet tools drawer (`src/components/FamilyToolsDrawer.tsx`)
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
  'settings',
];

/** Icon-tile colour family for a drawer tool — mirrors staff-nav's `MoreTone`. */
export type MoreTone = 'indigo' | 'amber' | 'green';

export interface MoreItem {
  label: string;
  /**
   * An Ionicons OUTLINE glyph, not an emoji. Emoji are drawn by the operating
   * system, so the same drawer rendered differently on iOS and Android, they
   * arrive pre-coloured and can never take the school's brand colour, and
   * their cartoon weight fought the serif everywhere else on the screen.
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
  { label: 'Diary', icon: 'book-outline', route: '/(family)/diary', tone: 'indigo' },
  { label: 'Timetable', icon: 'calendar-outline', route: '/(family)/timetable', tone: 'indigo' },
  { label: 'Assignments', icon: 'layers-outline', route: '/(family)/assignments', tone: 'indigo' },
  { label: 'Messages', icon: 'chatbubble-outline', route: '/(family)/messages', tone: 'amber' },
  { label: 'Notices', icon: 'megaphone-outline', route: '/(family)/notices', tone: 'amber' },
  { label: 'Holidays', icon: 'sunny-outline', route: '/(family)/holidays', tone: 'green' },
];

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
  { name: 'home', title: 'Home', icon: 'home' as const },
  { name: 'attendance', title: 'Attendance', icon: 'take' as const },
  { name: 'results', title: 'Results', icon: 'results' as const },
  { name: 'profile', title: 'Profile', icon: 'person' as const },
];

/**
 * THE FIFTH TAB (second edition). Fees is money and, after attendance, the
 * thing a family opens most — it belongs in the bar. But it is a paid
 * module, so the bar reads the school's feature list and draws it only when
 * FEES is on. It sits in the middle: the two most-opened tabs either side.
 */
export const FEES_TAB = { name: 'fees', title: 'Fees', icon: 'fees' as const };

/** Every tab file the navigator registers, whether or not the bar draws it. */
export const ALL_TABS = [VISIBLE_TABS[0], VISIBLE_TABS[1], FEES_TAB, VISIBLE_TABS[2], VISIBLE_TABS[3]];

/** The tabs the bar draws for THIS school — five with fees, four without. */
export function visibleTabs(features: readonly string[] | undefined): typeof ALL_TABS {
  return features?.includes('FEES') ? ALL_TABS : VISIBLE_TABS;
}

/** Detail/utility routes — reachable via navigation (drawer tiles, row taps), hidden from the tab bar. */
export const HIDDEN_ROUTES = [
  '(tabs)/home/timetable',
  '(tabs)/home/diary',
  '(tabs)/home/assignments',
  '(tabs)/home/messages',
  '(tabs)/home/messages/[threadId]',
  '(tabs)/home/notices',
  '(tabs)/home/holidays',
  '(tabs)/home/notifications',
  '(tabs)/home/shelf',
  // Second edition — the four screens the web portal had and the app did not.
  '(tabs)/home/sports',
  '(tabs)/home/library',
  '(tabs)/home/birthdays',
  '(tabs)/home/report-cards',
  '(tabs)/home/report-cards/[id]',
  '(tabs)/home/receipt/[paymentId]',
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
    | '/(family)/(tabs)/home/diary'
    | '/(family)/(tabs)/home/timetable'
    | '/(family)/(tabs)/home/assignments'
    | '/(family)/(tabs)/home/messages'
    | '/(family)/(tabs)/home/notices'
    | '/(family)/(tabs)/home/holidays'
    | '/(family)/(tabs)/home/sports'
    | '/(family)/(tabs)/home/library'
    | '/(family)/(tabs)/home/birthdays'
    | '/(family)/(tabs)/home/report-cards';
  /** Icon-tile tint. Defaults to indigo when omitted. */
  tone?: MoreTone;
  /**
   * The paid module this tool belongs to. Home draws the tile only when the
   * school has it on (lib/features.ts); a tool with no key is always drawn.
   */
  feature?: 'FEES' | 'LIBRARY' | 'SPORTS' | 'PRESS';
}

export const MORE_ITEMS: readonly MoreItem[] = [
  { label: 'Diary', icon: 'diary', route: '/(family)/(tabs)/home/diary', tone: 'indigo' },
  { label: 'Timetable', icon: 'timetable', route: '/(family)/(tabs)/home/timetable', tone: 'indigo' },
  { label: 'Assignments', icon: 'assignments', route: '/(family)/(tabs)/home/assignments', tone: 'indigo' },
  { label: 'Messages', icon: 'messages', route: '/(family)/(tabs)/home/messages', tone: 'amber' },
  { label: 'Notices', icon: 'notices', route: '/(family)/(tabs)/home/notices', tone: 'amber' },
  { label: 'Holidays', icon: 'holidays', route: '/(family)/(tabs)/home/holidays', tone: 'green' },
  { label: 'Sports', icon: 'sports', route: '/(family)/(tabs)/home/sports', tone: 'indigo', feature: 'SPORTS' },
  { label: 'Library', icon: 'library', route: '/(family)/(tabs)/home/library', tone: 'indigo', feature: 'LIBRARY' },
  { label: 'Report cards', icon: 'report', route: '/(family)/(tabs)/home/report-cards', tone: 'indigo', feature: 'PRESS' },
  { label: 'Birthdays', icon: 'cake', route: '/(family)/(tabs)/home/birthdays', tone: 'amber' },
];

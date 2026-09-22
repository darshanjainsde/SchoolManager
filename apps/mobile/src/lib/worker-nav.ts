import type { TabSpec } from '@/components/PortalTabBar';

/**
 * THE NON-TEACHING STAFF PORTAL'S NAV — office, support, driver, helper,
 * security, librarian, sports. It carried exactly one tab and, with it, no
 * way to sign out at all: on a school's shared handset the next person
 * opened the app as the last one (UI audit 2026-09-22, #5). Same shape as
 * `staff-nav.ts` and `family-nav.ts` so all three portals are one product.
 */
export const VISIBLE_TABS: readonly TabSpec[] = [
  { name: 'today', title: 'Today', icon: 'home' },
  { name: 'profile', title: 'Profile', icon: 'person' },
] as const;

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
] as const;

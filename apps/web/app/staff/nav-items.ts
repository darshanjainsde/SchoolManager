import { LayoutDashboard, User } from 'lucide-react';

/**
 * Staff-portal nav. Lives in its own module rather than being exported from
 * `layout.tsx`, because Next.js App Router rejects any named export from a
 * layout/page/route file that is not one of its own reserved fields
 * (`default`, `metadata`, …) — `next build` fails with "NAV_ITEMS is not a
 * valid Layout export field". `next lint` and `tsc --noEmit` do NOT catch
 * this; only `next build` does.
 *
 * Two entries: the caller's own attendance, and their profile — the same
 * doors the app's worker portal has (Profile: WhatsApp number, password,
 * switch profile), so web and app are one product for a driver or a guard
 * too. A future Leave tab slots in without a layout rewrite.
 */
export const NAV_ITEMS = [
  { href: '/staff', label: 'Home', icon: LayoutDashboard },
  { href: '/staff/profile', label: 'My profile', icon: User },
];

import { CalendarDays, LayoutDashboard, Receipt, User } from 'lucide-react';

/**
 * Staff-portal nav. Lives in its own module rather than being exported from
 * `layout.tsx`, because Next.js App Router rejects any named export from a
 * layout/page/route file that is not one of its own reserved fields
 * (`default`, `metadata`, …) — `next build` fails with "NAV_ITEMS is not a
 * valid Layout export field". `next lint` and `tsc --noEmit` do NOT catch
 * this; only `next build` does.
 *
 * The caller's own attendance, their leave, their pay and their profile —
 * the same doors the app's worker portal has (Profile: WhatsApp number,
 * password, switch profile), so web and app are one product for a driver or
 * a guard too.
 */
export const NAV_ITEMS = [
  { href: '/staff', label: 'Home', icon: LayoutDashboard },
  // Only drawn when the school has the module: `requiredFeature` is how every
  // other nav in the product hides a room the school does not have.
  { href: '/staff/pay', label: 'My pay', icon: Receipt, requiredFeature: 'SALARY' },
  // Leave needs no feature flag: every school that employs somebody has it,
  // and the applications table has always been part of MANAGEMENT.
  { href: '/staff/leave', label: 'My leave', icon: CalendarDays },
  { href: '/staff/profile', label: 'My profile', icon: User },
];

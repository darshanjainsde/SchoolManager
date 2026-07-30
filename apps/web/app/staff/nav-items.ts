import { LayoutDashboard } from 'lucide-react';

/**
 * Staff-portal nav. Lives in its own module rather than being exported from
 * `layout.tsx`, because Next.js App Router rejects any named export from a
 * layout/page/route file that is not one of its own reserved fields
 * (`default`, `metadata`, …) — `next build` fails with "NAV_ITEMS is not a
 * valid Layout export field". `next lint` and `tsc --noEmit` do NOT catch
 * this; only `next build` does.
 *
 * Deliberately one entry: this portal is a first cut ("currently minimal" —
 * Phase 4 Task 3) covering only the caller's own attendance. The single-item
 * strip keeps the same topbar+tabs shell as /portal and /teacher so a future
 * Leave tab slots in without a layout rewrite.
 */
export const NAV_ITEMS = [{ href: '/staff', label: 'Home', icon: LayoutDashboard }];

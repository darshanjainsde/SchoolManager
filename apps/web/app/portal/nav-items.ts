import {
  LayoutDashboard,
  CalendarDays,
  CalendarCheck,
  BookOpen,
  GraduationCap,
  Megaphone,
  MessageSquare,
  User,
  NotebookPen,
  Library,
} from 'lucide-react';

/**
 * Student-portal nav. Lives in its own module rather than being exported from
 * `layout.tsx`, because Next.js App Router rejects named exports from a
 * layout/page/route file that are not reserved fields — `next build` fails with
 * "NAV_ITEMS is not a valid Layout export field", and tsc, lint and vitest all
 * pass while it is broken. `/teacher/nav-items.ts` exists for exactly this
 * reason; the student portal simply had not needed it until now.
 *
 * `requiredFeature` + `requiresLibraryLive` are a TWO-STAGE gate, and the
 * second stage matters more than the first.
 *
 * Stage 1 — the school bought a library (`features` from /auth/me).
 * Stage 2 — there is actually a book in it (`libraryLive`).
 *
 * The gap between an admin ticking Library and a librarian finishing the first
 * shelf is weeks of real work. A tab opening onto an empty screen during those
 * weeks is the impression eight hundred students form of the feature, and they
 * form it once.
 *
 * Hidden, never disabled — matching how /app/layout.tsx already treats a
 * feature a school does not have.
 */
export const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  requiredFeature?: string;
  requiresLibraryLive?: boolean;
}[] = [
  { href: '/portal', label: 'Home', icon: LayoutDashboard },
  { href: '/portal/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/portal/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/portal/diary', label: 'Diary', icon: NotebookPen },
  { href: '/portal/assignments', label: 'Assignments', icon: BookOpen },
  { href: '/portal/results', label: 'Results', icon: GraduationCap },
  { href: '/portal/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/portal/messages', label: 'Messages', icon: MessageSquare },
  { href: '/portal/library', label: 'Library', icon: Library, requiredFeature: 'LIBRARY', requiresLibraryLive: true },
  { href: '/portal/profile', label: 'Profile', icon: User },
];

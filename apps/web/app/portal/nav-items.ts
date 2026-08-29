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
  Wallet,
} from 'lucide-react';

/**
 * Student-portal nav. Lives in its own module rather than being exported from
 * `layout.tsx`, because Next.js App Router rejects named exports from a
 * layout/page/route file that are not reserved fields — `next build` fails with
 * "NAV_ITEMS is not a valid Layout export field", and tsc, lint and vitest all
 * pass while it is broken. `/teacher/nav-items.ts` exists for exactly this
 * reason; the student portal simply had not needed it until now.
 *
 * `requiredFeature` hides an entry when /auth/me says the school's plan
 * lacks the feature.
 *
 * Hidden, never disabled — matching how /app/layout.tsx already treats a
 * feature a school does not have.
 */
export const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Hidden when `/auth/me` reports the school's plan lacks this feature. */
  requiredFeature?: string;
}[] = [
  { href: '/portal', label: 'Home', icon: LayoutDashboard },
  { href: '/portal/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/portal/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/portal/diary', label: 'Diary', icon: NotebookPen },
  { href: '/portal/assignments', label: 'Assignments', icon: BookOpen },
  { href: '/portal/results', label: 'Results', icon: GraduationCap },
  { href: '/portal/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/portal/messages', label: 'Messages', icon: MessageSquare },
  { href: '/portal/library', label: 'Library', icon: Library, requiredFeature: 'LIBRARY' },
  { href: '/portal/fees', label: 'Fees', icon: Wallet, requiredFeature: 'FEES' },
  { href: '/portal/profile', label: 'Profile', icon: User },
];

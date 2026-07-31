import {
  LayoutDashboard,
  ClipboardCheck,
  BookOpen,
  FileText,
  GraduationCap,
  Megaphone,
  CalendarDays,
  CalendarOff,
  CalendarRange,
} from 'lucide-react';

/**
 * Teacher-portal nav. Lives in its own module rather than being exported from
 * `layout.tsx`, because Next.js App Router rejects named exports from a
 * layout/page/route file that are not reserved fields — `next build` fails with
 * "NAV_ITEMS is not a valid Layout export field" (see the route-file-exports
 * guard test, and the /staff sibling that broke the Vercel build). tsc, lint,
 * and vitest do NOT catch this; only `next build` does.
 *
 * Every entry here must be a working tool, not a placeholder — a nav entry
 * implies the destination does something. `/teacher/assignments` is real
 * (Phase 4 Task 4 — create/list/delete against `/manage/assignments`);
 * `/teacher/inbox` was deleted (Part C) because it always rendered "Nothing
 * yet." against an endpoint that doesn't exist. See teacher-nav-honesty.spec
 * for the dead-route regression test.
 */
export const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutDashboard }[] = [
  { href: '/teacher', label: 'Today', icon: LayoutDashboard },
  { href: '/teacher/timetable', label: 'Timetable', icon: CalendarDays },
  { href: '/teacher/attendance', label: 'Attendance', icon: ClipboardCheck },
  { href: '/teacher/assignments', label: 'Assignments', icon: BookOpen },
  { href: '/teacher/tests', label: 'Tests', icon: FileText },
  { href: '/teacher/results', label: 'Results', icon: GraduationCap },
  { href: '/teacher/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/teacher/requests', label: 'Requests', icon: CalendarOff },
  { href: '/teacher/holidays', label: 'Holidays', icon: CalendarRange },
];

import {
  Armchair, BookOpen, Briefcase, CalendarDays, CalendarHeart, CalendarX,
  ClipboardCheck, ClipboardList, Clock, Globe, GraduationCap, Handshake, Inbox,
  LayoutDashboard, Megaphone, Newspaper, NotebookPen, Printer, School, Settings,
  UserCog, Users, Wallet,
} from 'lucide-react';

/**
 * The admin sidebar's shape — approved 2 Sept 2026 after the flat list hit 22
 * rows. The rule for every name: the GROUP is the job, in a word a principal
 * can explain in one breath. Six groups, five anchors:
 *
 *   Website     "what the public sees"
 *   Admissions  "how children join"          (applications & marketing land here)
 *   People      "who is in the school"
 *   Attendance  "who came, who's away"       (Requests ARE register corrections)
 *   Timetable   "who teaches what, when"
 *   Exams       "conduct them, print results"
 *
 * Anchors stay flat rows: Dashboard is the daily front door; Fees and Library
 * are hubs of their own (a one-child group is just a longer click);
 * Announcements is too frequent to bury; Settings is pinned last.
 *
 * Kept as data in its own module with no component imports, so the guard test
 * (`nav-model.test.ts`) can import it without dragging the layout's graph in —
 * the nav-model/subpages extraction lesson.
 */

export interface NavLeaf {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Hidden for schools whose tier lacks the feature. Absent = always shown. */
  requiredFeature?: string;
  /** Marks the one tab that leaves /app — the Library's own portal. */
  leavesConsole?: boolean;
}

export type NavEntry =
  | { kind: 'item'; item: NavLeaf }
  | { kind: 'group'; key: string; label: string; icon: typeof LayoutDashboard; items: NavLeaf[] };

export const NAV_MODEL: NavEntry[] = [
  { kind: 'item', item: { href: '/app', label: 'Dashboard', icon: LayoutDashboard } },

  {
    kind: 'group', key: 'website', label: 'Website', icon: Globe,
    items: [
      { href: '/app/website', label: 'Website', icon: Globe },
      { href: '/app/blog', label: 'Blog', icon: Newspaper, requiredFeature: 'BLOG' },
      { href: '/app/events', label: 'Events', icon: CalendarHeart, requiredFeature: 'EVENTS' },
    ],
  },
  {
    kind: 'group', key: 'admissions', label: 'Admissions', icon: Inbox,
    items: [
      { href: '/app/enquiries', label: 'Enquiries', icon: Inbox, requiredFeature: 'ENQUIRY' },
    ],
  },
  {
    kind: 'group', key: 'people', label: 'People', icon: Users,
    items: [
      { href: '/app/students', label: 'Students', icon: Users, requiredFeature: 'MANAGEMENT' },
      { href: '/app/teachers', label: 'Teachers', icon: GraduationCap, requiredFeature: 'MANAGEMENT' },
      { href: '/app/staff', label: 'Staff', icon: UserCog, requiredFeature: 'MANAGEMENT' },
      { href: '/app/classes', label: 'Classes', icon: School, requiredFeature: 'MANAGEMENT' },
      { href: '/app/jobs', label: 'Jobs', icon: Briefcase, requiredFeature: 'HIRING' },
    ],
  },
  {
    kind: 'group', key: 'attendance', label: 'Attendance', icon: ClipboardList,
    items: [
      { href: '/app/staff-attendance', label: 'Staff attendance', icon: ClipboardList, requiredFeature: 'MANAGEMENT' },
      { href: '/app/leave', label: 'Leave', icon: CalendarX, requiredFeature: 'MANAGEMENT' },
      { href: '/app/requests', label: 'Requests', icon: ClipboardCheck, requiredFeature: 'MANAGEMENT' },
    ],
  },
  {
    kind: 'group', key: 'timetable', label: 'Timetable', icon: CalendarDays,
    items: [
      { href: '/app/timetable', label: 'Timetable', icon: CalendarDays, requiredFeature: 'MANAGEMENT' },
      { href: '/app/availability', label: 'Availability', icon: Clock, requiredFeature: 'MANAGEMENT' },
    ],
  },
  {
    kind: 'group', key: 'exams', label: 'Exams', icon: NotebookPen,
    items: [
      { href: '/app/exam-hall', label: 'Exam Hall', icon: Armchair, requiredFeature: 'MANAGEMENT' },
      { href: '/app/press', label: 'The Press', icon: Printer, requiredFeature: 'PRESS' },
    ],
  },

  { kind: 'item', item: { href: '/app/fees', label: 'Fees', icon: Wallet, requiredFeature: 'FEES' } },
  // Points OUT of /app on purpose — the counter is its own portal
  // (lib/role-routes.ts). An admin reaches it to set up and to stand in.
  { kind: 'item', item: { href: '/library', label: 'Library', icon: BookOpen, requiredFeature: 'LIBRARY', leavesConsole: true } },
  { kind: 'item', item: { href: '/app/announcements', label: 'Announcements', icon: Megaphone } },
  { kind: 'item', item: { href: '/app/alumni', label: 'Alumni', icon: Handshake, requiredFeature: 'ALUMNI' } },
  { kind: 'item', item: { href: '/app/settings', label: 'Settings', icon: Settings, requiredFeature: 'MANAGEMENT' } },
];

/** Every leaf, flat — the collapsed icon rail and the guards read this. */
export function navLeaves(model: NavEntry[] = NAV_MODEL): NavLeaf[] {
  return model.flatMap((e) => (e.kind === 'item' ? [e.item] : e.items));
}

/** True when this leaf's route owns the current path. */
export function leafActive(href: string, pathname: string): boolean {
  return href === '/app' ? pathname === '/app' : pathname === href || pathname.startsWith(href + '/');
}

/** The group that owns the current path, if any — the accordion auto-opens it. */
export function groupOf(pathname: string, model: NavEntry[] = NAV_MODEL): string | null {
  for (const e of model) {
    if (e.kind === 'group' && e.items.some((i) => leafActive(i.href, pathname))) return e.key;
  }
  return null;
}

/**
 * The model with tier-hidden leaves removed; a group with nothing visible
 * vanishes entirely, so a BASIC school sees a five-line menu, not empty
 * headings.
 */
export function visibleModel(features: string[] | null): NavEntry[] {
  const show = (i: NavLeaf) => !features || !i.requiredFeature || features.includes(i.requiredFeature);
  const out: NavEntry[] = [];
  for (const e of NAV_MODEL) {
    if (e.kind === 'item') {
      if (show(e.item)) out.push(e);
    } else {
      const items = e.items.filter(show);
      if (items.length > 0) out.push({ ...e, items });
    }
  }
  return out;
}

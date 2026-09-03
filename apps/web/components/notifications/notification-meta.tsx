'use client';
import {
  Bell,
  BookOpen,
  CalendarCheck,
  FileText,
  GraduationCap,
  Library,
  Megaphone,
  MessageSquare,
  NotebookPen,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationKind } from '@skoolos/types';

/** Which portal the bell/view is mounted in — decides route targets by role. */
export type NotificationPortal = 'teacher' | 'student';

/** Icon shown on a notification row, keyed by kind. */
export const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  MESSAGE: MessageSquare,
  EXAM: FileText,
  RESULT: GraduationCap,
  ASSIGNMENT: BookOpen,
  ANNOUNCEMENT: Megaphone,
  REQUEST_DECISION: CalendarCheck,
  DIARY: NotebookPen,
  ATTENDANCE: TrendingDown,
  LIBRARY: Library,
  RESULTS_DUE: GraduationCap,
};

/** Fallback for a kind the client doesn't know yet (server added one later). */
export const FALLBACK_ICON: LucideIcon = Bell;

/**
 * Where a tapped notification takes the reader, resolved BY ROLE. The two
 * portals expose different routes (a teacher reads messages at `/teacher/inbox`,
 * a student at `/portal/messages`), so the same `kind` lands in different
 * places. `null` means "this kind has no destination for this role" — the row
 * still marks itself read, it just doesn't navigate.
 *
 * Only section-level routes are used (not per-item deep links): the portal
 * message/results/etc. screens drive their own internal selection and don't
 * take an id off the URL, so linking to the section is the honest target.
 */
export function routeForNotification(
  kind: NotificationKind,
  portal: NotificationPortal,
): string | null {
  if (portal === 'teacher') {
    switch (kind) {
      case 'MESSAGE':
        return '/teacher/inbox';
      case 'RESULT':
      case 'RESULTS_DUE':
        return '/teacher/results';
      case 'EXAM':
        return '/teacher/tests';
      case 'ASSIGNMENT':
        return '/teacher/assignments';
      case 'ANNOUNCEMENT':
        return '/teacher/announcements';
      case 'REQUEST_DECISION':
        return '/teacher/requests';
      case 'DIARY':
        return '/teacher/diary';
      case 'ATTENDANCE':
        // Who-needs-a-word lives inside Attendance now — it is a view of the
        // register, not a page of its own.
        return '/teacher/attendance';
      // Straight to the not-returned list for their own class, which is the
      // only thing the librarian is asking them to act on.
      case 'LIBRARY':
        return '/teacher/library';
      default:
        return null;
    }
  }
  // student portal
  switch (kind) {
    case 'MESSAGE':
      return '/portal/messages';
    case 'RESULT':
      return '/portal/results';
    case 'EXAM':
      return '/portal/timetable';
    case 'ASSIGNMENT':
      return '/portal/assignments';
    case 'ANNOUNCEMENT':
      return '/portal/announcements';
    case 'DIARY':
      return '/portal/diary';
    // The child's own attendance record — the same page the notice is about.
    case 'ATTENDANCE':
      return '/portal/attendance';
    case 'LIBRARY':
      return '/portal/library';
    // A student has no requests screen — the decision is a teacher-side route.
    case 'REQUEST_DECISION':
      return null;
    default:
      return null;
  }
}

/** Compact "how long ago" label; falls back to a short date past a week. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 60) return 'now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

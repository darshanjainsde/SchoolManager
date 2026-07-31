import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NAV_ITEMS } from './nav-items';

const TEACHER_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Every route directory that actually exists under apps/web/app/teacher —
 * the source of truth for "is this a real page or a dead link". A nav entry
 * pointing anywhere else 404s (or, before this task, silently rendered
 * "Nothing yet." forever — see the deleted /teacher/inbox).
 */
function realTeacherRoutes(): Set<string> {
  return new Set(
    readdirSync(TEACHER_DIR).filter((name) => statSync(join(TEACHER_DIR, name)).isDirectory()),
  );
}

describe('teacher nav honesty', () => {
  it('every NAV_ITEMS href points at a route that exists as a directory under apps/web/app/teacher', () => {
    const routes = realTeacherRoutes();

    for (const { href } of NAV_ITEMS) {
      // NAV_ITEMS only ever contains /teacher or /teacher/<segment> — no
      // nested routes yet, so a single path segment is what to check.
      const segment = href === '/teacher' ? null : href.replace(/^\/teacher\//, '');
      if (segment === null) continue; // '/teacher' itself is the layout's own index page.
      expect(routes.has(segment)).toBe(true);
    }
  });

  it('does not list the removed Inbox route (deleted — GET /notifications does not exist)', () => {
    expect(NAV_ITEMS.some((i) => i.href === '/teacher/inbox')).toBe(false);
  });

  /**
   * Phase 4 Task 4: Assignments graduated from an honest placeholder to a
   * real tool (create/list/delete against `/manage/assignments`) and is
   * back in the nav, matching the mobile app's staff More row of the same
   * name (`@/lib/staff-nav`'s `MORE_ITEMS`).
   */
  it('lists Assignments now that it is a working tool, not a placeholder', () => {
    expect(NAV_ITEMS.find((i) => i.href === '/teacher/assignments')?.label).toBe('Assignments');
  });

  /**
   * T3 menu-parity decision: the app's "Today" and the web's former "My
   * classes" are the same screen (current day, not a class list) — "Today"
   * is the honest name, so the web nav entry is renamed to match rather than
   * the other way round. See task-10-brief.md Part A.
   */
  it('names "/teacher" as Today, matching the mobile app\'s tab of the same screen', () => {
    expect(NAV_ITEMS.find((i) => i.href === '/teacher')?.label).toBe('Today');
  });

  /**
   * T3: the app's "Post" tab and this "Announcements" entry are the same
   * feature — the app was renamed to match this label, not vice versa.
   */
  it('names "/teacher/announcements" as Announcements, matching the mobile app\'s renamed tab', () => {
    expect(NAV_ITEMS.find((i) => i.href === '/teacher/announcements')?.label).toBe('Announcements');
  });
});

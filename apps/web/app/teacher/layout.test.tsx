import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NAV_ITEMS } from './layout';

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

  it('does not list Assignments — an honest placeholder page, not a working tool, stays out of the nav', () => {
    expect(NAV_ITEMS.some((i) => i.href === '/teacher/assignments')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAV_ITEMS } from './nav-items';

const PORTAL_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The student portal had NO nav test at all, while /teacher has had one since
 * Phase 2. That asymmetry is backwards: the student surface is the one a child
 * sees, and a child who taps a dead tab does not file a bug — they conclude the
 * app is broken and stop opening it.
 *
 * Same rule the teacher nav states: every entry must be a working tool, not a
 * placeholder. `/teacher/inbox` was deleted once for pointing at an endpoint
 * that did not exist.
 */
function realPortalRoutes(): Set<string> {
  return new Set(
    readdirSync(PORTAL_DIR).filter((name) => statSync(join(PORTAL_DIR, name)).isDirectory()),
  );
}

describe('student nav honesty', () => {
  it('every NAV_ITEMS href points at a route that exists on disk', () => {
    const routes = realPortalRoutes();

    for (const { href } of NAV_ITEMS) {
      const segment = href === '/portal' ? null : href.replace(/^\/portal\//, '');
      if (segment === null) continue; // the layout's own index page
      expect(routes.has(segment)).toBe(true);
    }
  });

  it('lists Library, gated on the LIBRARY feature', () => {
    const lib = NAV_ITEMS.find((i) => i.href === '/portal/library');
    expect(lib?.label).toBe('Library');
    expect(lib?.requiredFeature).toBe('LIBRARY');
  });

  it('gates nothing else on the library', () => {
    // A stray requiredFeature on Timetable would hide a core tab for every
    // school below PRO, and it would look like a data bug.
    const gated = NAV_ITEMS.filter((i) => i.requiredFeature).map((i) => i.href);
    expect(gated).toEqual(['/portal/library']);
  });
});

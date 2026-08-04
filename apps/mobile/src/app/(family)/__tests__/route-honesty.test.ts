import * as fs from 'fs';
import * as path from 'path';
import { VISIBLE_TABS, HIDDEN_ROUTES, MORE_ITEMS } from '@/lib/family-nav';

/**
 * Family twin of `(staff)/__tests__/route-honesty.test.ts` (itself a mirror
 * of apps/web/app/teacher/layout.test.tsx's "every NAV_ITEMS href resolves"
 * check): every tab and every drawer tile must point at a route file that
 * actually exists, so a renamed/removed screen fails loudly here instead of
 * shipping a dead tab or a drawer tile that navigates nowhere.
 */
const FAMILY_DIR = path.join(__dirname, '..'); // apps/mobile/src/app/(family)

function routeFileExists(routeName: string): boolean {
  // routeName is either a plain screen ("notices") or a dynamic segment
  // directory + file ("messages/[threadId]").
  return fs.existsSync(path.join(FAMILY_DIR, `${routeName}.tsx`));
}

describe('family route honesty', () => {
  it('every visible tab points at a screen file that exists', () => {
    for (const { name } of VISIBLE_TABS) {
      expect(routeFileExists(name)).toBe(true);
    }
  });

  it('shows exactly the four core tabs — no "More" tab (it became the tools drawer)', () => {
    // Menu-drawer revision: the "More" tab is gone; its contents moved into
    // the chevron-FAB bottom sheet (FamilyToolsDrawer), driven by MORE_ITEMS.
    // Profile replaced Notices in the bar — Notices lives in the drawer now
    // (which also kills the two-line "Notices/Announcements" tab-label bug).
    expect(VISIBLE_TABS.map((t) => t.name)).toEqual(['home', 'attendance', 'results', 'profile']);
    expect(VISIBLE_TABS.some((t) => t.name === 'more')).toBe(false);
    expect(routeFileExists('more')).toBe(false);
  });

  it('every hidden (drawer-reachable) route points at a screen file that exists', () => {
    for (const name of HIDDEN_ROUTES) {
      expect(routeFileExists(name)).toBe(true);
    }
  });

  it('every drawer tile points at a route that exists', () => {
    for (const { route } of MORE_ITEMS) {
      // MORE_ITEMS routes are absolute expo-router paths, e.g. '/(family)/notices'.
      const relative = route.replace('/(family)/', '');
      expect(routeFileExists(relative)).toBe(true);
    }
  });

  it('lists every off-bar tool — Diary, Timetable, Assignments, Messages, Notices, Holidays', () => {
    const labels = MORE_ITEMS.map((i) => i.label);
    expect(labels).toEqual([
      'Diary',
      'Timetable',
      'Assignments',
      'Messages',
      'Notices',
      'Holidays',
    ]);
    // Profile is a core tab now, so it must NOT double up as a drawer tile.
    expect(labels).not.toContain('Profile');
  });

  it('lists a Messages tile pointing at the thread-list screen, with its detail route hidden', () => {
    const messages = MORE_ITEMS.find((i) => i.label === 'Messages');
    expect(messages?.route).toBe('/(family)/messages');
    expect(routeFileExists('messages')).toBe(true);
    // The thread-detail screen is reachable only by tapping a thread, so it is
    // hidden from the tab bar — registered via HIDDEN_ROUTES, not a drawer tile.
    expect(HIDDEN_ROUTES).toContain('messages/[threadId]');
    expect(routeFileExists('messages/[threadId]')).toBe(true);
  });

  it('every (family) screen file is registered as a tab or a hidden route (nothing unreachable)', () => {
    // The layout registers exactly VISIBLE_TABS + HIDDEN_ROUTES. A screen file
    // in neither list would be an unregistered orphan expo-router still
    // auto-adds to the navigator — fail loudly instead.
    const registered = new Set([...VISIBLE_TABS.map((t) => t.name), ...HIDDEN_ROUTES]);
    const screens: string[] = [];
    for (const entry of fs.readdirSync(FAMILY_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.tsx') && entry.name !== '_layout.tsx') {
        // iCloud conflict copies ("foo 2.tsx") are local noise, not routes.
        if (/ \d+\.tsx$/.test(entry.name)) continue;
        screens.push(entry.name.replace(/\.tsx$/, ''));
      }
      if (entry.isDirectory() && entry.name !== '__tests__') {
        for (const sub of fs.readdirSync(path.join(FAMILY_DIR, entry.name))) {
          if (sub.endsWith('.tsx') && !/ \d+\.tsx$/.test(sub)) {
            screens.push(`${entry.name}/${sub.replace(/\.tsx$/, '')}`);
          }
        }
      }
    }
    for (const screen of screens) {
      expect(`${screen}: ${registered.has(screen)}`).toBe(`${screen}: true`);
    }
  });
});

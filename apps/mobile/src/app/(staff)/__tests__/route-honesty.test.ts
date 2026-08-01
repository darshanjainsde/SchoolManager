import * as fs from 'fs';
import * as path from 'path';
import { VISIBLE_TABS, HIDDEN_ROUTES, MORE_ITEMS } from '@/lib/staff-nav';

/**
 * Mirror of apps/web/app/teacher/layout.test.tsx's "every NAV_ITEMS href
 * resolves" check (T3 menu-parity decision, task-10-brief.md Part A.3):
 * every tab and every More row must point at a route file that actually
 * exists, so a renamed/removed screen fails loudly here instead of shipping
 * a dead tab or a More row that navigates nowhere.
 */
const STAFF_DIR = path.join(__dirname, '..'); // apps/mobile/src/app/(staff)

function routeFileExists(routeName: string): boolean {
  // routeName is either a plain screen ("tests") or a dynamic segment
  // directory + file ("take/[classSectionId]", "results/[examId]").
  return fs.existsSync(path.join(STAFF_DIR, `${routeName}.tsx`));
}

describe('staff route honesty', () => {
  it('every visible tab points at a screen file that exists', () => {
    for (const { name } of VISIBLE_TABS) {
      expect(routeFileExists(name)).toBe(true);
    }
  });

  it('shows exactly the four core tabs — no "More" tab (it became the tools drawer)', () => {
    // Menu-drawer revision: the fifth "More" tab is gone; its contents moved
    // into the chevron-FAB bottom sheet (ToolsDrawer), driven by MORE_ITEMS.
    expect(VISIBLE_TABS.map((t) => t.name)).toEqual(['today', 'attendance', 'timetable', 'post']);
    expect(VISIBLE_TABS.some((t) => t.name === 'more')).toBe(false);
    expect(routeFileExists('more')).toBe(false);
  });

  it('every hidden (More-reachable) route points at a screen file that exists', () => {
    for (const name of HIDDEN_ROUTES) {
      expect(routeFileExists(name)).toBe(true);
    }
  });

  it('every More row points at a route that exists', () => {
    for (const { route } of MORE_ITEMS) {
      // MORE_ITEMS routes are absolute expo-router paths, e.g. '/(staff)/tests'.
      const relative = route.replace('/(staff)/', '');
      expect(routeFileExists(relative)).toBe(true);
    }
  });

  it('lists the web nav sections — Tests & Results (one row on mobile), Requests, Holidays, Profile', () => {
    const labels = MORE_ITEMS.map((i) => i.label);
    expect(labels).toEqual(expect.arrayContaining(['Tests & Results', 'Requests', 'Holidays', 'Profile']));
    // Tests and Results are a single row here (they'd point at the same screen
    // otherwise) — the tests screen opens a test's results on tap.
    expect(labels).not.toContain('Results');
  });

  it('lists a Messages row pointing at the thread-list screen, with its detail route hidden', () => {
    const messages = MORE_ITEMS.find((i) => i.label === 'Messages');
    expect(messages?.route).toBe('/(staff)/messages');
    expect(routeFileExists('messages')).toBe(true);
    // The thread-detail screen is reachable only by tapping a thread, so it is
    // hidden from the tab bar — registered via HIDDEN_ROUTES, not a More row.
    expect(HIDDEN_ROUTES).toContain('messages/[threadId]');
    expect(routeFileExists('messages/[threadId]')).toBe(true);
  });

  it('lists a Notes row pointing at the class-list screen, with its detail route hidden', () => {
    const notes = MORE_ITEMS.find((i) => i.label === 'Notes');
    expect(notes?.route).toBe('/(staff)/notes');
    expect(routeFileExists('notes')).toBe(true);
    // The per-class history is reachable only by tapping a class, so it is
    // hidden from the tab bar — registered via HIDDEN_ROUTES, not a More row.
    expect(HIDDEN_ROUTES).toContain('notes/[classSectionId]');
    expect(routeFileExists('notes/[classSectionId]')).toBe(true);
  });

  it('names the "Today" tab and the "Announcements" tab to match the web nav', () => {
    expect(VISIBLE_TABS.find((t) => t.name === 'today')?.title).toBe('Today');
    expect(VISIBLE_TABS.find((t) => t.name === 'post')?.title).toBe('Announcements');
  });
});

import { describe, it, expect } from 'vitest';
import { NAV_MODEL, groupOf, leafActive, navLeaves, visibleModel } from './nav-model';

/**
 * The sidebar's contract. Every console route lives in EXACTLY one place —
 * a screen that falls out of this list silently becomes unreachable chrome
 * (the LIBRARY-was-unreachable lesson, applied to navigation).
 */

/** The full set, pinned — adding or removing a screen is a deliberate edit HERE. */
const EVERY_ROUTE = [
  '/app',
  '/app/website', '/app/blog', '/app/events',
  '/app/enquiries',
  '/app/students', '/app/teachers', '/app/staff', '/app/classes', '/app/jobs',
  '/app/staff-attendance', '/app/leave', '/app/requests',
  '/app/timetable', '/app/availability',
  '/app/exam-hall', '/app/press', '/app/press/orders',
  '/app/fees', '/app/library', '/app/announcements', '/app/alumni', '/app/settings',
].sort();

describe('the grouped sidebar model', () => {
  it('carries every console route exactly once', () => {
    const hrefs = navLeaves().map((l) => l.href);
    expect([...hrefs].sort()).toEqual(EVERY_ROUTE);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('anchors hold their places: Dashboard first, Settings last', () => {
    const leaves = navLeaves();
    expect(leaves[0]!.href).toBe('/app');
    expect(leaves[leaves.length - 1]!.href).toBe('/app/settings');
  });

  it('every group has at least one item, a unique key and a spoken-word label', () => {
    const groups = NAV_MODEL.filter((e) => e.kind === 'group');
    expect(groups.length).toBe(6);
    const keys = groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
      expect(g.label).toMatch(/^[A-Z][a-z]+$/); // one word a principal can say
    }
  });

  it('a BASIC school sees a short flat menu — empty groups vanish, no bare headings', () => {
    const model = visibleModel(['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL']);
    const labels = model.map((e) => (e.kind === 'item' ? e.item.label : `▾${e.label}`));
    // Website group survives (the Website page itself is ungated), Admissions
    // survives via ENQUIRY; People/Attendance/Timetable/Exams vanish whole.
    expect(labels).toEqual(['Dashboard', '▾Website', '▾Admissions', 'Announcements']);
  });

  it('null features (still loading) shows everything — a slow fetch must not hide screens', () => {
    expect(navLeaves(visibleModel(null)).length).toBe(EVERY_ROUTE.length);
  });

  it('groupOf finds the owning group, and anchors own themselves', () => {
    expect(groupOf('/app/press')).toBe('exams');
    expect(groupOf('/app/press/register')).toBe('exams');
    expect(groupOf('/app/staff-attendance')).toBe('attendance');
    expect(groupOf('/app/fees/verify')).toBeNull(); // Fees is an anchor, not a group child
    expect(groupOf('/app')).toBeNull();
  });

  it('leafActive: nested leaves — the longest href wins, a path never lights two tabs', () => {
    // Print Store lives under Reports & Documents' route space.
    expect(leafActive('/app/press/orders', '/app/press/orders')).toBe(true);
    expect(leafActive('/app/press/orders', '/app/press/orders/abc')).toBe(true);
    expect(leafActive('/app/press', '/app/press/orders')).toBe(false);
    expect(leafActive('/app/press', '/app/press/orders/abc')).toBe(false);
    // …while the parent still owns everything else beneath it.
    expect(leafActive('/app/press', '/app/press/results')).toBe(true);
    expect(leafActive('/app/press', '/app/press')).toBe(true);
  });

  it('leafActive: the dashboard matches itself only; others own their subtrees', () => {
    expect(leafActive('/app', '/app')).toBe(true);
    expect(leafActive('/app', '/app/fees')).toBe(false);
    expect(leafActive('/app/fees', '/app/fees/verify')).toBe(true);
    // '/app/staff' must not claim '/app/staff-attendance'.
    expect(leafActive('/app/staff', '/app/staff-attendance')).toBe(false);
  });
});

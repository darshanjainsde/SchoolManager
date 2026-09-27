import { jobFor, tabsFor, homeTabFor, ALL_TABS } from '../worker-nav';

/**
 * One portal, three desks: which tabs a session gets is decided by the staff
 * job AND the school's modules — a librarian at a school without the Library
 * module is general staff, and a sports teacher sees no Counter.
 */
describe('worker desks', () => {
  it('general staff get Today and Profile', () => {
    expect(jobFor({ staffRole: 'DRIVER', features: ['LIBRARY', 'SPORTS'] })).toBe('GENERAL');
    expect(tabsFor('GENERAL').map((t) => t.name)).toEqual(['today', 'profile']);
  });
  it('a sports teacher opens on the desk with meets, records and houses', () => {
    expect(jobFor({ staffRole: 'SPORTS', features: ['SPORTS'] })).toBe('SPORTS');
    expect(tabsFor('SPORTS').map((t) => t.name)).toEqual(['desk', 'meets', 'records', 'houses', 'profile']);
    expect(homeTabFor('SPORTS')).toBe('desk');
  });
  it('a librarian opens on the counter', () => {
    expect(jobFor({ staffRole: 'LIBRARIAN', features: ['LIBRARY'] })).toBe('LIBRARIAN');
    expect(tabsFor('LIBRARIAN').map((t) => t.name)).toEqual(['counter', 'hall', 'books', 'fines', 'profile']);
  });
  it('a desk job at a school without that module is general staff', () => {
    expect(jobFor({ staffRole: 'LIBRARIAN', features: [] })).toBe('GENERAL');
    expect(jobFor({ staffRole: 'SPORTS', features: ['LIBRARY'] })).toBe('GENERAL');
  });
  it('an older session (no staffRole) and no session are general', () => {
    expect(jobFor({ features: ['SPORTS'] })).toBe('GENERAL');
    expect(jobFor(null)).toBe('GENERAL');
  });
  it('every tab a job draws is a declared tab, and every label fits a five-slot bar', () => {
    const names = new Set(ALL_TABS.map((t) => t.name));
    for (const job of ['GENERAL', 'SPORTS', 'LIBRARIAN'] as const) {
      for (const t of tabsFor(job)) {
        expect(names.has(t.name)).toBe(true);
        expect(t.title.length).toBeLessThanOrEqual(8);
      }
      expect(tabsFor(job).length).toBeLessThanOrEqual(5);
    }
  });
});

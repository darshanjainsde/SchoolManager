import { jobFor, tabsFor, homeTabFor, tabNamesFor, ALL_TABS } from '../worker-nav';

/**
 * One portal, three desks: which tabs a session gets is decided by the staff
 * job AND the school's modules — a librarian at a school without the Library
 * module is general staff, and a sports teacher sees no Counter.
 */
describe('worker desks', () => {
  it('general staff get Today and Profile', () => {
    expect(jobFor({ staffRole: 'DRIVER', features: ['LIBRARY', 'SPORTS'] })).toBe('GENERAL');
    expect(tabsFor({ staffRole: 'DRIVER', features: ['LIBRARY', 'SPORTS'] }).map((t) => t.name)).toEqual(['today', 'profile']);
  });
  it('a sports teacher opens on the desk with meets, records and houses', () => {
    expect(jobFor({ staffRole: 'SPORTS', features: ['SPORTS'] })).toBe('SPORTS');
    const s = { staffRole: 'SPORTS', features: ['SPORTS'] };
    expect(tabsFor(s).map((t) => t.name)).toEqual(['desk', 'meets', 'records', 'houses', 'profile']);
    expect(homeTabFor(s)).toBe('desk');
  });
  it('a librarian opens on the counter', () => {
    expect(jobFor({ staffRole: 'LIBRARIAN', features: ['LIBRARY'] })).toBe('LIBRARIAN');
    expect(tabsFor({ staffRole: 'LIBRARIAN', features: ['LIBRARY'] }).map((t) => t.name)).toEqual(['counter', 'hall', 'books', 'fines', 'profile']);
  });
  it('a desk job at a school without that module is general staff', () => {
    expect(jobFor({ staffRole: 'LIBRARIAN', features: [] })).toBe('GENERAL');
    expect(jobFor({ staffRole: 'SPORTS', features: ['LIBRARY'] })).toBe('GENERAL');
  });
  it('an accounts officer gets the desk on the JOB; the Pay tab needs the SALARY override', () => {
    const withPay = { staffRole: 'ACCOUNTS', features: ['MANAGEMENT', 'SALARY'] };
    expect(jobFor(withPay)).toBe('ACCOUNTS');
    expect(tabNamesFor(withPay)).toEqual(['leavedesk', 'paydesk', 'profile']);
    // Leave first: Pay needs a right an admin grants (re-audit 2026-10-08).
    expect(homeTabFor(withPay)).toBe('leavedesk');
    // No SALARY: still the accounts desk, still the leave decisions — no Pay
    // tab, and the portal opens on Leave rather than on a tab that is hidden.
    const noPay = { staffRole: 'ACCOUNTS', features: ['MANAGEMENT'] };
    expect(jobFor(noPay)).toBe('ACCOUNTS');
    expect(tabNamesFor(noPay)).toEqual(['leavedesk', 'profile']);
    expect(homeTabFor(noPay)).toBe('leavedesk');
  });
  it('an older session (no staffRole) and no session are general', () => {
    expect(jobFor({ features: ['SPORTS'] })).toBe('GENERAL');
    expect(jobFor(null)).toBe('GENERAL');
  });
  it('every tab a job draws is a declared tab, and every label fits a five-slot bar', () => {
    const names = new Set(ALL_TABS.map((t) => t.name));
    const sessions = [
      { staffRole: 'DRIVER', features: [] },
      { staffRole: 'SPORTS', features: ['SPORTS'] },
      { staffRole: 'LIBRARIAN', features: ['LIBRARY'] },
      { staffRole: 'ACCOUNTS', features: ['SALARY'] },
      { staffRole: 'ACCOUNTS', features: [] },
    ];
    for (const s of sessions) {
      for (const t of tabsFor(s)) {
        expect(names.has(t.name)).toBe(true);
        expect(t.title.length).toBeLessThanOrEqual(8);
      }
      expect(tabsFor(s).length).toBeLessThanOrEqual(5);
    }
  });

  it('an admissions officer is general staff in the app until the Leads tabs ship (Tier C)', () => {
    // Passes the moment it is written — it pins the behaviour, so the Tier C
    // change has to come here and change it on purpose.
    const s = { staffRole: 'ADMISSIONS', features: ['ENQUIRY', 'MANAGEMENT'] };
    expect(jobFor(s)).toBe('GENERAL');
    expect(tabNamesFor(s)).toEqual(['today', 'profile']);
  });

  it('every staff job has a label in the app (else the job reads as "Staff")', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    const root = resolve(__dirname, '../../../../..');
    const schema = readFileSync(resolve(root, 'packages/db/prisma/schema.prisma'), 'utf8');
    const start = schema.indexOf('enum StaffRole {');
    const jobs = schema.slice(start, schema.indexOf('}', start)).split('\n').map((l: string) => l.trim()).filter((l: string) => /^[A-Z_]+$/.test(l));
    expect(jobs).toContain('ADMISSIONS');
    for (const file of ['src/app/(worker)/(tabs)/today/index.tsx', 'src/app/(worker)/(tabs)/profile/index.tsx']) {
      const src = readFileSync(resolve(__dirname, '../../../', file), 'utf8');
      const at = src.indexOf('const STAFF_ROLE_LABEL');
      expect(at).toBeGreaterThan(-1);
      const block = src.slice(at, src.indexOf('};', at));
      for (const job of jobs) expect(block).toContain(`${job}:`);
    }
  });
});

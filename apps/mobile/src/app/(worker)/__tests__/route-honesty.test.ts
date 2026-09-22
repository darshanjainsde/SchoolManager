import * as fs from 'fs';
import * as path from 'path';
import { ALL_TABS, HIDDEN_ROUTES } from '@/lib/worker-nav';

/**
 * Mirror of the staff and family route-honesty checks: every tab and every
 * pushed screen must point at a file that exists, so a renamed screen fails
 * here instead of shipping a tab that navigates nowhere. This portal grew
 * from one bare screen to a real one (UI audit 2026-09-22, #5) — the shape
 * is now the same as the other two, and this is what pins it.
 */
const WORKER_DIR = path.join(__dirname, '..'); // apps/mobile/src/app/(worker)

describe('worker route honesty', () => {
  it('every visible tab points at a screen file that exists', () => {
    for (const { name } of ALL_TABS) {
      const ok =
        fs.existsSync(path.join(WORKER_DIR, '(tabs)', `${name}.tsx`)) ||
        fs.existsSync(path.join(WORKER_DIR, '(tabs)', name, 'index.tsx'));
      expect(`${name}: ${ok}`).toBe(`${name}: true`);
    }
  });

  it('every pushed screen exists', () => {
    for (const route of HIDDEN_ROUTES) {
      const ok = fs.existsSync(path.join(WORKER_DIR, `${route}.tsx`));
      expect(`${route}: ${ok}`).toBe(`${route}: true`);
    }
  });

  it('a tab that owns pushed screens carries its own stack layout', () => {
    for (const { name } of ALL_TABS) {
      const dir = path.join(WORKER_DIR, '(tabs)', name);
      if (!fs.existsSync(dir)) continue;
      expect(`${name}/_layout: ${fs.existsSync(path.join(dir, '_layout.tsx'))}`).toBe(`${name}/_layout: true`);
    }
  });

  it('signing out is reachable — this portal had no way out at all before', () => {
    const profile = fs.readFileSync(path.join(WORKER_DIR, '(tabs)/profile/index.tsx'), 'utf8');
    expect(profile).toContain('profile-signout');
    expect(profile).toContain("signOut");
  });
});

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIVE_DESK_MS, makeQueryClient } from './providers';

/**
 * THE WEB PICKS UP WHAT THE APP CHANGED. An open tab that comes back into
 * focus asks again; the desks people act on from their phones re-check while
 * on screen. Only editors that hold a draft may opt out, and they are named
 * here, so a live page cannot quietly opt out again.
 */
const EDITORS_THAT_HOLD_A_DRAFT = new Set([
  'app/app/website/studio-tab.tsx', 'app/app/website/staff-tab.tsx', 'app/app/website/courses-tab.tsx', 'app/app/website/gallery-tab.tsx',
  'app/app/website/admissions-tab.tsx', 'app/app/website/site-form.ts', 'components/timetable/TimetableEditor.tsx', 'app/app/blog/page.tsx',
  'app/app/settings/page.tsx', 'app/app/settings/general/class-notes.tsx', 'app/app/exam-hall/page.tsx', 'app/app/onboarding/page.tsx',
  'app/app/classes/structure/page.tsx', 'app/app/classes/page.tsx', 'app/app/students/page.tsx', 'app/app/teachers/page.tsx',
  'app/app/staff/page.tsx', 'app/app/announcements/page.tsx', 'app/app/events/page.tsx', 'app/app/timetable/page.tsx',
]);

describe('freshness defaults', () => {
  it('a tab back in focus, or back online, asks again for anything older than 30 s', () => {
    const q = makeQueryClient().getDefaultOptions().queries!;
    expect(q.refetchOnWindowFocus).toBe(true);
    expect(q.refetchOnReconnect).toBe(true);
    expect(q.staleTime).toBe(30_000);
  });

  it('only named draft-holding editors opt out of refetch-on-focus', () => {
    const root = resolve(__dirname, '..');
    const files = execSync("git grep -l 'refetchOnWindowFocus: false' -- app components lib", { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const strays = files.filter((f) => !EDITORS_THAT_HOLD_A_DRAFT.has(f) && !f.endsWith('.test.tsx') && !f.endsWith('.test.ts'));
    expect(strays).toEqual([]);
  });

  it('the Leave and Requests desks re-check every minute while on screen', () => {
    expect(LIVE_DESK_MS).toBe(60_000);
    for (const f of ['app/app/leave/page.tsx', 'app/app/requests/page.tsx']) {
      const src = readFileSync(resolve(__dirname, '..', f), 'utf8');
      expect((src.match(/refetchInterval: LIVE_DESK_MS/g) ?? []).length, f).toBeGreaterThanOrEqual(2);
    }
  });
});

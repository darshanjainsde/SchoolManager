import * as fs from 'node:fs';
import * as path from 'node:path';
import { isPushedRoute, titleForSegments } from '../screen-titles';

/**
 * Route-honesty for the chip header: every pushed route FILE on disk must be
 * recognised as pushed and resolve a non-empty title. A tool added to a home
 * stack without a word in `TITLES` would ship a chip header with a blank
 * title — this catches it at the filesystem, the same way
 * route-honesty.test.ts pins the nav lists.
 */
const APP_DIR = path.join(__dirname, '../../app');

function pushedRouteFiles(stackDir: string): string[][] {
  const abs = path.join(APP_DIR, stackDir);
  const out: string[][] = [];
  const walk = (dir: string, rel: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), [...rel, entry.name]);
      } else if (
        entry.name.endsWith('.tsx') &&
        entry.name !== '_layout.tsx' &&
        entry.name !== 'index.tsx'
      ) {
        out.push([...stackDir.split('/'), ...rel, entry.name.replace(/\.tsx$/, '')]);
      }
    }
  };
  walk(abs, []);
  return out;
}

it('every screen in the tab stacks (home + profile) is pushed and has a chip title', () => {
  const files = [
    ...pushedRouteFiles('(staff)/(tabs)/home'),
    ...pushedRouteFiles('(family)/(tabs)/home'),
    ...pushedRouteFiles('(staff)/(tabs)/profile'),
    ...pushedRouteFiles('(family)/(tabs)/profile'),
  ];
  expect(files.length).toBeGreaterThan(0);
  for (const segments of files) {
    expect(isPushedRoute(segments)).toBe(true);
    expect(titleForSegments(segments)).not.toBe('');
  }
});

it('the carved-out register is pushed and titled', () => {
  const segments = ['(staff)', 'take', '[classSectionId]'];
  expect(fs.existsSync(path.join(APP_DIR, '(staff)/take/[classSectionId].tsx'))).toBe(true);
  expect(isPushedRoute(segments)).toBe(true);
  expect(titleForSegments(segments)).toBe('Attendance');
});

it('home indexes and tab screens are not pushed', () => {
  for (const segments of [
    ['(staff)', '(tabs)', 'home'],
    ['(family)', '(tabs)', 'home'],
    ['(staff)', '(tabs)', 'attendance'],
    ['(family)', '(tabs)', 'results'],
    ['(family)', '(tabs)', 'profile'],
    ['(worker)', 'today'],
  ]) {
    expect(isPushedRoute(segments)).toBe(false);
  }
});

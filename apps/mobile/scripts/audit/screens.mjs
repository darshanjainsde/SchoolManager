#!/usr/bin/env node
/**
 * The screen inventory: every route file under src/app, which portal (role)
 * it belongs to, the API paths it calls, the shared components it draws with,
 * and how many testIDs it exposes. Written as JSON to stdout so a skill or a
 * review can say "the teacher Diary is app/(staff)/(tabs)/home/diary.tsx,
 * calls /manage/diary…, draws with Screen, Page, StudentPicker".
 *
 *   node apps/mobile/scripts/audit/screens.mjs > screens.json
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'src', 'app');
const PORTAL = { '(staff)': 'teacher', '(family)': 'student/family', '(worker)': 'staff desks', '(auth)': 'signed out' };

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : walk(full);
    return /\.tsx$/.test(name) && !/_layout\.tsx$/.test(name) && !/ \d+\.tsx$/.test(name) ? [full] : [];
  });
}

const screens = walk(ROOT).map((file) => {
  const rel = relative(ROOT, file).split(sep).join('/');
  const src = readFileSync(file, 'utf8');
  const top = rel.split('/')[0];
  const route = '/' + rel.replace(/\.tsx$/, '').replace(/\/index$/, '').replace(/\([^)]*\)\//g, '');
  const apis = [...new Set([...src.matchAll(/['"`](\/(?:manage|me|sports|library|auth|owner|messages|concerns|portal|staff|school)[^'"`?$]*)/g)].map((m) => m[1]))].sort();
  const components = [...new Set([...src.matchAll(/import \{([^}]+)\} from '@\/components\/[^']+'/g)].flatMap((m) => m[1].split(',').map((s) => s.replace(/type /, '').trim()).filter(Boolean)))].sort();
  const testIDs = (src.match(/testID=/g) ?? []).length;
  return { role: PORTAL[top] ?? 'shared', route, file: `src/app/${rel}`, apis, components, testIDs };
});

process.stdout.write(JSON.stringify(screens, null, 2) + '\n');

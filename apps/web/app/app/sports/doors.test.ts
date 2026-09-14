// @vitest-environment node
//
// TWO DOORS, ONE DESK — the library's guard for the sports wing.
//
// /app/sports (admin console) and /sports (the sports teacher's portal) must
// offer the same sections, except the admin-only ones, which exist only behind
// the console door. Each route file is a three-line wrapper, so a section added
// to one door and forgotten on the other compiles and passes every other test.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appDir = resolve(process.cwd(), 'app');
const consoleDir = join(appDir, 'app/sports');
const portalDir = join(appDir, 'sports');

function declared(): { seg: string; adminOnly: boolean }[] {
  const src = readFileSync(join(consoleDir, 'nav-items.ts'), 'utf8');
  return [...src.matchAll(/\{\s*seg:\s*'([^']*)',\s*label:\s*'[^']*'(,\s*adminOnly:\s*true)?/g)].map((m) => ({ seg: m[1], adminOnly: !!m[2] }));
}

function routeSegments(dir: string): string[] {
  const out = existsSync(join(dir, 'page.tsx')) ? [''] : [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'tournaments') continue;
    if (existsSync(join(dir, entry.name, 'page.tsx'))) out.push(entry.name);
  }
  return out.sort();
}

describe('the sports desk has the same sections behind both doors', () => {
  const sections = declared();
  it('declares the sections the strip draws', () => {
    expect(sections.map((s) => s.seg)).toEqual(['', 'records', 'houses', 'rules', 'settings', 'teachers']);
  });
  it('the console door has a route for every section', () => {
    expect(routeSegments(consoleDir)).toEqual(sections.map((s) => s.seg).sort());
  });
  it('the teacher door has a route for every section that is not admin-only, and none for those that are', () => {
    expect(routeSegments(portalDir)).toEqual(sections.filter((s) => !s.adminOnly).map((s) => s.seg).sort());
  });
  it('both doors open a tournament by id', () => {
    expect(existsSync(join(consoleDir, 'tournaments/[id]/page.tsx'))).toBe(true);
    expect(existsSync(join(portalDir, 'tournaments/[id]/page.tsx'))).toBe(true);
  });
  it('every portal route renders the console tab component, never a copy', () => {
    for (const seg of routeSegments(portalDir)) {
      const src = readFileSync(join(portalDir, seg, 'page.tsx'), 'utf8');
      expect(src).toMatch(/from '@\/app\/app\/sports\//);
      expect(src).toMatch(/base="\/sports"/);
    }
  });
});

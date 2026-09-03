// @vitest-environment node
//
// TWO DOORS, ONE LIBRARY.
//
// The library is a tab of the admin console at /app/library, with the sidebar
// intact. But a STAFF/LIBRARIAN cannot enter the console — `app/app/layout.tsx`
// is SCHOOL_ADMIN-only — so she keeps her own portal at /library and it renders
// the SAME section components in her own shell.
//
// That arrangement is only safe while the two trees stay in step. Nothing in
// the type system says they must: each route file is an independent three-line
// wrapper, so adding a section to one door and forgetting the other compiles,
// lints, and passes every other test — the librarian would simply be missing a
// tab, or get a 404 from a strip that offers her one.
//
// Read as TEXT rather than imported: these are client components that cannot be
// imported outside a Next build.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appDir = resolve(process.cwd(), 'app');
const consoleDir = join(appDir, 'app/library');
const portalDir = join(appDir, 'library');

/** The section list both shells draw their strip from. */
function declaredSegments(): string[] {
  const src = readFileSync(join(consoleDir, 'nav-items.ts'), 'utf8');
  return [...src.matchAll(/\{\s*seg:\s*'([^']*)'/g)].map((m) => m[1]);
}

/** Route segments that actually exist under a door (index route as ''). */
function routeSegments(dir: string): string[] {
  const out = existsSync(join(dir, 'page.tsx')) ? [''] : [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(dir, entry.name, 'page.tsx'))) out.push(entry.name);
  }
  return out.sort();
}

/** The `*-tab` module each of a door's routes renders. */
function tabImports(dir: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const seg of routeSegments(dir)) {
    const src = readFileSync(join(dir, seg, 'page.tsx'), 'utf8');
    const m = src.match(/from '(?:\.\.?\/|@\/app\/app\/library\/)([a-z-]+-tab)'/);
    map[seg] = m ? m[1] : `NO -tab IMPORT in ${seg || 'index'}/page.tsx`;
  }
  return map;
}

describe('the library is one implementation behind two doors', () => {
  it('declares six sections', () => {
    // A silently-empty parse would make every assertion below vacuously true.
    expect(declaredSegments()).toEqual(['', 'counter', 'hall', 'books', 'fines', 'settings']);
  });

  it('the console tab has a route for every declared section', () => {
    expect(routeSegments(consoleDir)).toEqual([...declaredSegments()].sort());
  });

  it("the librarian's portal has a route for every declared section", () => {
    expect(routeSegments(portalDir)).toEqual([...declaredSegments()].sort());
  });

  it('both doors render the same component for the same section', () => {
    // This is the assertion that actually catches the drift: same keys, and the
    // same `*-tab` module behind each one.
    expect(tabImports(portalDir)).toEqual(tabImports(consoleDir));
  });

  it('every declared section is backed by a -tab component that exists', () => {
    const behind = Object.values(tabImports(consoleDir));
    expect(behind.length).toBe(declaredSegments().length);
    for (const mod of behind) {
      expect(existsSync(join(consoleDir, `${mod}.tsx`)), `${mod}.tsx is missing`).toBe(true);
    }
  });

  it('the sidebar no longer points out of /app', () => {
    // The Library entry was the ONE leaf that left the console segment, and it
    // carried a `leavesConsole` flag plus an "opens its own portal" arrow to
    // warn people before they clicked. Both are gone; this fails if either
    // comes back. The grouped nav keeps its leaves in `nav-model.ts` and the
    // cue was rendered by `layout.tsx`, so both files are checked.
    const model = readFileSync(join(appDir, 'app/nav-model.ts'), 'utf8');
    expect(model).toContain("href: '/app/library'");
    expect(model).not.toMatch(/href:\s*'\/library'/);
    expect(model).not.toContain('leavesConsole');

    const shell = readFileSync(join(appDir, 'app/layout.tsx'), 'utf8');
    expect(shell).not.toContain('leavesConsole');
  });
});

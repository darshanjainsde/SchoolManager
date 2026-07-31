import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename, relative } from 'node:path';

/**
 * Guard against the class of bug that broke the Vercel build twice (staff +
 * teacher `export const NAV_ITEMS`): Next.js App Router validates the exports of
 * special files (layout/page/route/…) against a fixed allowlist AT `next build`
 * TIME ONLY. `tsc --noEmit`, `next lint`, and the rest of vitest all pass on a
 * stray `export const NAV_ITEMS` — so it sails through every gate except the one
 * Vercel actually runs. This test reproduces that gate cheaply, in the unit
 * suite everyone runs locally and in CI, so the failure surfaces before a push.
 *
 * If this test fails: move the offending const/function into a SIBLING module
 * (e.g. `nav-items.ts`) and import it back. Do not "fix" it by widening the
 * allowlist below.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));

// Route-segment config options — legal in layout, page, and route files.
const SEGMENT_CONFIG = [
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'experimental_ppr',
  'config',
];

// Allowed NAMED exports per special-file kind (default export is always allowed
// and handled separately). Keyed by the file's basename without extension.
const ALLOWED: Record<string, string[]> = {
  layout: [...SEGMENT_CONFIG, 'metadata', 'generateMetadata', 'viewport', 'generateViewport', 'generateStaticParams'],
  page: [...SEGMENT_CONFIG, 'metadata', 'generateMetadata', 'viewport', 'generateViewport', 'generateStaticParams'],
  route: [...SEGMENT_CONFIG, 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
  loading: [],
  error: [],
  'global-error': [],
  template: [...SEGMENT_CONFIG],
  default: [...SEGMENT_CONFIG],
  'not-found': [],
};

const SPECIAL_FILES = new Set(Object.keys(ALLOWED));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** All named exports declared in a source file (const/function/let/var/class + `export { ... }`). */
function namedExports(src: string): string[] {
  const names = new Set<string>();
  const declRe = /^\s*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/gm;
  for (const m of src.matchAll(declRe)) names.add(m[1]);
  const listRe = /^\s*export\s*\{([^}]*)\}/gm;
  for (const m of src.matchAll(listRe)) {
    for (const part of m[1].split(',')) {
      const token = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (token && token !== 'default') names.add(token);
    }
  }
  names.delete('default');
  return [...names];
}

describe('App Router special-file exports match Next.js allowlist (mirrors `next build`)', () => {
  const files = walk(APP_DIR).filter((f) => SPECIAL_FILES.has(basename(f).replace(/\.(ts|tsx)$/, '')));

  it('finds the special files it is meant to guard', () => {
    // Sanity: if this ever hits 0 the glob/walk broke and the guard is asleep.
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const kind = basename(file).replace(/\.(ts|tsx)$/, '');
    const rel = relative(APP_DIR, file);
    it(`${rel} exports only ${kind}-legal fields`, () => {
      const allowed = new Set(ALLOWED[kind]);
      const offenders = namedExports(readFileSync(file, 'utf8')).filter((n) => !allowed.has(n));
      expect(
        offenders,
        `${rel} has named export(s) [${offenders.join(', ')}] that Next.js rejects for a "${kind}" file at build time. ` +
          `Move them into a sibling module (e.g. ./nav-items.ts) and import them back.`,
      ).toEqual([]);
    });
  }
});

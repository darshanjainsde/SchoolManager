import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Next only permits a specific set of exports from a page/layout/route file.
 * A stray named export — a helper component, a constant — compiles clean,
 * lints clean, unit-tests clean, and then fails `next build` with
 * "does not match the required types of a Next.js Page".
 *
 * That is not hypothetical here: this exact mistake was made while building
 * the circulation desk (an `export function DueRing` beside the page's default
 * export), and neither `tsc --noEmit` nor `next lint` caught it. The sibling
 * Sckools app carries the same guard for the same reason — its own
 * scripts/preflight.sh header records two Vercel build failures from this
 * class.
 *
 * The fix is always the same: move the helper into components/ or lib/.
 */

const APP_DIR = join(__dirname);
const ROUTE_FILES = /^(page|layout|template|error|loading|not-found|route|default)\.tsx?$/;

/** Exports Next itself defines for a route file. Anything else is a build failure. */
const ALLOWED = new Set([
  'default',
  'metadata',
  'generateMetadata',
  'viewport',
  'generateViewport',
  'generateStaticParams',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'alt',
  'size',
  'contentType',
  // Route handlers.
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (ROUTE_FILES.test(entry)) out.push(full);
  }
  return out;
}

describe('route files export only what Next allows', () => {
  const files = walk(APP_DIR);

  it('finds route files to check — a zero-file pass would be vacuous', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.slice(APP_DIR.length + 1);
    it(`${rel} has no stray named export`, () => {
      const src = readFileSync(file, 'utf8');
      const named: string[] = [];

      // `export function X` / `export async function X` / `export class X`
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm)) {
        named.push(m[1]);
      }
      // `export const X` / `export let X`
      for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+(\w+)/gm)) {
        named.push(m[1]);
      }

      const stray = named.filter((n) => !ALLOWED.has(n));
      expect(stray, `move ${stray.join(', ')} into components/ or lib/ — Next rejects it from a route file`).toEqual([]);
    });
  }
});

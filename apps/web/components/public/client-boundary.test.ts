import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * A server component may not CALL a function that lives in a 'use client' file.
 *
 * In the RSC graph every export of a client module becomes a client reference —
 * not just the component. So this throws at runtime:
 *
 *   Attempted to call heroIsPhotoLayout() from the server but
 *   heroIsPhotoLayout is on the client.
 *
 * It took down every school site on staging, and FOUR separate gates missed it:
 *
 *   - tsc is happy; the types are identical either side of the boundary;
 *   - eslint has no rule for it here;
 *   - the differential render harness uses renderToStaticMarkup in plain node,
 *     which has no server/client boundary to violate — it rendered 73 of 73
 *     pages byte-identical while this was broken;
 *   - `next build` passed, because /s/[host] has an empty generateStaticParams,
 *     so no page is rendered at build time and the failure waits for a request.
 *
 * Only a real request found it. This test is the gate that should have.
 *
 * The rule: if a module has no 'use client' of its own, it may import from a
 * client module ONLY the default export or a Component-cased name (a component
 * can be rendered across the boundary; a function cannot). Pure helpers belong
 * in a module with no directive — see sections/hero-model.ts.
 */
const ROOT = join(__dirname, '..', '..'); // apps/web
const SCAN = ['components', 'app'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const isClient = (src: string) => /^\s*(['"])use client\1/.test(src.split('\n').slice(0, 3).join('\n'));

function resolveLocal(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base + '.tsx', base + '.ts', join(base, 'index.tsx'), join(base, 'index.ts')]) {
    try {
      if (statSync(c).isFile()) return c;
    } catch { /* not this one */ }
  }
  return null;
}

/** `import Default, { a, b as c, type T } from '...'` → the NAMED value bindings. */
function namedValueImports(stmt: string): string[] {
  const braces = stmt.match(/\{([^}]*)\}/);
  if (!braces) return [];
  return braces[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('type '))
    .map((s) => s.split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

describe('server components never call into a client module', () => {
  it('no non-client file imports a named helper from a "use client" file', () => {
    const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
    const clientCache = new Map<string, boolean>();
    const isClientFile = (f: string) => {
      if (!clientCache.has(f)) {
        try { clientCache.set(f, isClient(readFileSync(f, 'utf8'))); }
        catch { clientCache.set(f, false); }
      }
      return clientCache.get(f)!;
    };

    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (isClient(src)) continue; // a client file may import anything

      for (const m of src.matchAll(/^import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"];?$/gm)) {
        const [stmt, , spec] = [m[0], m[1], m[2]];
        if (/^import\s+type\b/.test(stmt)) continue;
        const target = resolveLocal(spec, file);
        if (!target || !isClientFile(target)) continue;

        for (const name of namedValueImports(stmt)) {
          // A Component-cased name can be rendered across the boundary.
          // A lowercase name is a function or a value, and calling it throws.
          if (/^[A-Z]/.test(name)) continue;
          offenders.push(
            `${file.slice(ROOT.length + 1)} imports { ${name} } from a 'use client' module (${spec}) — ` +
              `move it to a module with no directive`,
          );
        }
      }
    }
    expect(offenders, `client-boundary violations:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the scan actually reaches the files it is meant to guard', () => {
    // Without this the test above passes vacuously if the walk ever breaks.
    const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
    expect(files.some((f) => basename(f) === 'PublicSite.tsx')).toBe(true);
    expect(files.length).toBeGreaterThan(200);
  });
});

// @vitest-environment node
//
// EVERY tenant-scoped query in the admin console must wait for the host.
//
// `useHost()` reads `window.location.host` in an effect, so it is `undefined`
// on the first render. A `useQuery` that fires anyway sends no Host header, the
// API cannot resolve the tenant, and the resulting 401 goes down the ApiClient's
// refresh path — which, failing for the same reason, calls `clear()`. The admin
// is signed out the instant they open the tab.
//
// That shipped once, on /app/exam-hall. It is invisible in every gate the repo
// has: it type-checks, it lints, it builds, and it renders fine in a test where
// the host is already known. The only thing that catches it is this — a check
// that the convention the other fourteen pages already follow is followed by
// all of them.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_DIR = resolve(process.cwd(), 'app/app');

/** Every page.tsx and its sibling components under app/app. */
function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsxFilesUnder(full));
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Splits a source file into its `useQuery({ ... })` call bodies.
 *
 * NOT named `use…`: eslint's react-hooks/rules-of-hooks keys off the prefix and
 * fails the build for calling "a hook" inside a loop.
 *
 * Brace-counted rather than regex-matched: a query body routinely contains
 * nested objects and arrow functions, and a lazy `.*?}` stops at the first
 * inner brace and silently reads a fragment — which would let a genuinely
 * unguarded query pass.
 */
function queryCallBodies(src: string): string[] {
  const bodies: string[] = [];
  const marker = 'useQuery({';
  let from = 0;
  for (;;) {
    const start = src.indexOf(marker, from);
    if (start < 0) break;
    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    bodies.push(src.slice(start, i + 1));
    from = i + 1;
  }
  return bodies;
}

/** A query that talks to the tenant API — the ones that need the host. */
function isTenantScoped(body: string): boolean {
  return /api\.(get|post|put|del|patch)/.test(body);
}

const files = tsxFilesUnder(APP_DIR);

describe('admin console queries wait for the host', () => {
  it('finds the console pages at all — a silent empty sweep would pass forever', () => {
    expect(files.length).toBeGreaterThan(10);
    const withQueries = files.filter((f) => queryCallBodies(readFileSync(f, 'utf8')).length > 0);
    expect(withQueries.length).toBeGreaterThan(10);
  });

  it('guards every tenant-scoped query with enabled: !!host', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const body of queryCallBodies(src)) {
        if (!isTenantScoped(body)) continue;
        if (/enabled:\s*!!host/.test(body)) continue;
        // Some pages compose the flag (`enabled: !!host && somethingElse`).
        if (/enabled:[^,]*\bhost\b/.test(body)) continue;
        const key = body.match(/queryKey:\s*(\[[^\]]*\])/)?.[1] ?? body.slice(0, 60);
        offenders.push(`${file.replace(APP_DIR, 'app/app')} → ${key}`);
      }
    }
    expect(offenders, `these queries fire before useHost() resolves and will sign the user out:\n${offenders.join('\n')}`).toEqual([]);
  });
});

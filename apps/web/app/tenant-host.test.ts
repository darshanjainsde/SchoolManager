// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Every authenticated screen must tell the API which school is asking.
 *
 * `useApi()` with no arguments builds a client with no `hostHeader`, so its
 * requests carry no `X-Skoolos-Host` and the API cannot resolve the tenant.
 * There is no error that says so — the calls simply fail, while the very same
 * URL succeeds from anything that does send the header.
 *
 * That is what shipped on the library counter. `layout.tsx` passed the host and
 * gated its own query on it, so the librarian signed in and reached her
 * counter; `page.tsx` called bare `useApi()`, so not one panel could load. It
 * read as "the library is down" for a whole session, and the endpoints were
 * returning 200 the entire time.
 *
 * The mistake is invisible at the call site — `useApi()` looks like a complete
 * expression — so it is caught here instead. Source is read as TEXT: these are
 * client components that cannot be imported outside a Next build, and the unit
 * tests for these pages mock `useApi` wholesale, which is precisely why they
 * could never have caught this.
 */
const appDir = resolve(process.cwd(), 'app');

/**
 * Top-level segments that hold a session — the same definition
 * `console-segments.test.ts` uses: their layout runs `useSessionProbe`.
 */
function sessionSegments(): string[] {
  return readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('('))
    .filter((e) => {
      const layout = join(appDir, e.name, 'layout.tsx');
      try {
        return readFileSync(layout, 'utf8').includes('useSessionProbe');
      } catch {
        return false;
      }
    })
    .map((e) => e.name);
}

/** Every .tsx under a directory, recursively. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(full);
  }
  return out;
}

describe('authenticated screens send the tenant host', () => {
  const segments = sessionSegments();

  it('finds the console segments to check', () => {
    // A silently-empty scan would make the assertion below vacuously true.
    expect(segments.length).toBeGreaterThan(3);
  });

  it('never calls useApi() with no arguments', () => {
    const offenders: string[] = [];
    for (const segment of segments) {
      for (const file of tsxFiles(join(appDir, segment))) {
        // Comments are stripped first: the fix for this very bug documents
        // itself by naming `useApi()` in prose, and a guard that flags its own
        // explanation trains people to ignore it.
        const src = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .filter((l) => !l.trim().startsWith('//'))
          .join('\n');
        // Bare `useApi()` — no hostHeader can possibly be passed.
        if (/useApi\(\s*\)/.test(src)) {
          offenders.push(file.slice(appDir.length + 1));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every library section passes both audience and host', () => {
    // The specific regression, which was on the library counter. It used to be
    // checked by reading `library/page.tsx`, because that is where the call
    // was. The library is a tab of the console now: the six sections live in
    // `app/app/library/*-tab.tsx` and BOTH shells — the console at
    // /app/library and the librarian's portal at /library — render those same
    // components, so that one file no longer calls useApi at all and reading
    // it would have made this assertion vacuous.
    //
    // Checking all six instead of one is deliberate: the sections are the only
    // things here that talk to the API, and a new one is exactly the case that
    // would slip through.
    const sectionDir = join(appDir, 'app/library');
    const sections = readdirSync(sectionDir).filter((f) => f.endsWith('-tab.tsx'));
    expect(sections.length).toBe(6);

    for (const file of sections) {
      const src = readFileSync(join(sectionDir, file), 'utf8');
      expect(src, `${file} does not call useApi at all`).toMatch(/useApi\(\{/);
      expect(src, `${file} calls useApi without hostHeader`).toMatch(/useApi\(\{[^}]*hostHeader/);
      expect(src, `${file} calls useApi without audience`).toMatch(/useApi\(\{[^}]*audience/);
    }
  });
});

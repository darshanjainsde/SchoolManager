import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A console must never prerender a blank page again.
 *
 * Every console layout used to `return null` until React had hydrated AND the
 * boot probe had answered. The prerendered HTML for /app, /portal, /teacher and
 * the rest therefore held a <body> tag and 249 bytes, with no visible text at
 * all — correct, fast to serve, and blank for about 870 ms while the JavaScript
 * loaded and a round trip to Mumbai came back. Nothing in the suite noticed,
 * because every test that mattered ran against a fully-mounted component.
 *
 * Two checks, because neither is sufficient alone. The source check runs
 * everywhere and names the exact file. The build check is the one that actually
 * proves it, and only runs when a production build is present.
 */
const APP = __dirname;

const CONSOLE_LAYOUTS = [
  'app/layout.tsx',
  'portal/layout.tsx',
  'teacher/layout.tsx',
  'platform/layout.tsx',
  'library/layout.tsx',
  'sports/layout.tsx',
  'staff/layout.tsx',
];

/** Pages whose prerendered HTML must carry a visible shell. */
const PRERENDERED = [
  'app.html',
  'app/students.html',
  'portal.html',
  'teacher.html',
  'teacher/attendance.html',
  'platform.html',
  'library/counter.html',
];

describe('console layouts paint a shell, never a blank page', () => {
  it.each(CONSOLE_LAYOUTS)('%s does not blank itself before hydration', (rel) => {
    const src = readFileSync(join(APP, rel), 'utf8');
    // The exact shape that caused it. `return null` is still legitimate FURTHER
    // down, for an anonymous visitor already being redirected to /login.
    expect(src).not.toMatch(/if\s*\(!hydrated\)\s*return null/);
    expect(src).toContain('ConsoleSkeleton');
  });

  it.each(CONSOLE_LAYOUTS)('%s shows the shell while the session is unknown', (rel) => {
    const src = readFileSync(join(APP, rel), 'utf8');
    // Somewhere in the file, `unknown` must lead to a skeleton rather than null.
    const unknownToNull = /status === 'unknown'[^\n]*return null/.test(src);
    expect(unknownToNull, `${rel} still blanks on an unresolved session`).toBe(false);
  });

  it('the prerendered HTML carries visible content', () => {
    const serverApp = join(APP, '..', '.next', 'server', 'app');
    if (!existsSync(serverApp)) return; // no production build here; the source checks stand.

    const thin: string[] = [];
    for (const rel of PRERENDERED) {
      const file = join(serverApp, rel);
      if (!existsSync(file)) continue;
      const html = readFileSync(file, 'utf8');
      const body = html.split('<body')[1] ?? '';
      // Scripts and styles are not content a person can see.
      const visible = body
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      // 249 bytes of body and zero visible characters was the bug.
      if (body.length < 2_000 || visible.length < 20) thin.push(`${rel} (${body.length}B body, ${visible.length} chars visible)`);
    }
    expect(thin, `these prerender blank:\n${thin.join('\n')}`).toEqual([]);
  });
});

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every authenticated console must get the hardened CSP.
 *
 * `middleware.ts` sets script-src, connect-src, frame-src, base-uri,
 * form-action and object-src, but ONLY for the paths in its matcher. Anything
 * outside falls back to the baseline in next.config.mjs, which sets nothing but
 * frame-ancestors.
 *
 * /library was added as a fourth top-level sibling to /portal, /teacher and
 * /staff and was simply not added to the matcher. The result: the one console
 * holding borrowing history — which child has which book, and who owes what —
 * ran with no connect-src, no object-src and no form-action, while every other
 * console was covered. Nobody noticed, because a missing security header
 * breaks nothing you can see.
 *
 * So the matcher is derived from the code rather than trusted: a segment whose
 * layout runs `useSessionProbe` is, by definition, one that holds a session,
 * and it must appear in the matcher. The next sibling cannot be forgotten
 * without failing this test.
 *
 * Read as TEXT — importing middleware.ts would pull next/server into a node
 * test, and the app directory is not importable outside a Next build.
 */
const webRoot = resolve(process.cwd());
const appDir = resolve(webRoot, 'app');
const middlewareSrc = readFileSync(resolve(webRoot, 'middleware.ts'), 'utf8');

/** Every file under a directory, for scanning. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return filesUnder(full);
    return /\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [full] : [];
  });
}

/**
 * Anything that means "this page holds a credential a script could read".
 *
 * `useSessionProbe` is deliberately NOT here — it marks the cookie-backed
 * consoles, which the layout check below already finds. These are the
 * JS-readable ones.
 */
const CREDENTIAL_MARKERS = [
  'sk_alumni_session',
  "Authorization', 'Bearer",
  'Authorization: `Bearer',
];

/** Comments are prose, not behaviour. /preview/page.tsx documents that it has
 *  no useSessionProbe, which matched a naive scan and made the guard flag a
 *  segment holding no session at all. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Segments that hold a JS-readable session but cannot be detected by scanning
 * their own files.
 *
 * /alumni's page.tsx holds nothing: it renders PublicSite, which renders
 * AlumniSection, which keeps `sk_alumni_session` in localStorage and sends it
 * as a bearer token to /alumni/me/*. Following imports to find that was tried
 * and reverted — PublicSite is the shared hub for every public view, so the
 * scan then flagged /academics, /connect and the rest, none of which mount the
 * alumni session. A named case with its reason beats an inference that is
 * wrong more often than it is right.
 *
 * NOTE, and it is the bigger point: localStorage is scoped to the ORIGIN, not
 * the path. The alumni session is therefore readable from any page on the
 * school's host, so listing /alumni here hardens where it is USED, not
 * everywhere it can be READ. Covering the whole tenant site, or moving that
 * session off localStorage, is the real fix.
 */
const KNOWN_SESSION_SEGMENTS = ['alumni'];

/** Top-level segments that establish a session, by cookie or by bearer token. */
function sessionSegments(): string[] {
  return readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('('))
    .filter((e) => {
      const layout = resolve(appDir, e.name, 'layout.tsx');
      if (existsSync(layout) && readFileSync(layout, 'utf8').includes('useSessionProbe')) return true;
      if (KNOWN_SESSION_SEGMENTS.includes(e.name)) return true;
      return filesUnder(resolve(appDir, e.name)).some((f) =>
        CREDENTIAL_MARKERS.some((m) => code(readFileSync(f, 'utf8')).includes(m)),
      );
    })
    .map((e) => e.name);
}

/** The path patterns listed in `export const config = { matcher: [...] }`. */
function matcherPaths(): string[] {
  const start = middlewareSrc.indexOf('matcher:');
  if (start === -1) throw new Error('matcher not found in middleware.ts');
  const body = middlewareSrc.slice(start, middlewareSrc.indexOf(']', start));
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('every authenticated console is behind the hardened CSP', () => {
  it('finds both the consoles and the matcher', () => {
    // A silently-empty parse on either side would make the real assertion
    // vacuously true — the failure mode this whole file exists to prevent.
    expect(sessionSegments().length).toBeGreaterThan(3);
    expect(matcherPaths().length).toBeGreaterThan(5);
  });

  it('lists every segment that holds a session', () => {
    const covered = matcherPaths();
    for (const segment of sessionSegments()) {
      // `/library/:path*` covers /library and everything under it.
      expect(covered).toContain(`/${segment}/:path*`);
    }
  });

  it('covers /library specifically — the one that was missed', () => {
    expect(matcherPaths()).toContain('/library/:path*');
  });

  it('still covers /login, which is not a session segment but takes credentials', () => {
    expect(matcherPaths()).toContain('/login');
  });
});

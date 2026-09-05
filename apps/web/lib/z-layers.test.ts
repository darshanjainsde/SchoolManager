import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Z } from './z-layers';

/**
 * Two rules the console's overlays live by, enforced because BOTH were broken
 * by edits that looked correct in isolation:
 *
 *  1. A modal must out-rank page chrome. The dashboard's command bar was given
 *     z-index 60 to lift its dropdown; every modal still sat at Tailwind's
 *     `z-50`, so "Record a payment" opened UNDERNEATH the search box. Nobody
 *     reading either file could have seen it.
 *
 *  2. A tenant-scoped API client must carry the host. `useApi({ audience:
 *     'school' })` without `hostHeader` sends no X-Skoolos-Host; the API
 *     answers "Tenant context required", the client reads that as a dead
 *     session, and the person is signed OUT mid-payment.
 */

const ROOT = join(__dirname, '..');
const SCAN = ['components/fees', 'components/press', 'app/app'];

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = SCAN.flatMap((d) => walk(join(ROOT, d)))
  .map((f) => [relative(ROOT, f).split(sep).join('/'), readFileSync(f, 'utf8')] as const);

describe('the console stacking ladder', () => {
  it('has modals above page chrome, viewers above modals', () => {
    expect(Z.OVERLAY).toBeGreaterThan(Z.PAGE_CHROME);
    expect(Z.VIEWER).toBeGreaterThan(Z.OVERLAY);
    expect(Z.TOAST).toBeGreaterThan(Z.VIEWER);
  });

  it('no console overlay carries a hand-written z-index', () => {
    const offenders = files.filter(([, src]) =>
      /className="[^"]*\bskosx\b[^"]*\bz-\d/.test(src)          // tailwind z on an overlay
      || /\bskosx\b[\s\S]{0,200}?zIndex:\s*\d/.test(src));      // literal number beside one
    expect(offenders.map(([f]) => f)).toEqual([]);
  });

  /**
   * The rule above keys on `skosx`, which every overlay INSIDE a page carries
   * — and the app shell's own mobile drawer does not, because that class sits
   * further up the tree. So the drawer kept a Tailwind `z-50`, landing it
   * under the command bar's PAGE_CHROME (60): opening the menu on a phone left
   * the search field floating across it.
   *
   * A full-viewport layer is exactly the thing that must never pick its own
   * number, so match on the shape that MAKES it one — `fixed` with `inset-0` —
   * instead of on a class that merely tends to travel with it.
   */
  it('no full-viewport layer picks its own z-index', () => {
    const offenders: string[] = [];
    for (const [file, src] of files) {
      for (const m of src.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1];
        if (/\bfixed\b/.test(cls) && /\binset-0\b/.test(cls) && /\bz-\d/.test(cls)) {
          offenders.push(`${file}: ${cls}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every school-audience API client carries the tenant host', () => {
    const offenders = files.filter(([, src]) =>
      /useApi\(\{\s*audience:\s*'school'\s*\}\)/.test(src)
      || /useApi\(\{\s*audience:\s*'school',\s*\}\)/.test(src));
    expect(offenders.map(([f]) => f)).toEqual([]);
  });
});

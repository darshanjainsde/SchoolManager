import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `ps-css.css` must load AFTER Tailwind, and this is what keeps it that way.
 *
 * `.ps-head` sets an ink colour that silently beat Tailwind's `.text-white` —
 * invisible headings on the dark Hall of Fame and Events bands. The fix was a
 * `.ps-head.text-white` rule, which only works because this sheet wins on
 * source order. While the stylesheet was injected as an inline <style> in the
 * body it was trivially last; as a real stylesheet the order is decided by
 * which SEGMENT imports it, so the invariant needs stating.
 *
 * Next emits a parent segment's CSS before a child's. Tailwind comes from
 * app/globals.css in the ROOT layout; ps-css.css is imported only by components
 * rendered inside child routes. That is the whole mechanism, and each half is
 * asserted below.
 */
const WEB = join(__dirname, '..', '..');
const PS_CSS = join(__dirname, 'ps-css.css');

describe('ps-css.css loads after Tailwind', () => {
  it('Tailwind is imported by the root layout', () => {
    const root = readFileSync(join(WEB, 'app', 'layout.tsx'), 'utf8');
    expect(root).toMatch(/import\s+['"]\.\/globals\.css['"]/);
    expect(readFileSync(join(WEB, 'app', 'globals.css'), 'utf8')).toMatch(/@tailwind|tailwindcss/);
  });

  it('the root layout does NOT import ps-css.css', () => {
    // A root-layout import would put it in the SAME segment as Tailwind, where
    // the order becomes import order and stops being guaranteed.
    const root = readFileSync(join(WEB, 'app', 'layout.tsx'), 'utf8');
    expect(root).not.toMatch(/ps-css/);
  });

  it('the rule that depends on the order is still present', () => {
    expect(readFileSync(PS_CSS, 'utf8')).toMatch(/\.ps-head\.text-white\s*\{/);
  });

  it('nothing injects the stylesheet as inline CSS any more', () => {
    const offenders: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === '.next') continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !e.includes('.test.')) {
          const s = readFileSync(p, 'utf8');
          if (/PS_CSS/.test(s) && /dangerouslySetInnerHTML/.test(s)) {
            offenders.push(p.slice(WEB.length + 1));
          }
        }
      }
    })(join(WEB, 'app'));
    expect(offenders).toEqual([]);
  });

  it('the built manifest keeps Tailwind ahead of ps-css', () => {
    // Only meaningful after a production build; skipped otherwise so the suite
    // stays runnable without one.
    const manifest = join(WEB, '.next', 'app-build-manifest.json');
    if (!existsSync(manifest)) return;
    const m = JSON.parse(readFileSync(manifest, 'utf8')) as { pages: Record<string, string[]> };
    const cssOf = (k: string) => (m.pages[k] ?? []).filter((f) => f.endsWith('.css'));

    const layoutCss = cssOf('/layout');
    const pageCss = cssOf('/s/[host]/page');
    if (layoutCss.length === 0 || pageCss.length === 0) return;

    const read = (f: string) => readFileSync(join(WEB, '.next', f), 'utf8');
    // Tailwind's preflight is the fingerprint; .ps-head is ps-css's.
    const tailwindInLayout = layoutCss.some((f) => read(f).includes('--tw-border-spacing-x'));
    const psInPage = pageCss.some((f) => read(f).includes('.ps-head'));
    expect(tailwindInLayout, 'Tailwind must sit in the ROOT layout segment').toBe(true);
    expect(psInPage, 'ps-css must sit in a CHILD segment, which Next emits after').toBe(true);
    // And it must not have leaked into the layout segment.
    expect(layoutCss.some((f) => read(f).includes('.ps-head'))).toBe(false);
  });
});

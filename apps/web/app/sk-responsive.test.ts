// @vitest-environment node
//
// Layouts that cannot fit a phone.
//
// Written after the Fees page was reported cut off on both edges at 390px.
// Root cause was two rules compounding, and both are guarded here:
//
//   .sk-kpis was `repeat(2, 1fr)` at EVERY width below 900px, and .sk-kpi had
//   no min-width:0. `1fr` is a MAXIMUM share, not a floor — a grid item
//   defaults to min-width:auto, so its track cannot shrink below the item's
//   min-content width. A real figure (Rs 2,25,77,600 at 27px/800) is ~190px of
//   unbreakable text, so two tracks plus the gap wanted ~391px against the
//   ~342px a 390px phone has. The page went wider than the screen.
//
// It shipped because every value the author tested was short.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const webRoot = resolve(process.cwd());
const css = readFileSync(resolve(webRoot, 'app/sk-theme.css'), 'utf8');

/** Strip comments — prose mentioning a pattern is not the pattern. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(full);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [full] : [];
  });
}

describe('grid tracks can always collapse on a phone', () => {
  // minmax(240px, 1fr) is wider than its container the moment the container is
  // under 240px — the track refuses to shrink and the page scrolls sideways.
  // min(100%, 240px) is identical on a wide screen and collapses on a narrow one.
  const BARE_MINMAX = /minmax\(\s*\d+px\s*,/g;

  it('the stylesheet never uses a bare pixel minimum', () => {
    expect(code(css).match(BARE_MINMAX) ?? []).toEqual([]);
  });

  it('no page uses a bare pixel minimum inline', () => {
    const offenders = tsxFiles(resolve(webRoot, 'app'))
      .filter((f) => {
        const src = code(readFileSync(f, 'utf8'));
        // Tailwind arbitrary values cannot contain spaces, so min() is not
        // available there; those are excluded and reviewed by breakpoint instead.
        return BARE_MINMAX.test(src) && !/grid-cols-\[/.test(src);
      })
      .map((f) => f.replace(webRoot, ''));
    expect(offenders).toEqual([]);
  });
});

describe('.sk-kpis — the grid on 19 screens', () => {
  const rule = code(css).match(/\.sk-kpis\s*\{[^}]*\}/)?.[0] ?? '';

  it('does not hard-code a column count for narrow screens', () => {
    expect(rule).not.toMatch(/repeat\(\s*2\s*,/);
    expect(rule).toContain('auto-fit');
  });

  it('lets its minimum collapse below the container', () => {
    expect(rule).toMatch(/minmax\(\s*min\(/);
  });

  it('gives the tile min-width:0, so one long number cannot widen the page', () => {
    const kpi = code(css).match(/\.sk-kpi\s*\{[^}]*\}/)?.[0] ?? '';
    expect(kpi).toMatch(/min-width:\s*0/);
  });

  it('lets the value shrink on a phone instead of setting the layout width', () => {
    const n = code(css).match(/\.sk-kpi \.n\s*\{[^}]*\}/)?.[0] ?? '';
    expect(n).toMatch(/clamp\(/);
    expect(n).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('multi-track grids wider than a phone have a narrow fallback', () => {
  // .sk-covrow's four tracks need ~550px before gaps.
  it('.sk-covrow collapses to one column', () => {
    expect(code(css)).toMatch(/@media[^{]*max-width[^{]*\{\s*\.sk-covrow\s*\{[^}]*grid-template-columns:\s*1fr/);
  });

  it('.sk-availwrap still collapses to one column', () => {
    expect(code(css)).toMatch(/@media[^{]*max-width:\s*900px[^{]*\{\s*\.sk-availwrap\s*\{[^}]*1fr/);
  });
});

describe('deliberately wide blocks stay inside a scroller', () => {
  // A block with a min-width larger than a phone is fine — as long as the
  // scrolling happens inside it and not on the whole page.
  it.each([
    ['.sk-tt-table', '.sk-tt-wrap'],
    ['.sk-eh-rows', '.sk-eh-floor'],
  ])('%s is wrapped by %s, which scrolls', (inner, wrapper) => {
    // ALL rules for the selector, not the first: .sk-eh-floor is declared
    // twice and only the later one carries the overflow.
    const rules = [...code(css).matchAll(new RegExp(`\\${wrapper}\\s*\\{[^}]*\\}`, 'g'))]
      .map((m) => m[0])
      .join('\n');
    expect(rules).not.toBe('');
    expect(rules).toMatch(/overflow-x:\s*auto/);
    expect(code(css)).toContain(inner);
  });
});

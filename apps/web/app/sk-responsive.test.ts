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

describe('a row of controls beside a name lines up down the list', () => {
  // .sk-row lays identity and controls on ONE flex line and lets both shrink.
  // The four attendance marks have the wider min-content, so the name lost:
  // ~60px, wrapping "Nitin Bhat" mid-name, while the marks folded into a 2x2
  // that began at a different x on every row.
  it('.sk-markrow becomes a two-line grid on a phone', () => {
    expect(code(css)).toMatch(
      /@media[^{]*max-width[^{]*\{\s*\.sk-markrow\s*\{[^}]*grid-template-areas/,
    );
  });

  it('the marks become equal-width columns rather than wrapping ragged', () => {
    expect(code(css)).toMatch(/\.sk-markrow\s*>\s*\.sk-markrow-marks\s*\{[^}]*repeat\(2,/);
  });

  // The media query can only win if the element does NOT carry the property
  // inline — a React `style={{ display: 'flex' }}` beats any stylesheet rule,
  // so the phone layout would silently never apply.
  it('no page sets display inline on a .sk-markrow child', () => {
    const offenders = tsxFiles(resolve(webRoot, 'app'))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        if (!src.includes('sk-markrow')) return false;
        return /className="sk-markrow[\w-]*"[^>]*style=\{\{[^}]*display:/.test(src)
          || /style=\{\{[^}]*display:[^}]*\}\}[^>]*className="sk-markrow/.test(src);
      })
      .map((f) => f.replace(webRoot + '/', ''));
    expect(offenders).toEqual([]);
  });
});


describe('a paged navigator keeps its arrows together', () => {
  // "<", the date, ">" and Today on one wrapping flex line: the date plus its
  // "This week" pill is the widest item, so ">" wrapped away from "<" and
  // Today, pushed by margin-left:auto, landed alone at the right of row two.
  it('.sk-weekbar lays the arrows either side of the date on a phone', () => {
    expect(code(css)).toMatch(
      /@media[^{]*max-width[^{]*\{\s*\.sk-weekbar\s*\{[^}]*grid-template-areas:\s*'prev label next'/,
    );
  });

  // margin-left:auto is right on one line and wrong in the grid; if it were
  // left inline on the button, the stylesheet could never take it back.
  it('Today does not carry an inline auto margin', () => {
    const src = readFileSync(resolve(webRoot, 'app/app/timetable/page.tsx'), 'utf8');
    expect(src).not.toMatch(/sk-weekbar-today[\s\S]{0,200}?marginLeft:\s*'auto'/);
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

describe('a long unbreakable word cannot widen the page', () => {
  it('the theme root allows over-long words to break', () => {
    // One address like a.very.long.name@a-long-school-domain.edu.in in a narrow
    // card would otherwise set its container's min-content width, and on a
    // phone that becomes the page's width. `break-word` acts only when the word
    // would overflow, so ordinary text and every ellipsis here are unaffected.
    const root = code(css).match(/\.skosx\s*\{[^}]*\}/)?.[0] ?? '';
    expect(root).toMatch(/overflow-wrap:\s*break-word/);
  });
});

describe('things this audit checked and found already correct', () => {
  // Recorded so the next person does not re-derive them, and so a regression
  // in any of them fails here rather than on someone's phone.
  it('the app sidebar is hidden on a phone rather than squeezing the page', () => {
    expect(code(css)).toMatch(/@media[^{]*max-width[\s\S]{0,400}?\.sk-side\s*\{[^}]*display:\s*none/);
  });

  it('every .sk-tbl in the app sits in a scrollable wrapper', () => {
    const wrap = code(css).match(/\.sk-tblwrap\s*\{[^}]*\}/)?.[0] ?? '';
    expect(wrap).toMatch(/overflow:\s*auto/);
  });

  it('.sk-pfrow wraps instead of forcing its two fixed columns', () => {
    const r = code(css).match(/\.sk-pfrow\s*\{[^}]*\}/)?.[0] ?? '';
    expect(r).toMatch(/flex-wrap:\s*wrap/);
  });

  it('no rule uses 100vw, which overflows by the scrollbar width', () => {
    expect(code(css)).not.toMatch(/\b100vw\b/);
  });
});

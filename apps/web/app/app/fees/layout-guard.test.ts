// @vitest-environment node
//
// THE FEE SCREENS MUST NOT PUT INLINE ELEMENTS WHERE BLOCKS ARE NEEDED.
//
// Both bugs this guards shipped together and were visible on first load.
//
//   1. `.sk-entity .nm` and `.meta` declare no `display` in sk-theme.css, so
//      they take the element's default. Written as <span> they share a line:
//      "Fee setupCategories, terms, class amounts, bills".
//
//   2. `.sk-input` declares no `display` and no `width`, so an <input> stays
//      inline-block at the browser's default width. A field wrapped in a plain
//      <div> therefore renders its label BESIDE a stubby input. Wrapped in a
//      flex column it stacks and stretches — which is why the fields inside
//      `.sk-card-b` were fine and the ones in bare divs were not.
//
// Neither is visible to typecheck, lint, or a render test that only asserts on
// text content — the markup is valid and the words are all present. The only
// thing that catches them is this.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const THEME = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');

const ROOTS = [resolve(process.cwd(), 'app/app/fees'), resolve(process.cwd(), 'app/portal/fees')];

function tsxUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxUnder(full));
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap(tsxUnder).map((f) => [relative(process.cwd(), f), readFileSync(f, 'utf8')] as const);

describe('fee screens keep block-level content in block-level elements', () => {
  it('finds the fee pages at all', () => {
    // Without this the two assertions below pass vacuously on an empty list —
    // the same failure mode route-coverage guards with its own count.
    expect(FILES.length).toBeGreaterThanOrEqual(5);
  });

  it('never uses a <span> for .sk-entity’s .nm or .meta', () => {
    const bad: string[] = [];
    for (const [name, src] of FILES) {
      for (const m of src.matchAll(/<span[^>]*className="(?:[^"]*\s)?(nm|meta)(?:\s[^"]*)?"/g)) {
        bad.push(`${name}: <span className="…${m[1]}…">`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('wraps every labelled field in a flex column, so the label sits above its input', () => {
    const bad: string[] = [];
    for (const [name, src] of FILES) {
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        // A field is a <label className="sk-lab"> whose PREVIOUS line opens the
        // wrapper element. `.sk-card-b` is already a column flex container, so
        // a field sitting directly in one is fine.
        if (!/<label[^>]*className="sk-lab"/.test(line)) return;
        const opener = lines[i - 1] ?? '';
        if (!/^\s*<div\b[^>]*>\s*$/.test(opener)) return;
        const ok = /flex-col/.test(opener) || /className="sk-card-b"/.test(opener);
        if (!ok) bad.push(`${name}:${i + 1} — label's wrapper is not a flex column: ${opener.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  // A CSS custom property that does not exist is not a compile error, not a
  // lint error, and not a render error — the declaration is simply dropped and
  // the element inherits. `color: var(--sk-acc)` looked right in the source and
  // shipped receipt links in body ink. sk-theme.css has --sk-brand-2; it has
  // never had --sk-acc.
  it('only uses --sk-* custom properties that sk-theme.css actually defines', () => {
    const defined = new Set(
      [...THEME.matchAll(/(--sk-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    // Proves the extractor works — an empty set would make the assertion below
    // pass vacuously no matter how many bogus names the screens used.
    expect(defined.size).toBeGreaterThan(20);
    expect(defined.has('--sk-brand-2')).toBe(true);

    // Only a BARE var() is a bug. `var(--sk-amber-line, var(--sk-line))` names
    // a token that does not exist on purpose — the fallback is the value, and
    // setup/page.tsx uses that form deliberately in two places. A var() with no
    // fallback is the one that silently drops the whole declaration.
    const bad: string[] = [];
    for (const [name, src] of FILES) {
      for (const m of src.matchAll(/var\(\s*(--sk-[a-z0-9-]+)\s*\)/g)) {
        if (!defined.has(m[1])) bad.push(`${name}: var(${m[1]}) is not defined in sk-theme.css and has no fallback`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

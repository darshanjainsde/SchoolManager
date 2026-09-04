// @vitest-environment node
//
// This suite reads the stylesheet off disk and asserts on its text; it never
// touches the DOM. Under the default jsdom environment `import.meta.url` is
// not a file: URL, so resolving a sibling path from it throws at import time.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs with cwd at the package root (apps/web).
const css = readFileSync(resolve(process.cwd(), 'app/sk-theme.css'), 'utf8');

/** The light-scheme `.skosx` block — everything before the dark media query. */
const light = css.slice(0, css.indexOf('prefers-color-scheme: dark'));
/** The dark-scheme override block. */
const dark = css.slice(css.indexOf('prefers-color-scheme: dark'));

/** Reads a custom property's value from the first block that declares it. */
function tokenValue(name: string, from: string): string | null {
  const m = from.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

describe('sk-theme palette', () => {
  it('uses the Sckools indigo as the brand colour', () => {
    expect(tokenValue('--sk-brand', light)).toBe('#4f46e5');
  });

  it('uses the Sckools amber as the accent', () => {
    expect(tokenValue('--sk-amber', light)).toBe('#f59e0b');
  });

  it('no longer contains either old forest-green brand value', () => {
    // Guards the actual regression: a partial find-and-replace that leaves one
    // of the two green brand tokens behind, which reads as a colour bug only
    // on whichever component happened to use the survivor.
    expect(css.toLowerCase()).not.toContain('#134d3b');
    expect(css.toLowerCase()).not.toContain('#1c6c52');
    expect(css.toLowerCase()).not.toContain('#3faf8c');
    expect(css.toLowerCase()).not.toContain('#5cc4a3');
  });

  it('defines a distinct dark-scheme brand, not a copy of the light one', () => {
    const lightBrand = tokenValue('--sk-brand', light);
    const darkBrand = tokenValue('--sk-brand', dark);
    expect(darkBrand).toBeTruthy();
    expect(darkBrand).not.toBe(lightBrand);
  });

  it('keeps semantic state colours off the brand hue in both schemes', () => {
    // good/bad/late encode attendance and result state. If any collapses into
    // the accent, a present/absent pill stops reading as status at a glance.
    for (const scheme of [light, dark]) {
      const brand = tokenValue('--sk-brand', scheme);
      expect(tokenValue('--sk-good', scheme)).not.toBe(brand);
      expect(tokenValue('--sk-bad', scheme)).not.toBe(brand);
      expect(tokenValue('--sk-late', scheme)).not.toBe(brand);
    }
  });

  it('declares every brand and accent token in both schemes', () => {
    // A token present in light but missing from dark silently inherits the
    // light value, which is the classic half-themed bug.
    for (const name of ['--sk-brand', '--sk-brand-2', '--sk-brand-tint', '--sk-amber', '--sk-amber-tint']) {
      expect(tokenValue(name, light), `${name} missing from light scheme`).toBeTruthy();
      expect(tokenValue(name, dark), `${name} missing from dark scheme`).toBeTruthy();
    }
  });

  it('gives the explicit theme-toggle blocks the same brand as the OS-preference blocks', () => {
    // The toggle stamps data-theme on <html> and re-declares every token,
    // because they live on .skosx rather than :root. That block is easy to
    // miss when repainting: the portal looks right until a user hits the
    // toggle, and then the whole chrome reverts to the old palette.
    const toggleLight = css.slice(css.indexOf("html[data-theme='light']"), css.indexOf("html[data-theme='dark']"));
    const toggleDark = css.slice(css.indexOf("html[data-theme='dark']"));

    expect(tokenValue('--sk-brand', toggleLight)).toBe(tokenValue('--sk-brand', light));
    expect(tokenValue('--sk-amber', toggleLight)).toBe(tokenValue('--sk-amber', light));
    expect(tokenValue('--sk-brand', toggleDark)).toBe(tokenValue('--sk-brand', dark));
    expect(tokenValue('--sk-amber', toggleDark)).toBe(tokenValue('--sk-amber', dark));
  });

  it('keeps every colour token as a parseable hex value', () => {
    // Catches a truncated edit like `--sk-brand: #4f46e` that CSS would
    // silently drop, falling back to an inherited or initial colour.
    const decls = [...light.matchAll(/(--sk-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]+)\s*;/g)];
    expect(decls.length).toBeGreaterThan(8);
    for (const [, name, value] of decls) {
      expect(value, `${name} is not a 3- or 6-digit hex`).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    }
  });
});

/**
 * THE CASCADE-ORDER GUARD.
 *
 * `.sk-mobile-topbar` declared `display: none` AFTER the `@media (max-width:
 * 640px)` block that set `display: flex`. Same specificity, later wins — so
 * the bar was hidden at EVERY width, and the hamburger inside it never
 * appeared on a phone. Nothing caught it: the rule existed, the media query
 * existed, and every test passed. Only the order was wrong, and order is
 * invisible unless you look for it.
 *
 * For any selector whose visibility a media query is supposed to flip, the
 * unconditional rule must come FIRST.
 */
describe('cascade order — a media query must not be overridden by a later base rule', () => {
  // Same resolution the file already uses at the top — `__dirname` is not
  // available under this test environment.

  const FLIPPED = ['.sk-mobile-topbar', '.sk-mobile-menu-btn'];

  it.each(FLIPPED)('%s sets its base display BEFORE the media query that overrides it', (sel) => {
    // Last unconditional `display` declaration for this selector...
    const base = [...css.matchAll(new RegExp(`^\\${sel}\\s*\\{[^}]*display\\s*:`, 'gm'))].pop();
    // ...versus the media-query one that is meant to win on a phone.
    const inMedia = [
      ...css.matchAll(
        new RegExp(`@media[^{]*max-width[^{]*\\{[^@]*?\\${sel}\\s*\\{[^}]*display\\s*:`, 'gs'),
      ),
    ].pop();

    expect(base, `${sel} declares no unconditional display`).toBeTruthy();
    expect(inMedia, `${sel} is never flipped by a media query`).toBeTruthy();
    expect(
      (base as RegExpMatchArray).index,
      `${sel}'s plain rule sits AFTER the media query, so it wins at every width and the ` +
        'media query does nothing. Move the unconditional rule above it.',
    ).toBeLessThan((inMedia as RegExpMatchArray).index as number);
  });
});

describe('every custom property the stylesheet uses is one it also defines', () => {
  // Paid for while adding the owner-console family: --sk-muted, --sk-wash and
  // --sk-display were all written from memory of the palette. None exist. CSS
  // does not complain about an unresolvable var() — it drops the declaration
  // and the element renders unstyled, which reads as a layout bug three files
  // away from the typo. The real names were --sk-ink-3, --sk-bg-2, --sk-serif.
  const declared = new Set(
    [...css.matchAll(/(--sk-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
  );
  // Only bare uses. `var(--x, #fff)` carries its own answer and is a choice,
  // not a typo — sk-theme.css:895 does exactly that on purpose.
  const used = [...css.matchAll(/var\(\s*(--sk-[a-z0-9-]+)\s*\)/g)].map((m) => m[1]);

  it('declares at least the palette the file is built on', () => {
    expect(declared.size).toBeGreaterThan(20);
    expect(used.length).toBeGreaterThan(50);
  });

  it('never references a token it does not declare', () => {
    // A var() with its own fallback is fine; these are the bare ones.
    const undeclared = [...new Set(used)].filter((v) => !declared.has(v));
    expect(undeclared).toEqual([]);
  });
});

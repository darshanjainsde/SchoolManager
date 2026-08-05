import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * MOTION IS THE SCHOOL'S DECISION, AND THE VISITOR'S.
 *
 * The ambient layer on /connect is decoration: two blurred divs drifting behind
 * the header. Decoration is exactly the kind of thing that ships obeying nobody
 * — it is not a component anyone renders in a test, so an animation added here
 * survives every unit test in the suite while ignoring both the school's own
 * `animationLevel: NONE` and a visitor who asked their OS for less motion.
 *
 * These read the stylesheet rather than a rendered DOM on purpose: jsdom has no
 * cascade, so a render test cannot see whether the escape hatch exists at all.
 */
const CSS = readFileSync(join(__dirname, 'ps-css.ts'), 'utf8');

describe('the customisation axes obey the motion switches', () => {
  it('settles the DRAW gesture instead of leaving a section half-uncovered', () => {
    // A clip-path reveal that never runs would hide the section forever. Under
    // either escape it must land at fully-shown, not at its start frame.
    expect(CSS).toMatch(/\.ps-motion-off \.ps-gesture-draw \.reveal[^}]*clip-path:\s*none/);
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.ps-gesture-draw \.reveal\s*\{[^}]*clip-path:\s*none/);
  });

  it('settles the escaped headline motif at drawn, not at nothing', () => {
    expect(CSS).toMatch(/\.ps-motion-off \.ps-accent-mark::after[^}]*transform:\s*scaleX\(1\)/);
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.ps-accent-mark::after\s*\{[^}]*transform:\s*scaleX\(1\)/);
  });

  it('draws every texture from the school’s own colour, never a fixed grey', () => {
    for (const cls of ['ps-texture-grid', 'ps-texture-dots', 'ps-texture-paper']) {
      const rule = CSS.slice(CSS.indexOf(`.${cls}`), CSS.indexOf(`.${cls}`) + 400);
      expect(rule).toMatch(/var\(--ps[12]\)/);
    }
  });
});

describe('the ambient background', () => {
  it('is drawn with plain blurred divs — no canvas, no library', () => {
    expect(CSS).toContain('.ps-amb');
    expect(CSS).toMatch(/\.ps-amb\s*\{[^}]*filter:\s*blur/);
  });

  it('wears the school’s own two brand colours, not a hardcoded pair', () => {
    expect(CSS).toMatch(/\.ps-amb-1\s*\{[^}]*background:\s*var\(--ps1\)/);
    expect(CSS).toMatch(/\.ps-amb-2\s*\{[^}]*background:\s*var\(--ps2\)/);
  });

  it('stops dead for a school that set its motion level to NONE', () => {
    // `.ps-motion-off` is put on the root when animationLevel === NONE.
    expect(CSS).toMatch(/\.ps-motion-off\s+\.ps-amb\s*\{\s*animation:\s*none/);
  });

  it('stops dead for a visitor whose OS asked for reduced motion', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.ps-amb\s*\{\s*animation:\s*none/);
  });
});

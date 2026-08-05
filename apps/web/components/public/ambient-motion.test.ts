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
const CSS = readFileSync(join(__dirname, 'PublicSite.tsx'), 'utf8');

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

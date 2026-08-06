import { palette } from '../tokens';
import { brandedLight, contrastRatio, readableFill } from '../school-brand';

/**
 * A SCHOOL'S COLOUR MUST NOT COST US A READABLE REGISTER.
 *
 * Wearing the school's brand is worth something. It is not worth a button
 * nobody can read, and it is certainly not worth "present" turning red because
 * a school picked a red brand.
 */
const base = palette.light;

describe('keeping the fill readable', () => {
  it.each([
    ['#FDE047', 'a pale yellow'],
    ['#A7F3D0', 'a pale mint'],
    ['#FFFFFF', 'white itself'],
  ])('darkens %s (%s) until white text on it clears AA', (brand) => {
    expect(contrastRatio(readableFill(brand), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves a colour that is already dark enough alone', () => {
    const deep = '#134D3B';
    expect(readableFill(deep)).toBe(deep);
  });

  it('keeps the school’s hue while it darkens — it is their colour, dimmed', () => {
    // A yellow brand must not come back green or grey.
    const out = readableFill('#FDE047');
    const [r, g, b] = [out.slice(1, 3), out.slice(3, 5), out.slice(5, 7)].map((h) => parseInt(h, 16));
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
});

describe('what the brand is allowed to touch', () => {
  const branded = brandedLight(base, '#134D3B');

  it('takes over the accent the app draws its chrome in', () => {
    expect(branded.indigo).not.toBe(base.indigo);
  });

  it('NEVER moves a semantic colour — present, absent and late still mean what they mean', () => {
    for (const key of ['green', 'green50', 'red', 'red50', 'amber', 'amber50'] as const) {
      expect(branded[key]).toBe(base[key]);
    }
  });

  it('leaves the paper and the ink alone, so the light theme is still paper', () => {
    for (const key of ['appBg', 'surface', 'surfaceMuted', 'line', 'ink'] as const) {
      expect(branded[key]).toBe(base[key]);
    }
  });

  it('derives the tint from the app’s own background, so it belongs to this palette', () => {
    expect(branded.indigo50).not.toBe(base.indigo50);
    expect(contrastRatio(branded.indigo50, base.ink)).toBeGreaterThan(4.5);
  });
});

describe('when the school has told us nothing useful', () => {
  it.each([[null], [undefined], ['not-a-colour'], ['']])('falls back to the base palette for %s', (bad) => {
    expect(brandedLight(base, bad as string | null)).toBe(base);
  });
});

describe('a school with a red brand', () => {
  it('leaves the register saying what it said before', () => {
    // The accent becomes red-ish; the colours that MEAN something do not move,
    // which is the whole protection. (Deliberately not asserted with a contrast
    // ratio: WCAG contrast is a luminance measure, and green and red sit at
    // almost identical luminance — it would fail against a healthy palette.)
    const branded = brandedLight(base, '#C4453F');
    expect(branded.green).toBe(base.green);
    expect(branded.red).toBe(base.red);
    expect(branded.amber).toBe(base.amber);
  });

  it('lets a green-branded school keep its green, collision and all', () => {
    // DECIDED, not overlooked. A school whose brand happens to equal our
    // semantic green gets chrome the same colour as a "present" pill. Nudging
    // their brand to avoid that would be the app overruling a school's own
    // identity to protect a distinction the LABEL and POSITION already make —
    // a status pill sits in a register row and says the word. Fidelity to the
    // school wins; the semantic colours themselves are what must never move.
    const branded = brandedLight(base, base.green);
    // Still recognisably their green — only darkened enough for white text to
    // clear AA, which our own semantic green (4.35:1) does not quite manage.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(branded.indigo.slice(i, i + 2), 16));
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(contrastRatio(branded.indigo, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    // And the colour that MEANS present is untouched.
    expect(branded.green).toBe(base.green);
  });
});

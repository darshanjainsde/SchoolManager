import { ACCENT_NAMES, readAccent, rolesFor } from '../accents';
import { contrast, nearMeaning, toOklch } from '../inklit';

/**
 * INK & LIT (user, 19 Oct 2026) — every colour a person can pick, in both
 * schemes, plus a few school brands, holds the readability floors the
 * independent colour audit set (WCAG 2 here; APCA was checked in the audit).
 */
const deltaE = (a: string, b: string) => {
  const x = toOklch(a), y = toOklch(b);
  const ax = x.C * Math.cos((x.H * Math.PI) / 180), bx = x.C * Math.sin((x.H * Math.PI) / 180);
  const ay = y.C * Math.cos((y.H * Math.PI) / 180), by = y.C * Math.sin((y.H * Math.PI) / 180);
  return 100 * Math.hypot(x.L - y.L, ax - ay, bx - by);
};

const cases = [
  ...ACCENT_NAMES.flatMap((n) => (['light', 'dark'] as const).map((s) => [n, s, null] as const)),
  ...['#E11D48', '#0EA5E9', '#16A34A', '#FACC15', '#000000', '#7C3AED'].flatMap((b) => (['light', 'dark'] as const).map((s) => ['school', s, b] as const)),
];

describe.each(cases)('%s · %s · brand %s', (name, scheme, brand) => {
  const r = rolesFor(name, scheme, brand);
  it('text on the band, the button and the open tab reads', () => {
    expect(contrast(r.onBand, r.band)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(r.fillfg, r.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(r.barOnFg, r.barOn)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(r.barOff, r.bar)).toBeGreaterThanOrEqual(3);
  });
  it('every icon clears 7:1 on its own tile', () => {
    expect(contrast(r.glyph, r.tile)).toBeGreaterThanOrEqual(7);
    expect(contrast(r.amberInk, r.amber)).toBeGreaterThanOrEqual(7);
    expect(contrast(r.greenInk, r.green)).toBeGreaterThanOrEqual(7);
  });
  it('tiles are visible on the card — never the old near-white 1.16:1', () => {
    expect(contrast(r.tile, r.card)).toBeGreaterThanOrEqual(1.3);
    expect(contrast(r.amber, r.card)).toBeGreaterThanOrEqual(1.3);
  });
  // ΔE ×100 in OKLab: the audit's collisions were 0.9–5 (mint vs the green tile); 6+ reads as a different colour.
  it('a brand tile never looks like a meaning tile', () => {
    expect(deltaE(r.tile, r.amber)).toBeGreaterThanOrEqual(6);
    expect(deltaE(r.tile, r.green)).toBeGreaterThanOrEqual(6);
    expect(deltaE(r.amber, r.green)).toBeGreaterThanOrEqual(6);
  });
  it('text, grey text, brand text and badges read on a card', () => {
    expect(contrast(r.ink, r.card)).toBeGreaterThanOrEqual(7);
    expect(contrast(r.sub, r.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(r.accentText, r.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(r.badgeFg, r.badge)).toBeGreaterThanOrEqual(4.5);
  });
});

it('light is ink: the band is the darkest thing on a light screen, and the button is the same colour', () => {
  for (const n of ACCENT_NAMES) {
    const r = rolesFor(n, 'light');
    expect(toOklch(r.band).L).toBeLessThan(0.32);
    expect(contrast(r.onBand, r.band)).toBeGreaterThanOrEqual(7);
  }
});

it('dark is lit or black: the band is bright with dark text, mid with white, or pure black', () => {
  for (const n of ACCENT_NAMES) {
    const r = rolesFor(n, 'dark');
    const L = toOklch(r.band).L;
    expect(L >= 0.8 || r.band === '#000000' || r.onBand === '#FFFFFF').toBe(true);
  }
});

it('a brand near amber or green takes solid tiles', () => {
  expect(nearMeaning(149)).toBe(true);
  expect(nearMeaning(52)).toBe(true);
  expect(nearMeaning(255)).toBe(false);
  expect(rolesFor('mehndi', 'light').glyph).toBe('#FFFFFF');
});

it('fourteen colours, and old saved choices land on their nearest palette', () => {
  expect(ACCENT_NAMES).toHaveLength(14);
  expect(readAccent('rose')).toBe('pink');
  expect(readAccent('charcoal')).toBe('graphite');
  expect(readAccent('green')).toBe('green');
  expect(readAccent('nonsense')).toBeNull();
});

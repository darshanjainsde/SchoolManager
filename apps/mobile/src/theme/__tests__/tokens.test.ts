import { palette, type ColorPalette } from '../tokens';

// Every key a ColorPalette declares, enumerated explicitly rather than
// derived from `Object.keys(palette.light)` — deriving the expected list
// from the same object being tested would let a key silently missing from
// BOTH schemes pass unnoticed. This is the regression net for the web's own
// bug class: `sk-theme.css` declares its tokens once per `@media`/
// `html[data-theme]` block, and a key added to one block and forgotten in
// the other silently falls back to whatever the browser inherits — which on
// this app would mean a component rendering the LIGHT hex value while every
// surface around it is dark.
const REQUIRED_KEYS: Array<keyof ColorPalette> = [
  'indigo',
  'indigoDark',
  'indigo50',
  'amber',
  'amberDark',
  'amber50',
  'late',
  'ink',
  'sub',
  'line',
  'green',
  'green50',
  'red',
  'red50',
  'appBg',
  'surface',
  'surfaceMuted',
  'onBrand',
  'placeholder',
];

const HEX = /^#[0-9a-fA-F]{6,8}$/;

describe('theme palette', () => {
  it('declares a dark palette', () => {
    expect(palette.dark).toBeDefined();
  });

  it.each(REQUIRED_KEYS)('has a valid hex value for "%s" in the light palette', (key) => {
    expect(palette.light[key]).toMatch(HEX);
  });

  it.each(REQUIRED_KEYS)('has a valid hex value for "%s" in the dark palette', (key) => {
    expect(palette.dark[key]).toMatch(HEX);
  });

  it('every key present in the light palette is also present in the dark palette (and vice versa)', () => {
    expect(Object.keys(palette.dark).sort()).toEqual(Object.keys(palette.light).sort());
  });

  it('the dark palette is not just the light palette in disguise — at least the core surfaces differ', () => {
    expect(palette.dark.appBg).not.toBe(palette.light.appBg);
    expect(palette.dark.surface).not.toBe(palette.light.surface);
    expect(palette.dark.ink).not.toBe(palette.light.ink);
    expect(palette.dark.indigo).not.toBe(palette.light.indigo);
  });

  describe('semantic good/bad/late stay distinct from the brand accent, in both schemes', () => {
    it.each(['light', 'dark'] as const)('%s scheme', (scheme) => {
      const p = palette[scheme];
      expect(p.green).not.toBe(p.indigo);
      expect(p.red).not.toBe(p.indigo);
      expect(p.late).not.toBe(p.indigo);
      // `late` is also distinct from the brand's warm accent (`amber`) — the
      // whole point of a separate `late` token (mirroring the web's
      // `--sk-late` vs `--sk-amber`) is that a "late" status must never
      // collapse into the accent colour even though both are warm/gold.
      expect(p.late).not.toBe(p.amber);
      // And good/bad/late are pairwise distinct from each other.
      expect(new Set([p.green, p.red, p.late]).size).toBe(3);
    });
  });

  it('onBrand flips for contrast against the lighter dark-mode indigo (mirrors the web\'s .sk-btn dark override)', () => {
    expect(palette.light.onBrand).toBe('#FFFFFF');
    expect(palette.dark.onBrand).toBe('#07130E');
  });
});

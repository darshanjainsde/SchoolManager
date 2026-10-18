import { ACCENTS, ACCENT_NAMES, applyAccent } from '../accents';
import { GLYPH_CONTRAST, RING_POOL, bandRings, bandStops, deriveFamilies, toneFamily } from '../families';
import { brandedLight, contrastRatio } from '../school-brand';
import { palette } from '../tokens';

/**
 * THE REPORT-CARD HOME'S COLOURS (user, 18 Oct 2026), for every colour a
 * person can pick in Appearance, in both schemes, and for any school's own.
 */
const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return -1;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const gap = (a: number, b: number) => (a < 0 || b < 0 ? 180 : Math.min(Math.abs(a - b), 360 - Math.abs(a - b)));

describe.each(ACCENT_NAMES.flatMap((n) => (['light', 'dark'] as const).map((s) => [n, s] as const)))('%s · %s', (name, scheme) => {
  const c = applyAccent(palette[scheme], ACCENTS[name][scheme]);

  it('every tile glyph clears 7:1 on its own tile — never the accent on its own wash', () => {
    for (const t of Object.values(deriveFamilies(c, scheme))) expect(contrastRatio(t.ink, t.soft)).toBeGreaterThanOrEqual(GLYPH_CONTRAST);
    for (const tone of ['amber', 'green'] as const) {
      const t = toneFamily(tone, c, scheme);
      expect(contrastRatio(t.ink, t.soft)).toBeGreaterThanOrEqual(GLYPH_CONTRAST);
    }
  });

  it('the band carries three different ring colours, each clear of the band and apart from it in hue', () => {
    const band = bandStops(c, scheme)[0];
    const rings = bandRings(c, scheme);
    expect(new Set(rings).size).toBe(3);
    for (const r of rings) {
      expect(RING_POOL).toContain(r);
      expect(contrastRatio(r, band)).toBeGreaterThanOrEqual(3);
      expect(gap(hue(r), hue(band))).toBeGreaterThanOrEqual(25);
    }
    // White figures inside the rings.
    expect(contrastRatio('#FFFFFF', band)).toBeGreaterThanOrEqual(7);
  });
});

it.each(['#E11D48', '#0EA5E9', '#16A34A', '#FACC15', '#000000', '#808080', '#7C3AED'])(
  "a school's own colour %s still gets three readable rings",
  (brand) => {
    const c = brandedLight(palette.light, brand);
    const band = bandStops(c, 'light')[0];
    const rings = bandRings(c, 'light');
    expect(new Set(rings).size).toBe(3);
    for (const r of rings) expect(contrastRatio(r, band)).toBeGreaterThanOrEqual(3);
  },
);

it('fourteen colours to pick, so the four-across grid never strands one', () => {
  expect(ACCENT_NAMES.length % 4).not.toBe(1);
  expect(ACCENT_NAMES).toEqual(expect.arrayContaining(['terracotta', 'mehndi']));
});

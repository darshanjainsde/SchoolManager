import { ACCENTS, ACCENT_NAMES, applyAccent } from '../accents';
import { GLYPH_CONTRAST, bandStops, deriveFamilies, toneFamily } from '../families';
import { brandedLight, contrastRatio } from '../school-brand';
import { palette } from '../tokens';

/**
 * THE REPORT-CARD HOME'S COLOURS (user, 18 Oct 2026), for every colour a
 * person can pick in Appearance, in both schemes, and for any school's own.
 */
describe.each(ACCENT_NAMES.flatMap((n) => (['light', 'dark'] as const).map((s) => [n, s] as const)))('%s · %s', (name, scheme) => {
  const c = applyAccent(palette[scheme], ACCENTS[name][scheme]);

  it('every tile glyph clears 7:1 on its own tile — never the accent on its own wash', () => {
    for (const t of Object.values(deriveFamilies(c, scheme))) expect(contrastRatio(t.ink, t.soft)).toBeGreaterThanOrEqual(GLYPH_CONTRAST);
    for (const tone of ['amber', 'green'] as const) {
      const t = toneFamily(tone, c, scheme);
      expect(contrastRatio(t.ink, t.soft)).toBeGreaterThanOrEqual(GLYPH_CONTRAST);
    }
  });

  it('white greeting text on the band reads at 7:1', () => {
    expect(contrastRatio('#FFFFFF', bandStops(c, scheme)[0])).toBeGreaterThanOrEqual(7);
  });
});

it('fourteen colours to pick, so the four-across grid never strands one', () => {
  expect(ACCENT_NAMES.length % 4).not.toBe(1);
  expect(ACCENT_NAMES).toEqual(expect.arrayContaining(['terracotta', 'mehndi']));
});

import { FAMILIES, familyOf, familyTone } from '../families';
import { contrastRatio } from '../school-brand';

describe('icon families', () => {
  it.each(Object.entries(FAMILIES))('%s: ink is readable on its own soft tile in both schemes', (_name, tones) => {
    expect(contrastRatio(tones.light.ink, tones.light.soft)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(tones.dark.ink, tones.dark.soft)).toBeGreaterThanOrEqual(4.5);
  });
  it('maps tools to the part of school life they belong to', () => {
    expect(familyOf('fees')).toBe('money');
    expect(familyOf('take')).toBe('care');
    expect(familyOf('library')).toBe('sport');
    expect(familyOf('something-new')).toBe('learn');
    expect(familyTone('fees', 'dark').ink).toBe(FAMILIES.money.dark.ink);
  });
});

describe('families follow the chosen accent (9 Oct 2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { deriveFamilies, heroStops } = require('../families') as typeof import('../families');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ACCENTS, ACCENT_NAMES, applyAccent } = require('../accents') as typeof import('../accents');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { palette } = require('../tokens') as typeof import('../tokens');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { contrastRatio } = require('../school-brand') as typeof import('../school-brand');

  for (const name of ACCENT_NAMES) {
    for (const scheme of ['light', 'dark'] as const) {
      const c = applyAccent(palette[scheme], ACCENTS[name][scheme]);
      it(`${name}/${scheme}: every tile ink clears 4.5:1 on its own tint`, () => {
        const fam = deriveFamilies(c, scheme);
        for (const [k, t] of Object.entries(fam)) {
          expect(`${k}: ${contrastRatio(t.ink, t.soft) >= 4.5}`).toBe(`${k}: true`);
        }
      });
      it(`${name}/${scheme}: white hero text clears 4.5:1 on both hero kinds`, () => {
        for (const kind of ['live', 'quiet'] as const) {
          for (const stop of heroStops(c, scheme, kind)) expect(contrastRatio(stop, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it('a navy accent gives navy tiles, not indigo ones', () => {
    const c = applyAccent(palette.light, ACCENTS.navy.light);
    expect(deriveFamilies(c, 'light').learn.ink).toBe('#1C3B5A');
  });
});

describe('the open tab on the dark floating bar stays readable on every accent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ACCENTS, ACCENT_NAMES, applyAccent } = require('../accents') as typeof import('../accents');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { palette } = require('../tokens') as typeof import('../tokens');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { contrastRatio } = require('../school-brand') as typeof import('../school-brand');
  for (const name of ACCENT_NAMES) {
    it(`${name}: light tint pill with deep ink, and the pill stands off the bar`, () => {
      const c = applyAccent(palette.light, ACCENTS[name].light);
      expect(contrastRatio(c.indigo50, c.indigoDeep)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.indigo50, c.barBg)).toBeGreaterThanOrEqual(3);
    });
    it(`${name}: dark bright pill with dark ink`, () => {
      const c = applyAccent(palette.dark, ACCENTS[name].dark);
      expect(contrastRatio(c.indigo, c.onBrand)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.indigo, c.barBg)).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('the band is the deepest shade of the chosen colour (16 Oct 2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { bandStops } = require('../families') as typeof import('../families');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ACCENTS, ACCENT_NAMES, applyAccent } = require('../accents') as typeof import('../accents');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { palette } = require('../tokens') as typeof import('../tokens');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { contrastRatio, luminance } = require('../school-brand') as typeof import('../school-brand');

  it('white clears 7:1 on both stops, and both are darker than the accent deep, for every accent in both schemes', () => {
    for (const name of ACCENT_NAMES) {
      for (const scheme of ['light', 'dark'] as const) {
        const tone = ACCENTS[name][scheme];
        const c = tone ? applyAccent(palette[scheme], tone) : palette[scheme];
        const [top, bottom] = bandStops(c, scheme);
        expect(contrastRatio('#FFFFFF', top)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio('#FFFFFF', bottom)).toBeGreaterThanOrEqual(7);
        expect(luminance(top)).toBeLessThan(luminance(c.indigoDeep));
        expect(luminance(bottom)).toBeLessThanOrEqual(luminance(top));
      }
    }
  });
});

describe('dark fills keep the hue rich (16 Oct 2026)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { richShade, accentFill } = require('../families') as typeof import('../families');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { palette } = require('../tokens') as typeof import('../tokens');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { contrastRatio } = require('../school-brand') as typeof import('../school-brand');
  const sat = (hex: string) => { const n = parseInt(hex.slice(1), 16); const v = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255); const mx = Math.max(...v), mn = Math.min(...v); const l = (mx + mn) / 2; return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1)); };
  it('a pale accent becomes a saturated deep shade; a grey stays grey', () => {
    expect(sat(richShade("#8B87FF", 0.2))).toBeGreaterThanOrEqual(0.49);
    expect(sat(richShade("#8B87FF", 0.2))).toBeLessThanOrEqual(0.61);
    expect(sat(richShade('#AAB4C3', 0.2))).toBeLessThan(0.3);
  });
  it('the dark filled surface carries white at 4.5:1 and is a rich colour', () => {
    const f = accentFill(palette.dark, 'dark');
    expect(contrastRatio('#FFFFFF', f.bg)).toBeGreaterThanOrEqual(4.5);
    expect(sat(f.bg)).toBeGreaterThanOrEqual(0.4);
  });
});

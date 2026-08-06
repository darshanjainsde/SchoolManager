import { ACCENTS, ACCENT_NAMES, applyAccent, isAccentName } from '../accents';
import { contrastRatio } from '../school-brand';
import { palette } from '../tokens';

/**
 * The accent is the one token a school also gets to set, so these tests guard
 * the seam: a person's choice must be complete, legible, and must never reach
 * anything that is not an accent.
 */
describe('the accents', () => {
  it('defaults to the school, and "the school" means no override at all', () => {
    // Not "an accent that happens to match" — literally hands back the palette
    // it was given, so brandedLight stays the only thing painting a school's
    // colour and the two can never disagree.
    expect(ACCENTS.school.light).toBeNull();
    expect(applyAccent(palette.light, ACCENTS.school.light)).toBe(palette.light);
  });

  it('moves all four accent tokens together, never just the fill', () => {
    // brandedLight replaces exactly these four (school-brand.ts). A named
    // accent that moved three would leave a school's tint behind its own text.
    const out = applyAccent(palette.light, ACCENTS.navy.light);
    expect(out.indigo).toBe('#1C3B5A');
    expect(out.indigoDeep).toBe('#132B42');
    expect(out.indigo50).toBe('#E2E9F1');
    expect(out.onBrand).toBe('#FFFFFF');
  });

  it('never touches the ink, the neutrals, or the present/absent colours', () => {
    for (const name of ACCENT_NAMES) {
      const out = applyAccent(palette.light, ACCENTS[name].light);
      expect(out.ink).toBe(palette.light.ink);
      expect(out.appBg).toBe(palette.light.appBg);
      expect(out.surface).toBe(palette.light.surface);
      expect(out.green).toBe(palette.light.green);
      expect(out.red).toBe(palette.light.red);
    }
  });

  it('keeps label text on the fill readable in light — every accent, WCAG AA', () => {
    // The whole risk of letting somebody pick: an accent they like but cannot
    // read a button on. Asserted rather than eyeballed.
    for (const name of ACCENT_NAMES.filter((n) => n !== 'school')) {
      const t = ACCENTS[name].light!;
      expect(`${name}: ${contrastRatio(t.fill, t.onFill) >= 4.5}`).toBe(`${name}: true`);
    }
  });

  it('keeps label text on the fill readable in dark too', () => {
    for (const name of ACCENT_NAMES.filter((n) => n !== 'school')) {
      const t = ACCENTS[name].dark!;
      expect(`${name}: ${contrastRatio(t.fill, t.onFill) >= 4.5}`).toBe(`${name}: true`);
    }
  });

  it('keeps the pale tint legible under ink, which is what it exists for', () => {
    // indigo50 sits BEHIND text on paper. A tint too close to the ink makes
    // every badge and pill unreadable.
    for (const name of ACCENT_NAMES.filter((n) => n !== 'school')) {
      const t = ACCENTS[name].light!;
      expect(`${name}: ${contrastRatio(t.tint, palette.light.ink) >= 4.5}`).toBe(`${name}: true`);
    }
  });

  it('gives every named accent a darker "deep" than its fill, in both schemes', () => {
    // `deep` is the pressed state. Lighter-on-press reads as a bug.
    for (const name of ACCENT_NAMES.filter((n) => n !== 'school')) {
      for (const scheme of ['light', 'dark'] as const) {
        const t = ACCENTS[name][scheme]!;
        expect(`${name}/${scheme}: ${lum(t.deep) < lum(t.fill)}`).toBe(`${name}/${scheme}: true`);
      }
    }
  });

  it('describes every option — a colour name alone does not say what it does', () => {
    for (const name of ACCENT_NAMES) {
      expect(ACCENTS[name].label.length).toBeGreaterThan(0);
      expect(ACCENTS[name].hint.length).toBeGreaterThan(0);
    }
  });

  it('recognises its own names and refuses anything else', () => {
    expect(isAccentName('school')).toBe(true);
    expect(isAccentName('navy')).toBe(true);
    expect(isAccentName('chartreuse')).toBe(false);
    expect(isAccentName(null)).toBe(false);
  });
});

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return 0.2126 * (((n >> 16) & 255) / 255) + 0.7152 * (((n >> 8) & 255) / 255) + 0.0722 * ((n & 255) / 255);
}

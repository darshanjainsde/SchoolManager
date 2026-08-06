import { palette } from '../tokens';

const light = palette.light;

/**
 * THE LIGHT THEME IS PAPER, NOT WHITE.
 *
 * This palette's own header calls it "warm paper, indigo-black ink", and every
 * value keeps that promise — appBg #FBF9F4, surfaceMuted #F3F0E7, line #E7E3D6
 * — except the one the eye lands on most. `surface` was pure #FFFFFF, so every
 * card in the app was a cold white rectangle sitting on a warm ground. That
 * single value is why the light theme "felt odd" while the dark one did not.
 *
 * Pure white is still right for `onBrand` — text on a filled indigo surface
 * wants maximum contrast, not warmth — so this checks the surfaces only.
 */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PAPER_SURFACES: (keyof typeof light)[] = ['appBg', 'surface', 'surfaceMuted', 'line'];

describe('the light scheme stays on paper', () => {
  it.each(PAPER_SURFACES)('%s is warm — red at least as strong as blue', (key) => {
    const [r, , b] = rgb(light[key] as string);
    expect(r).toBeGreaterThanOrEqual(b);
  });

  it('has no pure white surface for content to sit on', () => {
    for (const key of PAPER_SURFACES) {
      expect((light[key] as string).toUpperCase()).not.toBe('#FFFFFF');
    }
  });

  it('still lifts a card off the page, or the warmth costs us the depth', () => {
    // Whatever warmth it gains, `surface` must stay lighter than `appBg` — that
    // difference is what makes a card read as a card.
    const lum = (hex: string) => rgb(hex).reduce((a, c) => a + c, 0);
    expect(lum(light.surface)).toBeGreaterThan(lum(light.appBg));
  });

  it('keeps pure white where it belongs — on a filled brand surface', () => {
    expect(light.onBrand.toUpperCase()).toBe('#FFFFFF');
  });
});

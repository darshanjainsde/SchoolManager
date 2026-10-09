import { GROUNDS } from '../grounds';
import { palette } from '../tokens';
import { contrastRatio } from '../school-brand';

/**
 * TWO PROMISES ABOUT THE LIGHT SCHEME.
 *
 * UI v2 (2026-10-08) made "Fresh" the default: white cards on a cool page, so
 * colour belongs to the tinted tiles and the one main action. The diary paper
 * did not go away — it is the "Classic paper" ground, and it must still BE
 * paper. And the new default must be readable: the old meta grey (#8A87A0)
 * was ~3.4:1 on white, under WCAG's 4.5:1 for small text.
 */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe('Classic paper stays paper', () => {
  const paper = GROUNDS.classic.light;
  it.each(['appBg', 'surface', 'surfaceMuted', 'line'] as const)('%s is warm — red at least as strong as blue', (key) => {
    const [r, , b] = rgb(paper[key]);
    expect(r).toBeGreaterThanOrEqual(b);
  });
  it('has no pure white surface', () => {
    for (const v of Object.values(paper)) expect(v.toUpperCase()).not.toBe('#FFFFFF');
  });
});

describe('the default (Fresh) is readable', () => {
  const l = palette.light;
  it.each(['ink', 'ink2', 'sub'] as const)('%s reaches 4.5:1 on both the card and the page', (key) => {
    expect(contrastRatio(l[key], l.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(l[key], l.appBg)).toBeGreaterThanOrEqual(4.5);
  });
  it('a card still lifts off the page', () => {
    const lum = (hex: string) => rgb(hex).reduce((a, c) => a + c, 0);
    expect(lum(l.surface)).toBeGreaterThan(lum(l.appBg));
  });
  it('white stays on a filled brand surface, and clears 4.5:1 there', () => {
    expect(l.onBrand.toUpperCase()).toBe('#FFFFFF');
    expect(contrastRatio(l.onBrand, l.indigo)).toBeGreaterThanOrEqual(4.5);
  });
});

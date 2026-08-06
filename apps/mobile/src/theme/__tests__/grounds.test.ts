import { GROUNDS, GROUND_NAMES, applyGround, isGroundName } from '../grounds';
import { palette } from '../tokens';

/**
 * Grounds are a set of neutrals that move together. These tests pin the two
 * properties that make them safe: they change ONLY the neutrals, and adding
 * them restyles nobody who has not asked.
 */
describe('the grounds', () => {
  it('leaves the existing app untouched — classic IS today’s palette', () => {
    // The guarantee that shipping this feature cannot restyle an install that
    // never opts in. If someone edits tokens.ts and forgets grounds.ts, this
    // fails rather than quietly drifting.
    const { light, dark } = GROUNDS.classic;
    expect(light.appBg).toBe(palette.light.appBg);
    expect(light.surface).toBe(palette.light.surface);
    expect(light.surfaceMuted).toBe(palette.light.surfaceMuted);
    expect(light.line).toBe(palette.light.line);
    expect(dark.appBg).toBe(palette.dark.appBg);
    expect(dark.surface).toBe(palette.dark.surface);
  });

  it('never touches the accent or the semantic states', () => {
    // A pupil picking their own paper must not repaint their school's colour,
    // nor the green/red that mean present and absent.
    for (const name of GROUND_NAMES) {
      const out = applyGround(palette.light, GROUNDS[name].light);
      expect(out.indigo).toBe(palette.light.indigo);
      expect(out.green).toBe(palette.light.green);
      expect(out.red).toBe(palette.light.red);
      expect(out.ink).toBe(palette.light.ink);
    }
  });

  it('gives every ground a card lighter than its page, in light', () => {
    // A card that is not lighter than the ground it sits on stops reading as a
    // card — the exact fault that made the old light theme feel flat.
    for (const name of GROUND_NAMES) {
      const { appBg, surface } = GROUNDS[name].light;
      expect(`${name}: ${lum(surface) > lum(appBg)}`).toBe(`${name}: true`);
    }
  });

  it('gives every ground a card lighter than its page, in dark too', () => {
    for (const name of GROUND_NAMES) {
      const { appBg, surface } = GROUNDS[name].dark;
      expect(`${name}: ${lum(surface) > lum(appBg)}`).toBe(`${name}: true`);
    }
  });

  it('keeps every light ground off pure white', () => {
    // The whole reason this exists: #FFFFFF and its immediate neighbours read
    // as a screen, not as paper.
    for (const name of GROUND_NAMES) {
      const { appBg } = GROUNDS[name].light;
      expect(`${name}: ${appBg.toUpperCase()}`).not.toBe(`${name}: #FFFFFF`);
      expect(`${name} is dark enough: ${lum(appBg) < 0.985}`).toBe(`${name} is dark enough: true`);
    }
  });

  it('keeps every dark ground genuinely dark, so nothing glows in a dark room', () => {
    for (const name of GROUND_NAMES) {
      expect(`${name}: ${lum(GROUNDS[name].dark.appBg) < 0.2}`).toBe(`${name}: true`);
    }
  });

  it('separates page from card by enough to see — the fault in the old palette', () => {
    // Classic is only ~4 steps apart, which is the bug. Every ground we ADD
    // has to do better than the thing it is fixing.
    const gap = (g: { appBg: string; surface: string }) => lum(g.surface) - lum(g.appBg);
    for (const name of GROUND_NAMES.filter((n) => n !== 'classic')) {
      const g = GROUNDS[name].light;
      expect(`${name} separates more than classic: ${gap(g) > gap(GROUNDS.classic.light)}`).toBe(
        `${name} separates more than classic: true`,
      );
    }
  });

  it('recognises its own names and refuses anything else', () => {
    expect(isGroundName('cream')).toBe(true);
    expect(isGroundName('classic')).toBe(true);
    expect(isGroundName('chartreuse')).toBe(false);
    expect(isGroundName(null)).toBe(false);
    expect(isGroundName(undefined)).toBe(false);
  });
});

/** Relative luminance, 0–1. Enough to compare two neutrals of the same hue. */
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The provider half: a person's paper must reach the tokens, survive a
 * restart, and never touch anything that is not a neutral.
 */
describe('choosing a ground', () => {
  it('is applied on top of the school brand, not instead of it', () => {
    // A school's colour survives; only the neutrals move. This is the property
    // that lets the setting be personal without breaking tenant identity.
    const branded = { ...palette.light, indigo: '#B22222' };
    const out = applyGround(branded, GROUNDS.sand.light);
    expect(out.indigo).toBe('#B22222');
    expect(out.appBg).toBe(GROUNDS.sand.light.appBg);
  });

  it('changes every neutral together, never just the background', () => {
    // Swapping only appBg is what makes a palette fall apart — the hairline
    // and the card stop having the right contrast against the new page.
    const out = applyGround(palette.light, GROUNDS.blue.light);
    expect(out.appBg).toBe(GROUNDS.blue.light.appBg);
    expect(out.surface).toBe(GROUNDS.blue.light.surface);
    expect(out.surfaceMuted).toBe(GROUNDS.blue.light.surfaceMuted);
    expect(out.line).toBe(GROUNDS.blue.light.line);
    expect(out.line2).toBe(GROUNDS.blue.light.line2);
  });

  it('applying classic is a no-op on the neutrals', () => {
    const out = applyGround(palette.light, GROUNDS.classic.light);
    expect(out).toEqual(palette.light);
  });
});

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

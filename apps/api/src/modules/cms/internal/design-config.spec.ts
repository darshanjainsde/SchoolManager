import { DESIGN_CONFIG_KEYS, pickDesignConfig } from './design-config';

/**
 * pickDesignConfig is the whitelist that keeps a saved look — and a scheduled
 * overlay — to DESIGN keys only. It is what stops a draft from smuggling
 * content (contact details, the unsanitized custom-code fields, an asset id)
 * into the live profile or the public projection.
 */
describe('pickDesignConfig', () => {
  it('keeps only design keys and drops everything else', () => {
    const out = pickDesignConfig({
      brandColorPrimary: '#123456',
      scrollFeel: 'DECK',
      festiveTheme: { festival: 'DIWALI' },
      navConfig: { items: [] },
      // None of these belong to a "look":
      customHtmlBlock: '<script>alert(1)</script>',
      customSectionCss: { stats: '.x{}' },
      logoAssetId: 'asset-1',
      phone: '+91 00000',
      email: 'x@y.z',
    });
    expect(out).toEqual({
      brandColorPrimary: '#123456',
      scrollFeel: 'DECK',
      festiveTheme: { festival: 'DIWALI' },
      navConfig: { items: [] },
    });
    expect(out).not.toHaveProperty('customHtmlBlock');
    expect(out).not.toHaveProperty('customSectionCss');
    expect(out).not.toHaveProperty('logoAssetId');
    expect(out).not.toHaveProperty('phone');
  });

  it('the whitelist covers every studio design axis', () => {
    for (const key of [
      'scrollFeel', 'navDropdownAnim', 'heroMedia', 'heroVideoUrl',
      'sectionVariants', 'festiveTheme', 'footerConfig',
    ]) {
      expect(DESIGN_CONFIG_KEYS).toContain(key);
    }
    // …but never the custom-code fields (they are sanitized separately).
    expect(DESIGN_CONFIG_KEYS).not.toContain('customHtmlBlock');
    expect(DESIGN_CONFIG_KEYS).not.toContain('customSectionCss');
  });

  it('ignores undefined without inventing keys', () => {
    expect(pickDesignConfig({ brandColorPrimary: undefined, scrollFeel: 'SNAP' })).toEqual({ scrollFeel: 'SNAP' });
  });
});

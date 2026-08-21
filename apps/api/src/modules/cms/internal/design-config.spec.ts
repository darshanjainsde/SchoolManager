import { DESIGN_CONFIG_KEYS, mergeSectionVariantContent, pickDesignConfig } from './design-config';

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

/**
 * The reserved keys inside sectionVariants (__custom homepage sections and
 * their __order) are CONTENT riding in a design column. Publishing a draft or
 * overlaying a scheduled look must never delete or hide them — the live
 * profile's values always win, and a look can never smuggle its own in.
 */
describe('mergeSectionVariantContent', () => {
  it('carries the live content keys over a draft that lacks them', () => {
    const out = mergeSectionVariantContent(
      { stats: { layout: 'RINGS' } },
      { about: { layout: 'CENTER' }, __custom: [{ id: 'team', title: 'Team', blocks: [] }], __order: ['about', 'stats'] },
    );
    expect(out).toEqual({
      stats: { layout: 'RINGS' },
      __custom: [{ id: 'team', title: 'Team', blocks: [] }],
      __order: ['about', 'stats'],
    });
  });

  it('a look cannot smuggle its own content keys past the live profile', () => {
    const out = mergeSectionVariantContent(
      { stats: { layout: 'RINGS' }, __custom: [{ id: 'evil', title: 'Stale', blocks: [] }], __order: ['contact'] },
      { __custom: [{ id: 'team', title: 'Team', blocks: [] }] },
    );
    expect(out.__custom).toEqual([{ id: 'team', title: 'Team', blocks: [] }]);
    expect(out).not.toHaveProperty('__order');
    expect(out.stats).toEqual({ layout: 'RINGS' });
  });

  it('tolerates junk on either side', () => {
    expect(mergeSectionVariantContent(null, null)).toEqual({});
    expect(mergeSectionVariantContent('x', 42)).toEqual({});
    expect(mergeSectionVariantContent({ __custom: [1] }, undefined)).toEqual({});
  });
});

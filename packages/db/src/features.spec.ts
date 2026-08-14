import { resolveFeatures, TIER_FEATURES } from './features';

describe('resolveFeatures', () => {
  it('BASIC includes public site, gallery, enquiry, social; not events/management', () => {
    const f = resolveFeatures('BASIC', []);
    expect(f.has('PUBLIC_SITE')).toBe(true);
    expect(f.has('GALLERY')).toBe(true);
    expect(f.has('ENQUIRY')).toBe(true);
    expect(f.has('SOCIAL')).toBe(true);
    expect(f.has('EVENTS')).toBe(false);
    expect(f.has('MANAGEMENT')).toBe(false);
  });

  it('STANDARD adds about/contact and events', () => {
    const f = resolveFeatures('STANDARD', []);
    expect(f.has('ABOUT_CONTACT')).toBe(true);
    expect(f.has('EVENTS')).toBe(true);
    expect(f.has('MANAGEMENT')).toBe(false);
    for (const k of TIER_FEATURES.BASIC) expect(f.has(k)).toBe(true);
  });

  it('PRO adds management', () => {
    const f = resolveFeatures('PRO', []);
    expect(f.has('MANAGEMENT')).toBe(true);
    for (const k of TIER_FEATURES.STANDARD) expect(f.has(k)).toBe(true);
  });

  it('an enabled override adds a feature above the tier', () => {
    const f = resolveFeatures('BASIC', [{ featureKey: 'EVENTS', enabled: true }]);
    expect(f.has('EVENTS')).toBe(true);
  });

  it('a disabled override removes a tier feature', () => {
    const f = resolveFeatures('PRO', [{ featureKey: 'MANAGEMENT', enabled: false }]);
    expect(f.has('MANAGEMENT')).toBe(false);
  });

  it('ignores unknown override keys', () => {
    const f = resolveFeatures('BASIC', [{ featureKey: 'NOPE', enabled: true }]);
    expect(f.has('PUBLIC_SITE')).toBe(true);
    expect((f as Set<string>).has('NOPE')).toBe(false);
  });

  describe('LIBRARY is opt-in only', () => {
    it('is in NO tier by default, not even PRO', () => {
      // The claim the feature comment makes, asserted so it cannot quietly stop
      // being true. Many schools have a cupboard of books and no circulation;
      // giving them a Library tab by default makes the product look unfinished
      // and makes a real library look like a freebie rather than a choice.
      for (const tier of ['BASIC', 'STANDARD', 'PRO'] as const) {
        expect(resolveFeatures(tier, []).has('LIBRARY')).toBe(false);
      }
    });

    it('is reachable only through an explicit per-school override', () => {
      const f = resolveFeatures('PRO', [{ featureKey: 'LIBRARY', enabled: true }]);
      expect(f.has('LIBRARY')).toBe(true);
      // And it is a real key, not silently dropped like an unknown one — the
      // override path above must be able to switch it on for a BASIC school too.
      expect(resolveFeatures('BASIC', [{ featureKey: 'LIBRARY', enabled: true }]).has('LIBRARY')).toBe(true);
    });
  });
});

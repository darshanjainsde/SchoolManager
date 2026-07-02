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
  });

  it('PRO adds management', () => {
    expect(resolveFeatures('PRO', []).has('MANAGEMENT')).toBe(true);
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
});

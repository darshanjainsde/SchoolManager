import { resolveFeatures, TIER_FEATURES, tierOfFeature, type FeatureKey } from './features';

describe('resolveFeatures — the plan ladder', () => {
  it('BASIC: the website with its contact pages, the admissions desk, the network as a reader; no ERP', () => {
    const f = resolveFeatures('BASIC', []);
    for (const k of ['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL', 'ABOUT_CONTACT', 'EVENTS'] as const) expect(f.has(k)).toBe(true);
    expect(f.has('EVENTS_HOST')).toBe(false);
    expect(f.has('MANAGEMENT')).toBe(false);
    expect(f.has('BLOG')).toBe(false);
  });

  it('STANDARD: everything in Basic, plus the ERP, hosting events and the blog; no money or specialist desks', () => {
    const f = resolveFeatures('STANDARD', []);
    for (const k of TIER_FEATURES.BASIC) expect(f.has(k)).toBe(true);
    expect(f.has('MANAGEMENT')).toBe(true);
    expect(f.has('EVENTS_HOST')).toBe(true);
    expect(f.has('BLOG')).toBe(true);
    for (const k of ['FEES', 'SALARY', 'LIBRARY', 'SPORTS', 'ALUMNI', 'HIRING', 'PRESS', 'COURSE_MANAGEMENT', 'EXAM_HALL', 'WHATSAPP'] as const) expect(f.has(k)).toBe(false);
  });

  it('PRO: everything in Standard, plus every remaining key — nothing is override-only any more', () => {
    const f = resolveFeatures('PRO', []);
    for (const k of TIER_FEATURES.STANDARD) expect(f.has(k)).toBe(true);
    const all: FeatureKey[] = ['PUBLIC_SITE','GALLERY','ENQUIRY','SOCIAL','ABOUT_CONTACT','EVENTS','EVENTS_HOST','MANAGEMENT','BLOG','HIRING','LIBRARY','ALUMNI','FEES','PRESS','SPORTS','SALARY','COURSE_MANAGEMENT','EXAM_HALL','WHATSAPP'];
    for (const k of all) expect(f.has(k)).toBe(true);
    expect(f.size).toBe(all.length);
  });

  it('the sets are cumulative', () => {
    for (const k of TIER_FEATURES.BASIC) expect(TIER_FEATURES.STANDARD).toContain(k);
    for (const k of TIER_FEATURES.STANDARD) expect(TIER_FEATURES.PRO).toContain(k);
  });

  it('tierOfFeature names the lowest plan that carries a key', () => {
    expect(tierOfFeature('ABOUT_CONTACT')).toBe('BASIC');
    expect(tierOfFeature('EVENTS')).toBe('BASIC');
    expect(tierOfFeature('EVENTS_HOST')).toBe('STANDARD');
    expect(tierOfFeature('MANAGEMENT')).toBe('STANDARD');
    expect(tierOfFeature('EXAM_HALL')).toBe('PRO');
    expect(tierOfFeature('WHATSAPP')).toBe('PRO');
    expect(tierOfFeature('SPORTS')).toBe('PRO');
  });

  it('an enabled override adds a feature above the tier', () => {
    const f = resolveFeatures('BASIC', [{ featureKey: 'LIBRARY', enabled: true }]);
    expect(f.has('LIBRARY')).toBe(true);
  });

  it('a disabled override removes a tier feature — how a live Pro school is protected from a new module', () => {
    const f = resolveFeatures('PRO', [{ featureKey: 'SPORTS', enabled: false }]);
    expect(f.has('SPORTS')).toBe(false);
    expect(f.has('FEES')).toBe(true);
  });

  it('ignores unknown override keys', () => {
    const f = resolveFeatures('BASIC', [{ featureKey: 'NOPE', enabled: true }]);
    expect(f.has('PUBLIC_SITE')).toBe(true);
    expect((f as Set<string>).has('NOPE')).toBe(false);
  });
});

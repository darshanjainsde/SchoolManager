import { hasFeature } from '../features';

describe('hasFeature', () => {
  it('answers from the session list', () => {
    expect(hasFeature({ features: ['FEES', 'LIBRARY'] }, 'FEES')).toBe(true);
    expect(hasFeature({ features: ['FEES'] }, 'SPORTS')).toBe(false);
  });
  it('a pre-features session, or no session, answers no — never throws', () => {
    expect(hasFeature({}, 'FEES')).toBe(false);
    expect(hasFeature(null, 'FEES')).toBe(false);
    expect(hasFeature(undefined, 'FEES')).toBe(false);
  });
});

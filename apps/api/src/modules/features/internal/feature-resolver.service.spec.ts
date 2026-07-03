import { FeatureResolverService } from './feature-resolver.service';

describe('FeatureResolverService.computeFor', () => {
  it('merges tier + overrides using the shared resolver', () => {
    const svc = new FeatureResolverService();
    const set = svc.computeFor('PRO', [{ featureKey: 'MANAGEMENT', enabled: false }]);
    expect(set.has('MANAGEMENT')).toBe(false);
    expect(set.has('EVENTS')).toBe(true);
  });
});

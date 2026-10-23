// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isSampleSchool } from './sample-schools';

describe('isSampleSchool', () => {
  it('hides the seeded sample tenants by slug', () => {
    for (const slug of ['beacon', 'acme', 'riverdale', 'demo']) expect(isSampleSchool({ slug })).toBe(true);
  });
  it('hides a tenant whose name or slug says demo/sample/test', () => {
    expect(isSampleSchool({ slug: 'sckools-demo', name: 'Sckools Demo School' })).toBe(true);
    expect(isSampleSchool({ slug: 'x', name: 'Sample High' })).toBe(true);
    expect(isSampleSchool({ slug: 'qa-test-school', name: 'QA' })).toBe(true);
  });
  it('keeps real schools, including ones whose name merely contains the letters', () => {
    expect(isSampleSchool({ slug: 'raffles', name: 'Raffles Primary School' })).toBe(false);
    expect(isSampleSchool({ slug: 'contest-academy', name: 'Contest Academy' })).toBe(false);
    expect(isSampleSchool({ slug: 'latest-public', name: 'Latest Public School' })).toBe(false);
  });
});

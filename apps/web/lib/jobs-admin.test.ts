import { describe, it, expect } from 'vitest';
import { MAX_QUESTIONS, filterableKinds, isFilterable } from './jobs-admin';

/**
 * "Every screening question becomes a filter, automatically. A question that
 * cannot become a filter is one somebody reads sixty times and acts on none of.
 * Short text is the only non-filterable type and the builder says so."
 * — docs/PHASE6.md §6
 */
describe('which questions can be filtered', () => {
  it('filters on choice, yes/no and a number', () => {
    expect(isFilterable('CHOICE')).toBe(true);
    expect(isFilterable('YES_NO')).toBe(true);
    expect(isFilterable('NUMBER')).toBe(true);
  });

  it('cannot filter free text, and that is the only exception', () => {
    expect(isFilterable('TEXT')).toBe(false);
    expect(filterableKinds).not.toContain('TEXT');
    expect(filterableKinds).toHaveLength(3);
  });

  it('caps a vacancy at four questions — the cost lands on the candidate', () => {
    expect(MAX_QUESTIONS).toBe(4);
  });
});

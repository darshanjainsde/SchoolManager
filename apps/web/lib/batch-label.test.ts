import { describe, it, expect } from 'vitest';
import { batchLabel, batchYearOptions } from './batch-label';

describe('batch labels follow the academic session', () => {
  it('prints the April-to-March session from its start year', () => {
    expect(batchLabel(2025)).toBe('2025-26');
    expect(batchLabel(2019)).toBe('2019-20');
    expect(batchLabel(1999)).toBe('1999-00');
  });

  it('offers next session first, then every earlier one down to the floor', () => {
    const ys = batchYearOptions(2026, 2024);
    expect(ys).toEqual([2027, 2026, 2025, 2024]);
  });
});

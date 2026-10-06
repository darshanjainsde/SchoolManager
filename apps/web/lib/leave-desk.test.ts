import { describe, it, expect } from 'vitest';
import { ApiError } from './api';
import { isDecidedElsewhere, isOwnLeave } from './leave-desk';

describe('leave desk rules', () => {
  it('only a 409 ApiError means "decided elsewhere"', () => {
    expect(isDecidedElsewhere(new ApiError(409, 'Already approved', null))).toBe(true);
    expect(isDecidedElsewhere(new ApiError(403, 'own', null))).toBe(false);
    expect(isDecidedElsewhere(new ApiError(500, 'boom', null))).toBe(false);
    expect(isDecidedElsewhere(new Error('409'))).toBe(false);
  });

  it('own leave needs both ids known and equal — an unknown id never hides the buttons', () => {
    expect(isOwnLeave('u1', 'u1')).toBe(true);
    expect(isOwnLeave('u1', 'u2')).toBe(false);
    expect(isOwnLeave(null, null)).toBe(false);
    expect(isOwnLeave(undefined, 'u1')).toBe(false);
    expect(isOwnLeave('u1', null)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { ApiError } from './api';
import { halfDayLabel, isDecidedElsewhere, isOwnLeave, leaveSpan } from './leave-desk';

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

  it('a half day names its half; an old one with no half says just "Half day"; a full day says nothing', () => {
    expect(halfDayLabel({ halfDay: true, halfDayPart: 'AM' })).toBe('Half day · morning');
    expect(halfDayLabel({ halfDay: true, halfDayPart: 'PM' })).toBe('Half day · afternoon');
    expect(halfDayLabel({ halfDay: true, halfDayPart: null })).toBe('Half day');
    expect(halfDayLabel({ halfDay: true })).toBe('Half day');
    expect(halfDayLabel({ halfDay: false, halfDayPart: 'AM' })).toBeNull();
    expect(halfDayLabel({})).toBeNull();
  });

  it('a half day is one date and its half; anything else is a range', () => {
    const fmt = (iso: string) => iso.slice(0, 10);
    expect(leaveSpan({ startDate: '2026-10-05', endDate: '2026-10-05', halfDay: true, halfDayPart: 'PM' }, fmt)).toBe('2026-10-05 · Half day · afternoon');
    expect(leaveSpan({ startDate: '2026-10-05', endDate: '2026-10-05', halfDay: true }, fmt)).toBe('2026-10-05 · Half day');
    expect(leaveSpan({ startDate: '2026-10-05', endDate: '2026-10-07', halfDay: false }, fmt)).toBe('2026-10-05 – 2026-10-07');
  });
});

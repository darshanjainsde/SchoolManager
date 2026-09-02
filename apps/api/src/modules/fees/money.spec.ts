import { applyBps, clampConcession, formatMinor, MoneyError } from './money';

describe('applyBps', () => {
  it('takes 10% of a round amount', () => {
    expect(applyBps(900_000, 1000)).toBe(90_000);
  });

  it('rounds half away from zero rather than to even', () => {
    // 5 paise at 50% is exactly 2.5 — banker's rounding would give 2.
    expect(applyBps(5, 5000)).toBe(3);
    expect(applyBps(15, 5000)).toBe(8);
  });

  it('rejects a percentage outside 0..100', () => {
    expect(() => applyBps(1000, 10_001)).toThrow(MoneyError);
    expect(() => applyBps(1000, -1)).toThrow(MoneyError);
  });

  it('rejects fractional paise input', () => {
    expect(() => applyBps(10.5, 1000)).toThrow(MoneyError);
  });
});

describe('clampConcession', () => {
  it('never lets a waiver exceed the line it is waiving', () => {
    expect(clampConcession(900_000, 1_000_000)).toBe(900_000);
  });

  it('treats a negative concession as none', () => {
    expect(clampConcession(900_000, -500)).toBe(0);
  });
});

describe('formatMinor', () => {
  it('groups in the Indian system', () => {
    expect(formatMinor(1_240_000)).toBe('₹12,400');
    expect(formatMinor(310_000_000)).toBe('₹31,00,000');
  });

  it('shows paise only when there are any', () => {
    expect(formatMinor(1_240_050)).toBe('₹12,400.50');
    expect(formatMinor(5)).toBe('₹0.05');
  });

  it('renders a negative amount', () => {
    expect(formatMinor(-90_000)).toBe('-₹900');
  });
});

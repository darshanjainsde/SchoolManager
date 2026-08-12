import { describe, it, expect } from 'vitest';
import { outstanding, rupees, formatRupees } from './circulation';

/**
 * The API returns money as a Prisma Decimal, which serialises to a STRING on
 * some paths and a number on others. Every one of these cases would silently
 * concatenate rather than subtract if `outstanding` skipped `rupees()` — a
 * fine of "100" minus a payment of "40" becomes "10040" under `-` only if the
 * coercion goes wrong, and shows the librarian a balance that is not owed.
 */
describe('outstanding', () => {
  it('subtracts payments and waivers from the amount', () => {
    expect(outstanding({ amount: 100, paidAmount: 40, waivedAmount: 10 })).toBe(50);
  });

  it('handles the string form the API actually sends for Decimals', () => {
    expect(outstanding({ amount: '100.00', paidAmount: '40.50', waivedAmount: null })).toBeCloseTo(59.5);
  });

  it('treats a null waiver as zero, not NaN', () => {
    expect(outstanding({ amount: '25', paidAmount: '0', waivedAmount: null })).toBe(25);
  });

  it('is zero once a fine is fully waived — the row must stop offering a waive button', () => {
    expect(outstanding({ amount: '75', paidAmount: '0', waivedAmount: '75' })).toBe(0);
  });
});

describe('rupees', () => {
  it('is zero for null and undefined rather than NaN', () => {
    expect(rupees(null)).toBe(0);
    expect(rupees(undefined)).toBe(0);
  });
});

describe('formatRupees', () => {
  it('always shows two decimals, so a column of amounts lines up', () => {
    expect(formatRupees('5')).toBe('₹5.00');
    expect(formatRupees(12.5)).toBe('₹12.50');
  });
});

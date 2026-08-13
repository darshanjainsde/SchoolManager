import { resolveReplacementPrice } from './replacement-price';

describe('resolveReplacementPrice', () => {
  it('prefers what the librarian typed for this loss over everything else', () => {
    expect(
      resolveReplacementPrice({ typed: 340, titlePrice: 299, copyAcquisitionCost: 45 }),
    ).toEqual({ amount: 340, source: 'TYPED' });
  });

  it("falls back to the title's price when nothing was typed", () => {
    expect(resolveReplacementPrice({ titlePrice: 299, copyAcquisitionCost: 45 })).toEqual({
      amount: 299,
      source: 'TITLE_PRICE',
    });
  });

  it('falls back to what the school paid, and says so, when the title has no price', () => {
    // The source is the whole point of this branch: ₹45 paid in 1998 is not
    // what a replacement costs, so the caller is obliged to show its age
    // rather than presenting it as today's number.
    expect(resolveReplacementPrice({ copyAcquisitionCost: 45 })).toEqual({
      amount: 45,
      source: 'PURCHASE_COST',
    });
  });

  it('reports UNPRICED rather than throwing when nothing resolves', () => {
    // The load-bearing assertion of this file. If this ever became a throw, a
    // school with an unpriced catalogue could not RECORD a loss — and recording
    // the loss is what freezes the child's daily late charge.
    expect(resolveReplacementPrice({})).toEqual({ amount: null, source: 'UNPRICED' });
    expect(
      resolveReplacementPrice({ typed: null, titlePrice: null, copyAcquisitionCost: null }),
    ).toEqual({ amount: null, source: 'UNPRICED' });
  });

  it('treats zero as a real, deliberate price and never as absent', () => {
    // A book written off as out of print is settled at ₹0 on purpose. `|| 0`
    // style coalescing anywhere in this chain would turn "the school decided
    // this costs nothing" into "we have no idea", and vice versa.
    expect(resolveReplacementPrice({ typed: 0, titlePrice: 299 })).toEqual({
      amount: 0,
      source: 'TYPED',
    });
    expect(resolveReplacementPrice({ titlePrice: 0, copyAcquisitionCost: 45 })).toEqual({
      amount: 0,
      source: 'TITLE_PRICE',
    });
  });

  it('skips a negative or non-finite value instead of charging it', () => {
    // `typed` arrives on a request body, not from the CHECK-constrained column,
    // so this must hold on its own rather than by trusting a validator upstream.
    expect(resolveReplacementPrice({ typed: -5, titlePrice: 299 })).toEqual({
      amount: 299,
      source: 'TITLE_PRICE',
    });
    expect(resolveReplacementPrice({ typed: Number.NaN, titlePrice: 299 })).toEqual({
      amount: 299,
      source: 'TITLE_PRICE',
    });
    expect(resolveReplacementPrice({ typed: Number.POSITIVE_INFINITY })).toEqual({
      amount: null,
      source: 'UNPRICED',
    });
  });

  it('does not let a negative title price fall through to a charge either', () => {
    expect(resolveReplacementPrice({ titlePrice: -1, copyAcquisitionCost: 45 })).toEqual({
      amount: 45,
      source: 'PURCHASE_COST',
    });
  });
});

import {
  canSeeReplacementPrice,
  forRole,
  stripReplacementPrice,
} from './replacement-price-visibility';

describe('replacement-price visibility', () => {
  it('shows the price to staff', () => {
    expect(canSeeReplacementPrice('ORG_OWNER')).toBe(true);
    expect(canSeeReplacementPrice('LIBRARIAN')).toBe(true);
    // An assistant who cannot see the price cannot help at the counter.
    expect(canSeeReplacementPrice('ASSISTANT')).toBe(true);
  });

  it('never shows the price to a MEMBER', () => {
    // The rule this protects: the only party who tells a child what they owe
    // is the library, after a librarian has confirmed the loss.
    expect(canSeeReplacementPrice('MEMBER')).toBe(false);
  });

  it('removes the key entirely rather than nulling it', () => {
    // A `replacementPrice: null` would leak that the field exists and invite a
    // client to render "not set" for a book that is in fact priced.
    const stripped = stripReplacementPrice({ id: 'a', title: 'X', replacementPrice: 299 });
    expect('replacementPrice' in stripped).toBe(false);
    expect(stripped).toEqual({ id: 'a', title: 'X' });
  });

  it('does not mutate the row it was given', () => {
    const row = { id: 'a', replacementPrice: 299 };
    stripReplacementPrice(row);
    expect(row.replacementPrice).toBe(299);
  });

  it('strips every row for a MEMBER and no row for staff', () => {
    const rows = [
      { id: 'a', replacementPrice: 299 },
      { id: 'b', replacementPrice: null },
    ];

    for (const hit of forRole('MEMBER', rows)) {
      expect('replacementPrice' in hit).toBe(false);
    }
    for (const hit of forRole('LIBRARIAN', rows)) {
      expect('replacementPrice' in hit).toBe(true);
    }
  });

  it('regression: a title with a NULL price is still stripped for a MEMBER', () => {
    // The tempting shortcut — "only strip when there is something to strip" —
    // is what would make a MEMBER response distinguishable between "priced but
    // hidden" and "genuinely unpriced".
    const [hit] = forRole('MEMBER', [{ id: 'a', replacementPrice: null }]);
    expect('replacementPrice' in hit).toBe(false);
  });
});

import { parseRupees, rupeeInput, rupees } from '../money';

describe('rupees — paise to a printed figure, Indian grouping', () => {
  it.each([
    [0, '₹0'],
    [80000, '₹800'],
    [2450000, '₹24,500'],
    [2450050, '₹24,500.50'],
    [12400000, '₹1,24,000'],
    // The lakh/crore case the ledger names: never "₹22,577,600".
    [2257760000, '₹2,25,77,600'],
    [-50000, '−₹500'],
    [5, '₹0.05'],
  ])('%i → %s', (minor, printed) => {
    expect(rupees(minor)).toBe(printed);
  });
});

describe('parseRupees — what someone types, to paise', () => {
  it.each([
    ['24500', 2450000],
    ['24,500', 2450000],
    ['24500.50', 2450050],
    ['₹ 800', 80000],
    ['', 0],
    ['abc', 0],
    ['12.345', 1235], // rounds, never truncates
  ])('%s → %i', (typed, minor) => {
    expect(parseRupees(typed)).toBe(minor);
  });
});

describe('rupeeInput — paise back into an editable figure', () => {
  it('empties a zero and keeps decimals only when there are paise', () => {
    expect(rupeeInput(0)).toBe('');
    expect(rupeeInput(12400)).toBe('124');
    expect(rupeeInput(12450)).toBe('124.5');
  });
});

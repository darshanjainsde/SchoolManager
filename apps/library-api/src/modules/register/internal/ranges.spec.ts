import { parseAccessionRanges } from './ranges';

/**
 * Sequential accession numbers are what make a scanner-free stock take
 * typeable at all: a shelf of six books is one entry. If this parser is wrong,
 * the annual verification silently marks the wrong books present, which is
 * worse than not doing it.
 */
describe('parseAccessionRanges', () => {
  it('expands an inclusive range — the whole point', () => {
    expect(parseAccessionRanges('1001-1006').numbers.sort()).toEqual([
      '1001', '1002', '1003', '1004', '1005', '1006',
    ]);
  });

  it('takes a mixture of ranges, singles and separators', () => {
    const { numbers } = parseAccessionRanges('1001-1003, 1009\n1012');
    expect(numbers.sort()).toEqual(['1001', '1002', '1003', '1009', '1012']);
  });

  it('accepts a range typed backwards — people read shelves both ways', () => {
    expect(parseAccessionRanges('1006-1004').numbers.sort()).toEqual(['1004', '1005', '1006']);
  });

  it('preserves zero padding, so 0001-0003 is not silently renumbered', () => {
    expect(parseAccessionRanges('0001-0003').numbers.sort()).toEqual(['0001', '0002', '0003']);
  });

  it('takes a legacy prefixed number as a single', () => {
    expect(parseAccessionRanges('ACC-00042').numbers).toEqual(['ACC-00042']);
  });

  it('de-duplicates overlapping entries rather than double-counting a shelf', () => {
    expect(parseAccessionRanges('1001-1003 1002 1003').numbers.sort()).toEqual([
      '1001', '1002', '1003',
    ]);
  });

  it('refuses an absurd span instead of expanding it', () => {
    // `1001-100600` is a typo, and expanding it would hang the request rather
    // than fail it. Reported verbatim so the librarian sees what to retype.
    const { numbers, unparsed } = parseAccessionRanges('1001-100600');
    expect(numbers).toEqual([]);
    expect(unparsed).toEqual(['1001-100600']);
  });

  it('reports what it could not understand, verbatim', () => {
    const { unparsed } = parseAccessionRanges('1001 what? 1002');
    expect(unparsed).toEqual(['what?']);
  });

  it('is empty for empty input rather than throwing', () => {
    expect(parseAccessionRanges('   ')).toEqual({ numbers: [], unparsed: [] });
  });
});

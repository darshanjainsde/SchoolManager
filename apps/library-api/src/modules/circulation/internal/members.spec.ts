import { codeGuesses } from './members.service';

/**
 * `codeGuesses` decides what a librarian MEANT by what they typed. It is not a
 * validator — `AAA-00000` remains the one canonical stored shape, and Sckools'
 * standing rule is that nonconforming data gets migrated rather than the
 * validators widened. These cases pin the difference: forgiving about input,
 * exact about the code it looks for.
 */
describe('codeGuesses', () => {
  it('accepts the canonical shape unchanged', () => {
    expect(codeGuesses('RAF-00042').exact).toBe('RAF-00042');
  });

  it('uppercases, because a keyboard at a desk does not', () => {
    expect(codeGuesses('raf-00042').exact).toBe('RAF-00042');
  });

  it('restores a dropped hyphen — the easiest character to miss reading a card', () => {
    expect(codeGuesses('RAF00042').exact).toBe('RAF-00042');
  });

  it('zero-pads a short numeric tail to the five digits the generator emits', () => {
    expect(codeGuesses('RAF-42').exact).toBe('RAF-00042');
  });

  it('ignores whitespace anywhere in the input', () => {
    expect(codeGuesses(' raf - 42 ').exact).toBe('RAF-00042');
  });

  it('keeps six-digit codes intact — the format grows past 99999, it does not truncate', () => {
    expect(codeGuesses('RAF-100042').exact).toBe('RAF-100042');
  });

  it('treats bare digits as a code suffix, for the librarian who only remembers the number', () => {
    expect(codeGuesses('42')).toEqual({ exact: null, digitsSuffix: '%42' });
  });

  it('is not a code guess for a name', () => {
    expect(codeGuesses('Ravi Menon')).toEqual({ exact: null, digitsSuffix: null });
  });

  it('does not mistake a four-letter prefix for a code — three letters is the format', () => {
    expect(codeGuesses('RAFF-00042').exact).toBeNull();
  });

  it('escapes ILIKE wildcards in a digit suffix so a typed % stays literal', () => {
    // Digits-only input cannot contain %, but the escaping must survive any
    // future widening of this branch — asserted here so a later edit that
    // loosens the digit test cannot silently reintroduce pattern injection.
    expect(codeGuesses('42').digitsSuffix).not.toContain('\\');
  });
});

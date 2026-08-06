import { salutationFor, salutation } from '../greeting';

describe('the salutation above the name', () => {
  it.each([
    [0, 'Good morning'],
    [6, 'Good morning'],
    [11, 'Good morning'],
    [12, 'Good afternoon'],
    [16, 'Good afternoon'],
    [17, 'Good evening'],
    [23, 'Good evening'],
  ])('at %i:00 says "%s"', (hour, expected) => {
    expect(salutationFor(hour)).toBe(expected);
  });

  it('changes at noon and at five, not at some hour in between', () => {
    // The boundaries are the whole content of this function, so they are what
    // gets pinned — an off-by-one here greets a teacher with "Good evening" at
    // lunch and nobody writes a bug report about it.
    expect(salutationFor(11)).not.toBe(salutationFor(12));
    expect(salutationFor(16)).not.toBe(salutationFor(17));
  });

  it('never says "good night" — nobody says that on opening an app', () => {
    for (let h = 0; h < 24; h++) {
      expect(salutationFor(h).toLowerCase()).not.toContain('night');
    }
  });

  it('reads the given clock, so the greeting follows the device time', () => {
    expect(salutation(new Date(2026, 0, 1, 9, 0))).toBe('Good morning');
    expect(salutation(new Date(2026, 0, 1, 20, 0))).toBe('Good evening');
  });
});

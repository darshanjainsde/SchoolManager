import { readableDetail } from '../(tabs)/fines/index';

describe('fine detail dates (audit 9 Oct 2026)', () => {
  it('turns the server\'s ISO date into the date people read everywhere else', () => {
    expect(readableDetail('returned 2026-07-06')).toBe('returned 6 Jul 2026');
  });
  it('leaves a detail with no date alone', () => {
    expect(readableDetail('3 days late, still out')).toBe('3 days late, still out');
  });
});

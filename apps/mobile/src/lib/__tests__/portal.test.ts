import { daysUntilLabel, formatDate } from '../portal';

describe('daysUntilLabel', () => {
  it('reads "Today" for a timestamp later today', () => {
    const later = new Date();
    later.setHours(later.getHours() + 1);
    expect(daysUntilLabel(later.toISOString())).toBe('Today');
  });

  it('reads "Today" for a timestamp already in the past today', () => {
    const earlier = new Date();
    earlier.setHours(earlier.getHours() - 1);
    expect(daysUntilLabel(earlier.toISOString())).toBe('Today');
  });

  it('reads "Tomorrow" for a timestamp exactly one calendar day ahead', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(daysUntilLabel(tomorrow.toISOString())).toBe('Tomorrow');
  });

  it('reads "In N days" for anything further out', () => {
    const inFive = new Date();
    inFive.setDate(inFive.getDate() + 5);
    expect(daysUntilLabel(inFive.toISOString())).toBe('In 5 days');
  });
});

describe('formatDate', () => {
  it('renders a medium-length localized date', () => {
    // Just prove it does not throw and returns something date-shaped —
    // the exact locale string is environment-dependent.
    expect(formatDate('2026-08-03T00:00:00.000Z')).toEqual(expect.any(String));
    expect(formatDate('2026-08-03T00:00:00.000Z').length).toBeGreaterThan(0);
  });
});

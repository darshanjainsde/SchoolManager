import { shortDayDate } from './timetable-date';

describe('shortDayDate', () => {
  it('writes September as "Sep", never "Sept"', () => {
    const s = shortDayDate(new Date('2026-09-15T00:00:00Z'));
    expect(s).toBe('Tue 15 Sep 2026');
    expect(s).not.toContain('Sept');
  });

  it('rolls over a month and year boundary', () => {
    expect(shortDayDate(new Date('2026-12-31T00:00:00Z'))).toBe('Thu 31 Dec 2026');
    expect(shortDayDate(new Date('2027-01-01T00:00:00Z'))).toBe('Fri 1 Jan 2027');
  });

  it('names a Sunday', () => {
    expect(shortDayDate(new Date('2026-10-11T00:00:00Z'))).toBe('Sun 11 Oct 2026');
  });
});

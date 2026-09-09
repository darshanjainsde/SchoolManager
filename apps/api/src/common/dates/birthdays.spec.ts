import {
  addDays,
  daysUntil,
  effectiveDayMonth,
  formatName,
  inWindow,
  secondsToMidnight,
  todayInZone,
  windowBounds,
  ymdString,
} from './birthdays';

describe('birthday date maths', () => {
  it('todayInZone uses the school timezone, not the process clock', () => {
    // 2026-09-09T20:30:00Z is already 10 Sep in Kolkata, still 9 Sep in UTC.
    expect(todayInZone('Asia/Kolkata', new Date('2026-09-09T20:30:00Z'))).toEqual({ y: 2026, m: 9, d: 10 });
    expect(todayInZone('UTC', new Date('2026-09-09T20:30:00Z'))).toEqual({ y: 2026, m: 9, d: 9 });
    expect(ymdString(todayInZone('Asia/Kolkata', new Date('2026-09-09T20:30:00Z')))).toBe('2026-09-10');
  });

  it('29 Feb shows on 28 Feb in a non-leap year, and on 29 Feb in a leap year', () => {
    expect(effectiveDayMonth(new Date('2016-02-29T00:00:00Z'), 2026)).toEqual({ m: 2, d: 28 });
    expect(effectiveDayMonth(new Date('2016-02-29T00:00:00Z'), 2028)).toEqual({ m: 2, d: 29 });
    expect(effectiveDayMonth(new Date('2015-03-01T00:00:00Z'), 2026)).toEqual({ m: 3, d: 1 });
  });

  it('inWindow wraps across new year', () => {
    const start = { y: 2026, m: 12, d: 29 };
    const end = addDays(start, 6);
    expect(end).toEqual({ y: 2027, m: 1, d: 4 });
    expect(inWindow(new Date('2015-01-02T00:00:00Z'), start, end)).toBe(true);
    expect(inWindow(new Date('2015-12-30T00:00:00Z'), start, end)).toBe(true);
    expect(inWindow(new Date('2015-01-06T00:00:00Z'), start, end)).toBe(false);
    expect(inWindow(new Date('2015-12-28T00:00:00Z'), start, end)).toBe(false);
  });

  it('formats names', () => {
    expect(formatName('Aarav', 'Mehta', 'FIRST')).toBe('Aarav');
    expect(formatName('Aarav', 'Mehta', 'FIRST_INITIAL')).toBe('Aarav M.');
    expect(formatName('Aarav', 'Mehta', 'FULL')).toBe('Aarav Mehta');
    expect(formatName('Aarav', '', 'FIRST_INITIAL')).toBe('Aarav');
    expect(formatName(' Aarav ', ' mehta ', 'FIRST_INITIAL')).toBe('Aarav M.');
  });

  it('secondsToMidnight counts to the school midnight', () => {
    // 20:30Z = 02:00 IST → 22 hours left in the Kolkata day.
    expect(secondsToMidnight('Asia/Kolkata', new Date('2026-09-09T20:30:00Z'))).toBe(22 * 3600);
    expect(secondsToMidnight('UTC', new Date('2026-09-09T23:59:30Z'))).toBe(30);
  });

  it('windowBounds', () => {
    const t = { y: 2026, m: 9, d: 9 };
    expect(windowBounds('TODAY', t)).toEqual({ start: t, end: t });
    expect(windowBounds('WEEK', t)).toEqual({ start: t, end: { y: 2026, m: 9, d: 15 } });
    expect(windowBounds('MONTH', t)).toEqual({ start: { y: 2026, m: 9, d: 1 }, end: { y: 2026, m: 9, d: 30 } });
    expect(windowBounds('MONTH', { y: 2028, m: 2, d: 10 }).end).toEqual({ y: 2028, m: 2, d: 29 });
  });

  it('daysUntil is 0 today and wraps through the year', () => {
    const t = { y: 2026, m: 9, d: 9 };
    expect(daysUntil(9, 9, t)).toBe(0);
    expect(daysUntil(11, 9, t)).toBe(2);
    expect(daysUntil(2, 1, t)).toBe(115);
  });
});

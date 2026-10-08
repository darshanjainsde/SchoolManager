import { fmtDate, fmtDateTime, fmtDay, fmtDayTime, fmtLongDay, fmtMonthYear, fmtTime, fmtWeekdayDate, fmtWeekdayDay, fmtWeekdayShort } from '../dates';

/**
 * One way to write a date: the Indian order, the same on every phone. These
 * pin the shapes and the one trap: a calendar day must never move with the
 * phone's time zone.
 */
describe('dates', () => {
  it('writes days in Indian order', () => {
    expect(fmtDay('2026-10-08')).toBe('8 Oct');
    expect(fmtDate('2026-10-08')).toBe('8 Oct 2026');
    expect(fmtWeekdayDay('2026-10-08')).toBe('Thu, 8 Oct');
    expect(fmtWeekdayDate('2026-10-08')).toBe('Thu, 8 Oct 2026');
    expect(fmtLongDay('2026-10-08')).toBe('Thursday, 8 October');
    expect(fmtWeekdayShort('2026-10-08')).toBe('Thu');
    expect(fmtMonthYear(2026, 9)).toBe('October 2026');
  });

  it('a calendar day keeps its digits, with or without a midnight-UTC stamp', () => {
    expect(fmtDate('2026-10-01T00:00:00.000Z')).toBe('1 Oct 2026');
    expect(fmtDate('2026-10-01T00:00:00Z')).toBe('1 Oct 2026');
    expect(fmtDay('2026-01-01')).toBe('1 Jan');
    expect(fmtDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('a moment is read on the phone clock, 12-hour with am/pm', () => {
    const noon = new Date(2026, 9, 8, 12, 57);
    expect(fmtTime(noon)).toBe('12:57 pm');
    expect(fmtTime(new Date(2026, 9, 8, 0, 5))).toBe('12:05 am');
    expect(fmtTime(new Date(2026, 9, 8, 9, 0))).toBe('9:00 am');
    expect(fmtDayTime(noon)).toBe('8 Oct, 12:57 pm');
    expect(fmtDateTime(noon)).toBe('8 Oct 2026, 12:57 pm');
  });
});

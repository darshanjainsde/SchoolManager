import { describe, it, expect } from 'vitest';
import { eventDateParts } from './site-utils';

/**
 * A DATE IS AN OBJECT, NOT A SUBSTRING.
 *
 * The card used to print "20 Aug, 10:00 am · Main hall" as one grey line, so
 * the single fact a parent is scanning for — WHEN — had to be read out of a
 * sentence. Splitting it into day / month / time lets the card show a real date
 * block, and it has to be split by the formatter rather than by slicing the
 * formatted string, which breaks the moment a locale or timezone changes it.
 *
 * Everything is computed in the SCHOOL's timezone with a fixed locale: the
 * server usually runs in UTC and the parent's phone does not, and a date that
 * disagrees between the two is a hydration mismatch.
 */
describe('eventDateParts', () => {
  it('splits a start time into the pieces a date block needs', () => {
    // 04:30 UTC on 20 Aug = 10:00 am IST, the same day.
    const parts = eventDateParts('2026-08-20T04:30:00Z', 'Asia/Kolkata');
    expect(parts).toEqual({ day: '20', month: 'Aug', weekday: 'Thu', time: '10:00 am' });
  });

  it('reads the date in the school’s timezone, not the server’s', () => {
    // 20:00 UTC on 20 Aug is already 1:30 am on the 21st in Kolkata. A school
    // running a late event must not see yesterday's date on its own site.
    const parts = eventDateParts('2026-08-20T20:00:00Z', 'Asia/Kolkata');
    expect(parts.day).toBe('21');
    expect(parts.month).toBe('Aug');
  });

  it('falls back to UTC for a timezone nobody recognises, rather than throwing', () => {
    // A bad School.timezone must degrade to a readable card, not a 500.
    const parts = eventDateParts('2026-08-20T04:30:00Z', 'Not/AZone');
    expect(parts.day).toBe('20');
    expect(parts.time).toBe('4:30 am');
  });
});

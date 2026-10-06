import { inHalf, minutesOfDay } from './leave-dates';

describe('minutesOfDay', () => {
  it.each([
    ['08:00', 480], ['8:00', 480], ['12:40', 760], ['1:30 pm', 810], ['12:15 AM', 15], ['10:15', 615],
    [' 9:05 ', 545], ['12:00 pm', 720], ['11:59PM', 1439], ['0:30', 30],
  ])('%s → %i', (s, m) => expect(minutesOfDay(s)).toBe(m));
  it.each(['', null, undefined, 'P3', '25:00', '8:60', '13:00 pm', '0:30 am', '8', 'after lunch'])('%s → null', (s) =>
    expect(minutesOfDay(s as string)).toBeNull(),
  );
});

describe('inHalf — which periods a half day leaves empty', () => {
  it('a full day, or a half day with no part (an older app), covers every period', () => {
    expect(inHalf({ halfDay: false }, '8:00')).toBe(true);
    expect(inHalf({ halfDay: false, halfDayPart: 'PM' }, '8:00')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: null }, '13:00')).toBe(true);
    expect(inHalf({ halfDay: true }, '8:00')).toBe(true);
    expect(inHalf({}, '8:00')).toBe(true);
  });
  it('morning is before 12:00, afternoon from 12:00 — "8:00" without a leading zero is morning', () => {
    expect(inHalf({ halfDay: true, halfDayPart: 'PM' }, '8:00')).toBe(false);
    expect(inHalf({ halfDay: true, halfDayPart: 'PM' }, '08:00')).toBe(false);
    expect(inHalf({ halfDay: true, halfDayPart: 'PM' }, '12:00')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: 'PM' }, '1:30 pm')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: 'AM' }, '11:59')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: 'AM' }, '8:00')).toBe(true);
    expect(inHalf({ halfDay: true, halfDayPart: 'AM' }, '12:40')).toBe(false);
  });
  it('a time nobody can read is covered rather than left without a teacher — either half', () => {
    for (const part of ['AM', 'PM']) {
      expect(inHalf({ halfDay: true, halfDayPart: part }, 'after lunch')).toBe(true);
      expect(inHalf({ halfDay: true, halfDayPart: part }, '')).toBe(true);
      expect(inHalf({ halfDay: true, halfDayPart: part }, null)).toBe(true);
      expect(inHalf({ halfDay: true, halfDayPart: part }, undefined)).toBe(true);
    }
  });
});

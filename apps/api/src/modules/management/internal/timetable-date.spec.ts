import { istTodayISO } from './timetable-date';

describe('istTodayISO', () => {
  it('reports the IST calendar day, not the UTC one', () => {
    // 2026-08-03T19:00:00Z is 2026-08-04 00:30 IST — the next school day.
    expect(istTodayISO(new Date('2026-08-03T19:00:00Z'))).toBe('2026-08-04');
  });

  it('does not roll forward before the IST midnight boundary', () => {
    // 2026-08-03T18:00:00Z is 2026-08-03 23:30 IST — still the same day.
    expect(istTodayISO(new Date('2026-08-03T18:00:00Z'))).toBe('2026-08-03');
  });
});

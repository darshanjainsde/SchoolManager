import { isWithinReminderWindow, reminderWindows } from './reminder-window';

const NOW = new Date('2026-07-21T03:00:00.000Z');

describe('reminderWindows', () => {
  it('computes the T-2 and T-1 UTC calendar-day ranges relative to now', () => {
    const windows = reminderWindows(NOW);

    expect(windows.twoDaysOut).toEqual({
      gte: new Date('2026-07-23T00:00:00.000Z'),
      lt: new Date('2026-07-24T00:00:00.000Z'),
    });
    expect(windows.oneDayOut).toEqual({
      gte: new Date('2026-07-22T00:00:00.000Z'),
      lt: new Date('2026-07-23T00:00:00.000Z'),
    });
  });
});

describe('isWithinReminderWindow', () => {
  it('selects an exam scheduled exactly 2 days out', () => {
    expect(isWithinReminderWindow(new Date('2026-07-23T09:00:00.000Z'), NOW)).toBe(true);
  });

  it('selects an exam scheduled exactly 1 day out', () => {
    expect(isWithinReminderWindow(new Date('2026-07-22T14:30:00.000Z'), NOW)).toBe(true);
  });

  it('catches a 2-day-out exam scheduled right at the start of its UTC day, even if the cron runs later in its own day', () => {
    expect(isWithinReminderWindow(new Date('2026-07-23T00:05:00.000Z'), NOW)).toBe(true);
  });

  it('does not select an exam scheduled 5 days out', () => {
    expect(isWithinReminderWindow(new Date('2026-07-26T09:00:00.000Z'), NOW)).toBe(false);
  });

  it('does not select an exam scheduled today or in the past', () => {
    expect(isWithinReminderWindow(new Date('2026-07-21T09:00:00.000Z'), NOW)).toBe(false);
    expect(isWithinReminderWindow(new Date('2026-07-20T09:00:00.000Z'), NOW)).toBe(false);
  });

  it('does not select an exam scheduled 3 days out (just past the T-2 window)', () => {
    expect(isWithinReminderWindow(new Date('2026-07-24T00:00:00.000Z'), NOW)).toBe(false);
  });
});

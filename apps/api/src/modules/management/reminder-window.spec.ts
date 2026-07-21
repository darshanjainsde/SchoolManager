import { reminderDaysUntil, reminderWindows } from './reminder-window';

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

describe('reminderDaysUntil', () => {
  it('returns 2 for an exam scheduled exactly 2 days out', () => {
    expect(reminderDaysUntil(new Date('2026-07-23T09:00:00.000Z'), NOW)).toBe(2);
  });

  it('returns 1 for an exam scheduled exactly 1 day out', () => {
    expect(reminderDaysUntil(new Date('2026-07-22T14:30:00.000Z'), NOW)).toBe(1);
  });

  it('catches a 2-day-out exam scheduled right at the start of its UTC day, even if the cron runs later in its own day', () => {
    expect(reminderDaysUntil(new Date('2026-07-23T00:05:00.000Z'), NOW)).toBe(2);
  });

  it('returns null for an exam scheduled 5 days out', () => {
    expect(reminderDaysUntil(new Date('2026-07-26T09:00:00.000Z'), NOW)).toBeNull();
  });

  it('returns null for an exam scheduled today or in the past', () => {
    expect(reminderDaysUntil(new Date('2026-07-21T09:00:00.000Z'), NOW)).toBeNull();
    expect(reminderDaysUntil(new Date('2026-07-20T09:00:00.000Z'), NOW)).toBeNull();
  });

  it('returns null for an exam scheduled 3 days out (just past the T-2 window)', () => {
    expect(reminderDaysUntil(new Date('2026-07-24T00:00:00.000Z'), NOW)).toBeNull();
  });
});

import { ATTENDANCE_STATUSES } from '@skoolos/types';
import { buildMarksPayload, todayISO } from '../attendance';

describe('buildMarksPayload', () => {
  it('preserves every one of the three states the server accepts', () => {
    const payload = buildMarksPayload('sec-1', '2026-08-03', [
      { studentId: 's1', status: 'PRESENT' },
      { studentId: 's2', status: 'ABSENT' },
      { studentId: 's3', status: 'LATE' },
    ]);
    expect(payload.marks).toEqual([
      { studentId: 's1', status: 'PRESENT' },
      { studentId: 's2', status: 'ABSENT' },
      { studentId: 's3', status: 'LATE' },
    ]);
  });

  it('never collapses a status to a boolean and back', () => {
    // The regression guard. The old implementation took `present: boolean`,
    // so LATE could not survive a round-trip through it by construction.
    for (const status of ATTENDANCE_STATUSES) {
      const [mark] = buildMarksPayload('sec-1', '2026-08-03', [{ studentId: 's1', status }]).marks;
      expect(mark.status).toBe(status);
    }
  });

  it('passes the class and date through unchanged', () => {
    const payload = buildMarksPayload('sec-9', '2026-01-31', []);
    expect(payload.classSectionId).toBe('sec-9');
    expect(payload.date).toBe('2026-01-31');
    expect(payload.marks).toEqual([]);
  });
});

it('todayISO returns YYYY-MM-DD', () => {
  expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it('todayISO is device-local, not UTC — a late-night local date does not roll back a day', () => {
  // Regression: using `Date#toISOString()` would report the UTC calendar
  // date, which is wrong for any timezone behind UTC in the evening.
  const fixed = new Date(2026, 6, 24, 23, 30, 0); // local 2026-07-24 23:30
  jest.useFakeTimers().setSystemTime(fixed);
  expect(todayISO()).toBe('2026-07-24');
  jest.useRealTimers();
});

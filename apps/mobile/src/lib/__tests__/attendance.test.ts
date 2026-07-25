import { buildMarksPayload, todayISO } from '../attendance';

it('maps roster toggles to PUT payload', () => {
  const p = buildMarksPayload('cs1', '2026-07-24', [
    { studentId: 's1', present: true },
    { studentId: 's2', present: false },
  ]);
  expect(p).toEqual({
    classSectionId: 'cs1',
    date: '2026-07-24',
    marks: [
      { studentId: 's1', status: 'PRESENT' },
      { studentId: 's2', status: 'ABSENT' },
    ],
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

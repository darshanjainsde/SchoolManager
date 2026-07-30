import { buildAttendanceGrid, monthKeyLabel, shiftMonthKey } from '../attendance-grid';
import type { AttendanceSummary } from '@skoolos/types';

function summary(month: string, days: AttendanceSummary['days'] = []): AttendanceSummary {
  return { month, percent: 0, present: 0, absent: 0, late: 0, days };
}

describe('buildAttendanceGrid — Monday-first', () => {
  // 2026-02-01 is a Sunday (UTC). In a Monday-first grid (col 0 = Mon … col
  // 6 = Sun), Sunday is the LAST column, so day 1 must land at index 6 —
  // "column 7" 1-indexed, per the parity brief.
  it('a month starting on Sunday puts day 1 in the 7th (last) column', () => {
    const cells = buildAttendanceGrid(summary('2026-02', [{ date: '2026-02-01', status: 'PRESENT' }]));
    expect(cells.slice(0, 6).every((c) => c.day === null)).toBe(true);
    expect(cells[6]).toEqual({ day: 1, status: 'PRESENT' });
  });

  // 2026-06-01 is a Monday (UTC) — the opposite end: day 1 must land at
  // index 0 with zero leading blanks.
  it('a month starting on Monday puts day 1 in the 1st column with no leading blanks', () => {
    const cells = buildAttendanceGrid(summary('2026-06', [{ date: '2026-06-01', status: 'ABSENT' }]));
    expect(cells[0]).toEqual({ day: 1, status: 'ABSENT' });
  });

  it('fills every day of the month, with unmarked days as status null', () => {
    const cells = buildAttendanceGrid(summary('2026-06', [{ date: '2026-06-15', status: 'LATE' }]));
    const days = cells.filter((c) => c.day !== null);
    expect(days).toHaveLength(30); // June has 30 days
    expect(days.find((c) => c.day === 15)).toEqual({ day: 15, status: 'LATE' });
    expect(days.find((c) => c.day === 1)).toEqual({ day: 1, status: null });
  });

  it('an empty days array still shapes every day of the month as unmarked', () => {
    const cells = buildAttendanceGrid(summary('2026-02'));
    const days = cells.filter((c) => c.day !== null);
    expect(days).toHaveLength(28); // Feb 2026 is not a leap year
    expect(days.every((c) => c.status === null)).toBe(true);
  });
});

describe('shiftMonthKey — year rollover', () => {
  it('January minus one month rolls back to December of the PREVIOUS year', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
  });

  it('December plus one month rolls forward to January of the NEXT year', () => {
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('a mid-year shift with no rollover just moves the month', () => {
    expect(shiftMonthKey('2026-07', -1)).toBe('2026-06');
    expect(shiftMonthKey('2026-07', 1)).toBe('2026-08');
  });

  it('a multi-month shift crossing more than one year boundary still lands correctly', () => {
    expect(shiftMonthKey('2026-01', -13)).toBe('2024-12');
    expect(shiftMonthKey('2026-12', 13)).toBe('2028-01');
  });
});

describe('monthKeyLabel', () => {
  it('formats a YYYY-MM key as a full month name and year', () => {
    expect(monthKeyLabel('2026-07')).toMatch(/July/);
    expect(monthKeyLabel('2026-07')).toMatch(/2026/);
  });
});

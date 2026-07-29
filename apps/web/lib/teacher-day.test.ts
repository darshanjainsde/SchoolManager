import { describe, it, expect } from 'vitest';
import type { TeacherDayEntry } from '@skoolos/types';
import { currentEntry, minutesOfDay } from './teacher-day';

const entry = (label: string, startTime: string, endTime: string, kind: 'CLASS' | 'BREAK' = 'CLASS'): TeacherDayEntry => ({
  periodId: `p-${label}`,
  label,
  startTime,
  endTime,
  kind,
  slot: kind === 'CLASS'
    ? { classSectionId: `sec-${label}`, className: `8-${label}`, subjectName: 'Mathematics', covering: false, coveringFor: null }
    : null,
  register: kind === 'CLASS' ? { taken: false, present: 0, total: 30, markedBy: null } : null,
});

const DAY: TeacherDayEntry[] = [
  entry('P1', '08:00', '08:45'),
  entry('Break', '08:45', '09:05', 'BREAK'),
  entry('P2', '09:05', '09:50'),
];

describe('minutesOfDay', () => {
  it('converts a wall clock string to minutes past midnight', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('09:05')).toBe(545);
    expect(minutesOfDay('23:59')).toBe(1439);
  });
});

describe('currentEntry', () => {
  it('finds the period containing the given time', () => {
    const r = currentEntry(DAY, minutesOfDay('08:20'));
    expect(r.entry?.label).toBe('P1');
    expect(r.index).toBe(0);
  });

  it('reports elapsed and total minutes for the current period', () => {
    const r = currentEntry(DAY, minutesOfDay('08:20'));
    expect(r.elapsed).toBe(20);
    expect(r.total).toBe(45);
  });

  it('treats a period as current up to but not including its end time', () => {
    expect(currentEntry(DAY, minutesOfDay('08:45')).entry?.label).toBe('Break');
  });

  it('returns a break as the current entry', () => {
    expect(currentEntry(DAY, minutesOfDay('08:50')).entry?.kind).toBe('BREAK');
  });

  it('returns null before the school day starts', () => {
    const r = currentEntry(DAY, minutesOfDay('07:00'));
    expect(r.entry).toBeNull();
    expect(r.index).toBe(-1);
  });

  it('returns null after the school day ends', () => {
    expect(currentEntry(DAY, minutesOfDay('18:00')).entry).toBeNull();
  });

  it('returns null for an empty day rather than throwing', () => {
    expect(currentEntry([], minutesOfDay('09:00')).entry).toBeNull();
  });

  it('handles a gap between periods by returning null', () => {
    const gapped = [entry('P1', '08:00', '08:45'), entry('P2', '10:00', '10:45')];
    expect(currentEntry(gapped, minutesOfDay('09:00')).entry).toBeNull();
  });

  // --- Edge cases beyond the brief -----------------------------------

  it('treats the exact start minute of a single-entry day as current', () => {
    const single = [entry('Only', '10:00', '10:30')];
    const r = currentEntry(single, minutesOfDay('10:00'));
    expect(r.entry?.label).toBe('Only');
    expect(r.elapsed).toBe(0);
  });

  it('does not treat the exact end minute of a single-entry day as current', () => {
    const single = [entry('Only', '10:00', '10:30')];
    const r = currentEntry(single, minutesOfDay('10:30'));
    expect(r.entry).toBeNull();
    expect(r.index).toBe(-1);
  });

  it('matches entries in array order, not chronological order, when entries are supplied out of order', () => {
    // currentEntry does not sort its input — it trusts callers to supply the
    // day in chronological order (as the API contract for TeacherDay does).
    // If entries arrive out of order, `findIndex` still returns the first
    // *array* element whose [start, end) range contains nowMinutes, which
    // may not be the chronologically-first match. We pin that behaviour here
    // rather than silently relying on it.
    const outOfOrder = [
      entry('Later', '09:05', '09:50'),
      entry('Earlier', '08:00', '08:45'),
    ];
    const r = currentEntry(outOfOrder, minutesOfDay('09:20'));
    expect(r.entry?.label).toBe('Later');
    expect(r.index).toBe(0);
  });

  it('never reports a zero-length period as current, and does not divide by zero computing its progress', () => {
    const zeroLength = [entry('Instant', '10:00', '10:00')];
    // nowMinutes >= start && nowMinutes < end can never both hold when
    // start === end, so the entry can never match — this is correct: a
    // zero-duration period contains no point in time.
    const r = currentEntry(zeroLength, minutesOfDay('10:00'));
    expect(r.entry).toBeNull();
    expect(r.index).toBe(-1);
    // total is 0 in the "nothing is current" default, not from evaluating
    // end - start on the zero-length entry — currentEntry never divides
    // elapsed by total itself, but callers that compute a percentage must
    // guard total === 0 before dividing.
    expect(r.total).toBe(0);
    expect(r.elapsed).toBe(0);
  });

  it('never reports a period crossing midnight as current, for any time of day (the school day model does not support wraparound)', () => {
    // TeacherDay models a single calendar date with entries expected to fall
    // within that date's 00:00–23:59 window (see packages/types/src/index.ts:
    // TeacherDay.date + dayOfWeek), so a period like '23:30' -> '00:15' is
    // outside the supported model. minutesOfDay treats both boundaries as
    // plain minutes-past-midnight with no wraparound, so start (1410) ends up
    // greater than end (15) and `nowMinutes >= start && nowMinutes < end` can
    // never be satisfied by any nowMinutes in [0, 1440). We pin that the
    // function silently never reports such a period as current, rather than
    // throwing or wrapping around — callers must not construct entries like
    // this.
    const crossesMidnight = [entry('Overnight', '23:30', '00:15')];
    expect(currentEntry(crossesMidnight, minutesOfDay('23:45')).entry).toBeNull();
    expect(currentEntry(crossesMidnight, minutesOfDay('00:00')).entry).toBeNull();
    expect(currentEntry(crossesMidnight, minutesOfDay('00:10')).entry).toBeNull();
    expect(currentEntry(crossesMidnight, minutesOfDay('12:00')).entry).toBeNull();
  });
});

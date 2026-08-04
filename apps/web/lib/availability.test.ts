import { describe, it, expect } from 'vitest';
import {
  buildAvailability,
  currentPeriodId,
  freeInCell,
  teachingDays,
  type AvailabilityPeriod,
  type AvailabilityResponse,
} from './availability';

function period(over: Partial<AvailabilityPeriod> & { id: string; order: number }): AvailabilityPeriod {
  return {
    label: `Period ${over.order}`,
    kind: 'CLASS',
    startTime: '09:00',
    endTime: '09:45',
    ...over,
  };
}

const P1 = period({ id: 'p1', order: 1, startTime: '09:00', endTime: '09:45' });
const P2 = period({ id: 'p2', order: 2, startTime: '09:45', endTime: '10:30' });
const LUNCH = period({ id: 'pl', order: 3, label: 'Lunch', kind: 'BREAK', startTime: '10:30', endTime: '11:15' });

const TEACHERS = [
  { id: 't1', firstName: 'Anita', lastName: 'Nair' },
  { id: 't2', firstName: 'Amit', lastName: 'Mehta' },
  { id: 't3', firstName: 'Priya', lastName: 'Desai' },
];

function payload(busy: AvailabilityResponse['busy']): AvailabilityResponse {
  return { teachers: TEACHERS, periods: [P1, P2, LUNCH], busy };
}

describe('which days the school teaches', () => {
  // THE BUG THIS EXISTS FOR: the page hardcoded Monday–Friday. Raffles teaches
  // six days, the API returned all 720 slots including Saturday's 120, and the
  // page discarded them — an admin covering a Saturday absence saw nothing, and
  // nothing on screen admitted the day was missing.
  it('includes Saturday when the school teaches on Saturday', () => {
    const days = teachingDays([
      { teacherId: 't1', dayOfWeek: 1, periodId: 'p1' },
      { teacherId: 't1', dayOfWeek: 6, periodId: 'p1' },
    ]);
    expect(days).toEqual([1, 6]);
  });

  it('shows a five-day school exactly five days — the fix does not invent Saturday', () => {
    const busy = [1, 2, 3, 4, 5].map((d) => ({ teacherId: 't1', dayOfWeek: d, periodId: 'p1' }));
    expect(teachingDays(busy)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns no days at all when no timetable has been assigned, rather than a default week', () => {
    // An empty grid is the truthful rendering of "nothing is scheduled". Five
    // columns of "everyone free" would be a page-wide false positive.
    expect(teachingDays([])).toEqual([]);
  });

  it('de-duplicates and sorts, so day order never depends on row order', () => {
    expect(
      teachingDays([
        { teacherId: 't1', dayOfWeek: 6, periodId: 'p1' },
        { teacherId: 't2', dayOfWeek: 2, periodId: 'p1' },
        { teacherId: 't3', dayOfWeek: 6, periodId: 'p2' },
      ]),
    ).toEqual([2, 6]);
  });
});

describe('who is free in an hour', () => {
  it('lists exactly the teachers with no slot in that day and period', () => {
    const m = buildAvailability(payload([{ teacherId: 't1', dayOfWeek: 4, periodId: 'p1' }]));
    // Sorted, not in payload order: t2 and t3 are both on zero load, so the
    // name tie-break decides — Desai before Mehta.
    expect(freeInCell(m, 4, 'p1').map((t) => t.id)).toEqual(['t3', 't2']);
  });

  it('is scoped to the day — being busy on Monday does not free you on Thursday', () => {
    const m = buildAvailability(payload([{ teacherId: 't1', dayOfWeek: 1, periodId: 'p1' }]));
    expect(freeInCell(m, 4, 'p1').map((t) => t.id)).toContain('t1');
    expect(freeInCell(m, 1, 'p1').map((t) => t.id)).not.toContain('t1');
  });

  it('orders by weekly load, so the same few people do not absorb every cover', () => {
    // t3 teaches 3 periods, t1 teaches 2, t2 teaches none. Alphabetically by
    // surname this would be Desai, Mehta, Nair — the opposite of fair.
    const m = buildAvailability(
      payload([
        { teacherId: 't1', dayOfWeek: 1, periodId: 'p1' },
        { teacherId: 't1', dayOfWeek: 2, periodId: 'p1' },
        { teacherId: 't3', dayOfWeek: 1, periodId: 'p1' },
        { teacherId: 't3', dayOfWeek: 2, periodId: 'p1' },
        { teacherId: 't3', dayOfWeek: 3, periodId: 'p1' },
      ]),
    );
    expect(freeInCell(m, 5, 'p1').map((t) => t.id)).toEqual(['t2', 't1', 't3']);
  });

  it('breaks ties on name so the list does not shuffle between renders', () => {
    const m = buildAvailability(payload([]));
    const once = freeInCell(m, 1, 'p1').map((t) => t.id);
    const twice = freeInCell(m, 1, 'p1').map((t) => t.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(['t3', 't2', 't1']); // Desai, Mehta, Nair — all load 0
  });

  it('returns nobody for a BREAK, rather than the whole staff', () => {
    // Counting a break as an hour would put the largest number on the page
    // against the one time of day nobody can actually teach.
    const m = buildAvailability(payload([]));
    expect(freeInCell(m, 1, 'pl')).toEqual([]);
  });

  it('returns nobody for a period id that does not exist', () => {
    const m = buildAvailability(payload([]));
    expect(freeInCell(m, 1, 'nope')).toEqual([]);
  });
});

describe('weekly load', () => {
  it('counts a teacher with no slots as zero rather than omitting them', () => {
    // Omission would sort them last — the exact opposite of the truth, since
    // an empty week is the lightest week there is.
    const m = buildAvailability(payload([{ teacherId: 't1', dayOfWeek: 1, periodId: 'p1' }]));
    expect(m.load.get('t2')).toBe(0);
    expect(m.load.get('t1')).toBe(1);
  });

  it('counts every slot across the whole week, not just the shown day', () => {
    const m = buildAvailability(
      payload([
        { teacherId: 't1', dayOfWeek: 1, periodId: 'p1' },
        { teacherId: 't1', dayOfWeek: 6, periodId: 'p2' },
      ]),
    );
    expect(m.load.get('t1')).toBe(2);
  });
});

describe('the period running now', () => {
  const periods = [P1, P2, LUNCH];

  it('finds the period containing the current time', () => {
    const at = new Date(2026, 7, 6, 10, 0); // 10:00 — inside P2 (09:45–10:30)
    expect(currentPeriodId(periods, at).periodId).toBe('p2');
  });

  it('is half-open: a period ends the minute the next one starts', () => {
    // 09:45 belongs to P2, not P1 — otherwise two periods claim the same
    // minute and which one wins depends on array order.
    const at = new Date(2026, 7, 6, 9, 45);
    expect(currentPeriodId(periods, at).periodId).toBe('p2');
  });

  it('reports no current period outside school hours, rather than the first one', () => {
    const at = new Date(2026, 7, 6, 21, 0);
    expect(currentPeriodId(periods, at).periodId).toBeNull();
  });

  it('maps Sunday to 7, matching the timetable rather than getDay()', () => {
    // getDay() calls Sunday 0; the timetable uses ISO weekdays. A raw 0 here
    // would match no day column at all and silently select nothing.
    const sunday = new Date(2026, 7, 9, 10, 0);
    expect(sunday.getDay()).toBe(0);
    expect(currentPeriodId(periods, sunday).day).toBe(7);
  });

  it('maps Saturday to 6 so a six-day school opens on its own day', () => {
    const saturday = new Date(2026, 7, 8, 10, 0);
    expect(currentPeriodId(periods, saturday).day).toBe(6);
  });

  it('ignores a period whose times are unparseable instead of throwing', () => {
    const broken = [period({ id: 'px', order: 1, startTime: '', endTime: '' })];
    expect(currentPeriodId(broken, new Date(2026, 7, 6, 10, 0)).periodId).toBeNull();
  });
});

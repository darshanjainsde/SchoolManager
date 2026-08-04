import { describe, it, expect } from 'vitest';
import { buildAvailability, freeInCell, type AvailabilityResponse } from './availability';

/**
 * The grid, at the shape and size a real school actually has.
 *
 * WHY THIS FILE EXISTS. On staging every cell of the Raffles grid reads
 * "15 free", which looks exactly like a page that computes one number and
 * prints it everywhere. It is not: Raffles has 30 teachers and 15 classes, and
 * the seed gives every class one teacher in every period — so precisely 15 of
 * the 30 are teaching in all 48 cells, and 15 are free. The data is uniform, so
 * the correct rendering of it is uniform too.
 *
 * That is impossible to tell apart from a bug by looking, which is the whole
 * problem. So these tests build that exact uniform shape, confirm it really
 * does produce 15 everywhere, and then perturb it — freeing a known number of
 * teachers in known hours — and assert the number moves by exactly that much,
 * in those cells and nowhere else.
 */

const TEACHERS = Array.from({ length: 30 }, (_, i) => ({
  id: `t${i}`,
  firstName: `First${i}`,
  lastName: `Last${String(i).padStart(2, '0')}`,
}));

const PERIODS = [
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `p${i + 1}`,
    order: i + 1,
    label: `Period ${i + 1}`,
    kind: 'CLASS' as const,
    startTime: `0${8 + i}:00`,
    endTime: `0${8 + i}:45`,
  })),
  { id: 'lunch', order: 6, label: 'Lunch Break', kind: 'BREAK' as const, startTime: '13:00', endTime: '14:00' },
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `p${i + 6}`,
    order: i + 7,
    label: `Period ${i + 6}`,
    kind: 'CLASS' as const,
    startTime: `1${4 + i}:00`,
    endTime: `1${4 + i}:45`,
  })),
];

const CLASS_PERIODS = PERIODS.filter((p) => p.kind === 'CLASS');
const DAYS = [1, 2, 3, 4, 5, 6]; // six-day school, exactly like Raffles

/** Teachers 0–14 teach every class period of every day; 15–29 never do. */
function uniformBusy(): AvailabilityResponse['busy'] {
  const busy: AvailabilityResponse['busy'] = [];
  for (const d of DAYS) {
    for (const p of CLASS_PERIODS) {
      for (let t = 0; t < 15; t++) busy.push({ teacherId: `t${t}`, dayOfWeek: d, periodId: p.id });
    }
  }
  return busy;
}

function payload(busy: AvailabilityResponse['busy']): AvailabilityResponse {
  return { teachers: TEACHERS, periods: PERIODS, busy };
}

/** Every (day, class-period) cell's free count, as a flat list. */
function allCounts(data: AvailabilityResponse): number[] {
  const m = buildAvailability(data);
  return DAYS.flatMap((d) => CLASS_PERIODS.map((p) => freeInCell(m, d, p.id).length));
}

describe('a school whose timetable is genuinely uniform', () => {
  it('produces the same count in all 48 cells — that is the data, not a bug', () => {
    const counts = allCounts(payload(uniformBusy()));
    expect(counts).toHaveLength(DAYS.length * CLASS_PERIODS.length);
    expect(new Set(counts)).toEqual(new Set([15]));
  });

  it('counts Saturday as its own day, with its own cells', () => {
    const m = buildAvailability(payload(uniformBusy()));
    expect(m.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(freeInCell(m, 6, 'p1')).toHaveLength(15);
  });
});

describe('the same school, with the timetable mixed up', () => {
  it('a freed teacher shows up in exactly the cell they were freed from', () => {
    // Take t0 out of Thursday, Period 3 only.
    const busy = uniformBusy().filter(
      (b) => !(b.teacherId === 't0' && b.dayOfWeek === 4 && b.periodId === 'p3'),
    );
    const m = buildAvailability(payload(busy));
    expect(freeInCell(m, 4, 'p3')).toHaveLength(16);
    // …and nowhere else moved.
    expect(freeInCell(m, 4, 'p2')).toHaveLength(15);
    expect(freeInCell(m, 3, 'p3')).toHaveLength(15);
  });

  it('freeing seven teachers in one hour moves that cell by exactly seven', () => {
    const freed = new Set(['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
    const busy = uniformBusy().filter(
      (b) => !(freed.has(b.teacherId) && b.dayOfWeek === 4 && b.periodId === 'p3'),
    );
    const m = buildAvailability(payload(busy));
    expect(freeInCell(m, 4, 'p3')).toHaveLength(22);
    expect(freeInCell(m, 4, 'p3').map((t) => t.id)).toEqual(expect.arrayContaining([...freed]));
  });

  it('different hours can hold different numbers at the same time', () => {
    // The check that a single number is not being computed once and reused:
    // three hours, three different perturbations, three different answers.
    let busy = uniformBusy();
    const drop = (ids: string[], day: number, periodId: string) => {
      const s = new Set(ids);
      busy = busy.filter((b) => !(s.has(b.teacherId) && b.dayOfWeek === day && b.periodId === periodId));
    };
    drop(['t0', 't1', 't2'], 2, 'p1'); // Tue P1  → 18
    drop(['t0', 't1', 't2', 't3', 't4', 't5', 't6'], 4, 'p3'); // Thu P3 → 22
    drop(Array.from({ length: 12 }, (_, i) => `t${i}`), 6, 'p7'); // Sat P7 → 27

    const m = buildAvailability(payload(busy));
    expect(freeInCell(m, 2, 'p1')).toHaveLength(18);
    expect(freeInCell(m, 4, 'p3')).toHaveLength(22);
    expect(freeInCell(m, 6, 'p7')).toHaveLength(27);
    expect(freeInCell(m, 3, 'p2')).toHaveLength(15); // untouched
  });

  it('an hour nobody teaches reads 30, and an hour everybody teaches reads 0', () => {
    const busy = uniformBusy();
    const emptied = busy.filter((b) => !(b.dayOfWeek === 5 && b.periodId === 'p2'));
    expect(freeInCell(buildAvailability(payload(emptied)), 5, 'p2')).toHaveLength(30);

    const packed = [
      ...busy,
      ...Array.from({ length: 15 }, (_, i) => ({ teacherId: `t${15 + i}`, dayOfWeek: 1, periodId: 'p1' })),
    ];
    expect(freeInCell(buildAvailability(payload(packed)), 1, 'p1')).toHaveLength(0);
  });

  it('ranks the never-teaching half above the always-teaching half', () => {
    // t15–t29 carry no load at all; t0–t14 carry 48 periods each. If the panel
    // ordered by name, Last00 would come first and the busiest people in the
    // school would be offered for cover first.
    const m = buildAvailability(payload(uniformBusy()));
    const free = freeInCell(m, 1, 'p1').map((t) => t.id);
    expect(free.slice(0, 3)).toEqual(['t15', 't16', 't17']);
    expect(m.load.get('t0')).toBe(DAYS.length * CLASS_PERIODS.length);
    expect(m.load.get('t15')).toBe(0);
  });
});

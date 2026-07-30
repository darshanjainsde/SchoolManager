import { buildGrid, cellKey, type GridSlot } from '../timetable-grid';

// Ported from apps/web/lib/timetable-grid.test.ts — same fixtures, same
// assertions, jest instead of vitest. buildGrid's semantics must be
// identical on both surfaces.

function slot(overrides: Partial<GridSlot> & Pick<GridSlot, 'id' | 'dayOfWeek' | 'periodId'>): GridSlot {
  return {
    periodLabel: 'P1',
    periodOrder: 1,
    className: '7-B',
    subjectName: 'Mathematics',
    startTime: '08:00',
    endTime: '08:45',
    ...overrides,
  };
}

describe('cellKey', () => {
  it('joins day and period with a colon', () => {
    expect(cellKey(3, 'per-1')).toBe('3:per-1');
  });
});

describe('buildGrid', () => {
  it('builds period rows deduped and ordered by periodOrder, not insertion order', () => {
    const slots: GridSlot[] = [
      slot({ id: 's1', dayOfWeek: 1, periodId: 'per-3', periodLabel: 'P3', periodOrder: 3 }),
      slot({ id: 's2', dayOfWeek: 1, periodId: 'per-1', periodLabel: 'P1', periodOrder: 1 }),
      slot({ id: 's3', dayOfWeek: 2, periodId: 'per-1', periodLabel: 'P1', periodOrder: 1 }), // dupe periodId
      slot({ id: 's4', dayOfWeek: 1, periodId: 'per-2', periodLabel: 'P2', periodOrder: 2 }),
    ];

    const shape = buildGrid(slots);

    expect(shape.periods.map((p) => p.id)).toEqual(['per-1', 'per-2', 'per-3']);
    expect(shape.periods).toHaveLength(3); // per-1 deduped despite appearing twice
  });

  it('builds day columns ascending, omitting days with no slots', () => {
    const slots: GridSlot[] = [
      slot({ id: 's1', dayOfWeek: 5, periodId: 'per-1' }),
      slot({ id: 's2', dayOfWeek: 1, periodId: 'per-1' }),
      slot({ id: 's3', dayOfWeek: 3, periodId: 'per-1' }),
    ];

    const shape = buildGrid(slots);

    expect(shape.days).toEqual([1, 3, 5]);
    expect(shape.days).not.toContain(2);
    expect(shape.days).not.toContain(6);
    expect(shape.days).not.toContain(7);
  });

  it('maps each slot to its day:period key in cells', () => {
    const s1 = slot({ id: 's1', dayOfWeek: 1, periodId: 'per-1' });
    const s2 = slot({ id: 's2', dayOfWeek: 2, periodId: 'per-1' });

    const shape = buildGrid([s1, s2]);

    expect(shape.cells.get(cellKey(1, 'per-1'))).toBe(s1);
    expect(shape.cells.get(cellKey(2, 'per-1'))).toBe(s2);
    expect(shape.cells.size).toBe(2);
  });

  it('an empty slot array returns empty periods/days and an empty map — no crash', () => {
    const shape = buildGrid([]);

    expect(shape.periods).toEqual([]);
    expect(shape.days).toEqual([]);
    expect(shape.cells.size).toBe(0);
  });

  it('two slots colliding on the same day+period resolve deterministically by greater id, independent of array order', () => {
    // The DB can hand back two ACTIVE slots for the same (day, period) across
    // an academic-year boundary. GridSlot carries no effectiveFrom/
    // academicYearId to break the tie meaningfully, so buildGrid resolves by
    // the lexicographically greater `id` — see the doc comment on buildGrid.
    // Assert BOTH input orders resolve to the same winner, proving the
    // resolution is order-independent rather than an accidental
    // last-write-wins.
    const lo = slot({ id: 'aaa-slot', dayOfWeek: 1, periodId: 'per-1', subjectName: 'Old Year' });
    const hi = slot({ id: 'zzz-slot', dayOfWeek: 1, periodId: 'per-1', subjectName: 'New Year' });

    const shapeLoFirst = buildGrid([lo, hi]);
    const shapeHiFirst = buildGrid([hi, lo]);

    expect(shapeLoFirst.cells.get(cellKey(1, 'per-1'))).toBe(hi);
    expect(shapeHiFirst.cells.get(cellKey(1, 'per-1'))).toBe(hi);
  });

  it('a slot whose period has no startTime/endTime still gets a row and does not render "undefined"', () => {
    const s = slot({ id: 's1', dayOfWeek: 1, periodId: 'per-1' });
    delete s.startTime;
    delete s.endTime;

    const shape = buildGrid([s]);

    expect(shape.periods).toHaveLength(1);
    expect(shape.periods[0].startTime).toBeUndefined();
    expect(shape.periods[0].endTime).toBeUndefined();
    // Never coerced to the string "undefined".
    expect(JSON.stringify(shape.periods[0])).not.toContain('"undefined"');
  });
});

/**
 * Pure shaping helpers for the week timetable grid. No React, no `Date` — the
 * page reads the clock and passes plain numbers/ids down; this module only
 * ever sees data it's given, so it's testable without rendering or faking
 * time.
 */

export interface GridSlot {
  id: string;
  dayOfWeek: number; // 1 = Mon … 7 = Sun
  periodId: string;
  periodLabel: string;
  startTime?: string;
  endTime?: string;
  periodOrder: number;
  /** "7-B" */
  className: string;
  subjectName: string;
}

export interface GridPeriodRow {
  id: string;
  label: string;
  startTime?: string;
  endTime?: string;
  order: number;
}

export interface GridShape {
  /** Period rows, ascending by order, deduped across the week. */
  periods: GridPeriodRow[];
  /** Day columns actually in use, ascending. Empty weekend days are dropped. */
  days: number[];
  /** Lookup: `${dayOfWeek}:${periodId}` -> slot. */
  cells: Map<string, GridSlot>;
}

export function cellKey(dayOfWeek: number, periodId: string): string {
  return `${dayOfWeek}:${periodId}`;
}

/**
 * Shapes a flat slot list into a grid.
 *
 * Collision resolution: the timetable is versioned (see
 * `TimetableService.assign`), and although each version window is meant to
 * be exclusive, the DB does not enforce a single ACTIVE row per
 * (day, period) *across* academic years — two slots can legitimately collide
 * on the same `day:period` key at a year boundary. `GridSlot` carries no
 * `effectiveFrom`/`academicYearId` (those are stripped before this layer, by
 * design — this is a view model, not the wire shape), so there is no
 * "more current" signal to resolve by. Rather than let the winner depend on
 * whatever order the caller's array happens to be in (accidental
 * last-write-wins), resolution here is explicit and order-independent: the
 * slot with the lexicographically greater `id` wins. Same input set, same
 * winner, regardless of array order — see the "order independence" case in
 * timetable-grid.test.ts.
 */
export function buildGrid(slots: GridSlot[]): GridShape {
  const periodsById = new Map<string, GridPeriodRow>();
  const days = new Set<number>();
  const cells = new Map<string, GridSlot>();

  for (const slot of slots) {
    if (!periodsById.has(slot.periodId)) {
      periodsById.set(slot.periodId, {
        id: slot.periodId,
        label: slot.periodLabel,
        startTime: slot.startTime,
        endTime: slot.endTime,
        order: slot.periodOrder,
      });
    }

    days.add(slot.dayOfWeek);

    const key = cellKey(slot.dayOfWeek, slot.periodId);
    const existing = cells.get(key);
    if (!existing || slot.id > existing.id) {
      cells.set(key, slot);
    }
  }

  const periods = Array.from(periodsById.values()).sort((a, b) => a.order - b.order);
  const sortedDays = Array.from(days).sort((a, b) => a - b);

  return { periods, days: sortedDays, cells };
}

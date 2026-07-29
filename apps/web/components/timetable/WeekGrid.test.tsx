import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { buildGrid, type GridSlot } from '@/lib/timetable-grid';
import { WeekGrid } from './WeekGrid';

function slot(overrides: Partial<GridSlot> & Pick<GridSlot, 'id' | 'dayOfWeek' | 'periodId'>): GridSlot {
  return {
    periodLabel: 'Period 1',
    periodOrder: 1,
    className: '7-B',
    subjectName: 'Mathematics',
    startTime: '08:00',
    endTime: '08:45',
    ...overrides,
  };
}

const TWO_DAY_SLOTS: GridSlot[] = [
  slot({ id: 's1', dayOfWeek: 1, periodId: 'per-1', periodLabel: 'Period 1', periodOrder: 1, className: '7-B', subjectName: 'Mathematics' }),
  slot({ id: 's2', dayOfWeek: 3, periodId: 'per-1', periodLabel: 'Period 1', periodOrder: 1, className: '8-A', subjectName: 'Science' }),
  slot({ id: 's3', dayOfWeek: 1, periodId: 'per-2', periodLabel: 'Period 2', periodOrder: 2, className: '7-B', subjectName: 'English', startTime: '08:50', endTime: '09:35' }),
  // Monday period 2 has no slot for day 3 -> free period on day 3.
];

describe('WeekGrid', () => {
  it('renders one row per period and one column per day', () => {
    const shape = buildGrid(TWO_DAY_SLOTS);
    render(<WeekGrid shape={shape} todayDayOfWeek={null} currentPeriodId={null} />);

    // Two period rows in tbody + one header row.
    expect(screen.getAllByRole('row')).toHaveLength(shape.periods.length + 1);
    // One day header per day column (plus the "Period" label header).
    expect(screen.getByTestId('day-header-1')).toBeInTheDocument();
    expect(screen.getByTestId('day-header-3')).toBeInTheDocument();
    expect(screen.queryByTestId('day-header-2')).not.toBeInTheDocument();
  });

  it('a cell shows class and subject', () => {
    const shape = buildGrid(TWO_DAY_SLOTS);
    render(<WeekGrid shape={shape} todayDayOfWeek={null} currentPeriodId={null} />);

    const cell = screen.getByTestId('cell-1-per-1');
    expect(cell).toHaveTextContent('7-B');
    expect(cell).toHaveTextContent('Mathematics');
  });

  it('a day with no slot in a period renders the free-period state', () => {
    const shape = buildGrid(TWO_DAY_SLOTS);
    render(<WeekGrid shape={shape} todayDayOfWeek={null} currentPeriodId={null} />);

    // Day 3, period 2 has no slot.
    const cell = screen.getByTestId('cell-3-per-2');
    expect(cell.querySelector('.sk-tt-free')).not.toBeNull();
    expect(cell).toHaveTextContent('Free');
  });

  it('todayDayOfWeek tints that column and no other', () => {
    const shape = buildGrid(TWO_DAY_SLOTS);
    render(<WeekGrid shape={shape} todayDayOfWeek={1} currentPeriodId={null} />);

    expect(screen.getByTestId('day-header-1')).toHaveAttribute('data-today', 'true');
    expect(screen.getByTestId('day-header-3')).toHaveAttribute('data-today', 'false');
    expect(screen.getByTestId('cell-1-per-1')).toHaveAttribute('data-today', 'true');
    expect(screen.getByTestId('cell-3-per-1')).toHaveAttribute('data-today', 'false');
  });

  it('currentPeriodId fills exactly one cell, and only in today\'s column', () => {
    const shape = buildGrid(TWO_DAY_SLOTS);
    render(<WeekGrid shape={shape} todayDayOfWeek={1} currentPeriodId="per-1" />);

    // Today (day 1), period 1: current.
    const todayCell = screen.getByTestId('cell-1-per-1').querySelector('.sk-tt-cell');
    expect(todayCell).toHaveAttribute('data-current', 'true');

    // Same period, different day (day 3): not current, even though periodId matches.
    const otherDayCell = screen.getByTestId('cell-3-per-1').querySelector('.sk-tt-cell');
    expect(otherDayCell).toHaveAttribute('data-current', 'false');

    // Different period, today's column: not current.
    const otherPeriodCell = screen.getByTestId('cell-1-per-2').querySelector('.sk-tt-cell');
    expect(otherPeriodCell).toHaveAttribute('data-current', 'false');
  });

  it('edge: todayDayOfWeek null renders the grid with nothing tinted', () => {
    const shape = buildGrid(TWO_DAY_SLOTS);
    render(<WeekGrid shape={shape} todayDayOfWeek={null} currentPeriodId="per-1" />);

    expect(screen.getByTestId('day-header-1')).toHaveAttribute('data-today', 'false');
    expect(screen.getByTestId('day-header-3')).toHaveAttribute('data-today', 'false');
    expect(screen.getByTestId('cell-1-per-1').querySelector('.sk-tt-cell')).toHaveAttribute('data-current', 'false');
  });

  it('edge: currentPeriodId naming a period that exists but on a day that is not today fills nothing', () => {
    const shape = buildGrid(TWO_DAY_SLOTS);
    // Today is day 3, but the "current" period (per-1) only has a slot filled
    // in on day 1 and day 3 both — check day 1's cell for that period is not
    // marked current since today is day 3.
    render(<WeekGrid shape={shape} todayDayOfWeek={3} currentPeriodId="per-2" />);

    // per-2 has no slot on day 3 at all (free), and day 1's per-2 cell (which
    // does have a slot) is not today's column, so nothing should be current.
    expect(screen.getByTestId('cell-1-per-2').querySelector('.sk-tt-cell')).toHaveAttribute('data-current', 'false');
    expect(screen.getByTestId('cell-3-per-2').querySelector('.sk-tt-cell')).toHaveAttribute('data-current', 'false');
  });
});

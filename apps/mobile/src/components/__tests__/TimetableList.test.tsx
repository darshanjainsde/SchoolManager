import { render, screen, within } from '@testing-library/react-native';
import { TimetableList, type TimetableRow } from '../TimetableList';
import type { GridPeriodRow, GridSlot } from '@/lib/timetable-grid';

function period(overrides: Partial<GridPeriodRow> & Pick<GridPeriodRow, 'id'>): GridPeriodRow {
  return { label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45', ...overrides };
}

function slot(overrides: Partial<GridSlot> & Pick<GridSlot, 'id' | 'periodId'>): GridSlot {
  return {
    dayOfWeek: 1,
    periodLabel: 'Period 1',
    periodOrder: 1,
    className: '7-B',
    subjectName: 'Mathematics',
    startTime: '08:00',
    endTime: '08:45',
    ...overrides,
  };
}

describe('TimetableList', () => {
  it('renders an empty-state card when there are no period rows at all', () => {
    render(<TimetableList rows={[]} currentPeriodId={null} />);
    expect(screen.getByTestId('timetable-list-empty')).toBeTruthy();
  });

  it('renders a row per period, with class and subject when a slot is present', () => {
    const rows: TimetableRow[] = [
      { period: period({ id: 'per-1' }), slot: slot({ id: 's1', periodId: 'per-1' }) },
    ];
    render(<TimetableList rows={rows} currentPeriodId={null} />);

    const row = screen.getByTestId('period-row-per-1');
    expect(within(row).getByText('7-B')).toBeTruthy();
    expect(within(row).getByText('Mathematics')).toBeTruthy();
  });

  it('renders a free-period row distinctly when no slot fills the day+period cell — a gap, not missing data', () => {
    const rows: TimetableRow[] = [{ period: period({ id: 'per-1' }), slot: null }];
    render(<TimetableList rows={rows} currentPeriodId={null} />);

    expect(screen.getByTestId('period-row-free-per-1')).toBeTruthy();
    expect(within(screen.getByTestId('period-row-per-1')).getByText('Free')).toBeTruthy();
  });

  it('shows no "undefined" text when a period has no startTime/endTime', () => {
    const rows: TimetableRow[] = [
      {
        period: { id: 'per-1', label: 'Period 1', order: 1, startTime: undefined, endTime: undefined },
        slot: slot({ id: 's1', periodId: 'per-1' }),
      },
    ];
    render(<TimetableList rows={rows} currentPeriodId={null} />);
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('fills exactly the row whose period id matches currentPeriodId, and only when it has a slot', () => {
    const rows: TimetableRow[] = [
      { period: period({ id: 'per-1' }), slot: slot({ id: 's1', periodId: 'per-1' }) },
      { period: period({ id: 'per-2', label: 'Period 2' }), slot: null }, // free, but "current"
    ];
    render(<TimetableList rows={rows} currentPeriodId="per-2" />);

    // per-1 has a slot but isn't current: no "Now" pill in its row.
    expect(within(screen.getByTestId('period-row-per-1')).queryByText('Now')).toBeNull();
    // per-2 is "current" but is a free period: the fill-only-for-a-class rule
    // (ported from apps/web/components/timetable/WeekGrid.tsx) means no "Now"
    // pill here either.
    expect(within(screen.getByTestId('period-row-per-2')).queryByText('Now')).toBeNull();
  });

  it('shows the "Now" pill on the current period when it does have a slot', () => {
    const rows: TimetableRow[] = [
      { period: period({ id: 'per-1' }), slot: slot({ id: 's1', periodId: 'per-1' }) },
      { period: period({ id: 'per-2', label: 'Period 2' }), slot: slot({ id: 's2', periodId: 'per-2' }) },
    ];
    render(<TimetableList rows={rows} currentPeriodId="per-2" />);

    expect(within(screen.getByTestId('period-row-per-1')).queryByText('Now')).toBeNull();
    expect(within(screen.getByTestId('period-row-per-2')).getByText('Now')).toBeTruthy();
  });
});

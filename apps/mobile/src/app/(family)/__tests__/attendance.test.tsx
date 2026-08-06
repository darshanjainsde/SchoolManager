import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import Attendance from '../(tabs)/attendance';
import { api, ApiError } from '@/lib/api';

let capturedFocusEffect: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    capturedFocusEffect = effect;
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

function summaryFor(month: string, days: { date: string; status: 'PRESENT' | 'ABSENT' | 'LATE' }[] = []) {
  const present = days.filter((d) => d.status === 'PRESENT').length;
  const absent = days.filter((d) => d.status === 'ABSENT').length;
  const late = days.filter((d) => d.status === 'LATE').length;
  const total = present + absent + late;
  return {
    month,
    percent: total ? Math.round((present / total) * 100) : 0,
    present,
    absent,
    late,
    days,
  };
}

it('renders the stat row and the month grid from the real AttendanceSummary shape', async () => {
  (api.request as jest.Mock).mockResolvedValue(
    summaryFor('2026-07', [
      { date: '2026-07-01', status: 'PRESENT' },
      { date: '2026-07-02', status: 'ABSENT' },
      { date: '2026-07-03', status: 'PRESENT' },
    ]),
  );

  const { findByTestId, findByText } = render(<Attendance />);

  expect(await findByTestId('stat-percent')).toHaveTextContent('67%');
  expect(await findByTestId('stat-present')).toHaveTextContent('2');
  expect(await findByTestId('stat-absent')).toHaveTextContent('1');
  expect(await findByTestId('stat-late')).toHaveTextContent('0');
  // The Recent list renders raw dates from the summary.
  expect(await findByText('2026-07-01')).toBeTruthy();
});

it('shows the stat boxes matching the summary the server returned', async () => {
  (api.request as jest.Mock).mockResolvedValue(
    summaryFor('2026-07', [
      { date: '2026-07-01', status: 'PRESENT' },
      { date: '2026-07-02', status: 'PRESENT' },
      { date: '2026-07-03', status: 'LATE' },
      { date: '2026-07-04', status: 'ABSENT' },
    ]),
  );
  const { findByTestId } = render(<Attendance />);
  expect(await findByTestId('stat-percent')).toHaveTextContent('50%'); // 2 present / 4 marked
  expect(await findByTestId('stat-present')).toHaveTextContent('2');
  expect(await findByTestId('stat-absent')).toHaveTextContent('1');
  // The reason this screen breaks out all three states rather than
  // "absent / school days": a LATE day is neither present nor absent, so a
  // two-figure row leaves it invisible and the figures stop adding up.
  expect(await findByTestId('stat-late')).toHaveTextContent('1');
});

describe('calendar is Monday-first', () => {
  // 2026-02-01 is a Sunday (UTC) — Monday-first means Sunday is the LAST
  // column, so day 1 lands at grid index 6, with 6 leading blank cells.
  it('a month starting on Sunday puts day 1 in column 7 (index 6)', async () => {
    (api.request as jest.Mock).mockResolvedValue(summaryFor('2026-02', [{ date: '2026-02-01', status: 'PRESENT' }]));
    const { findByTestId } = render(<Attendance />);

    const cell6 = await findByTestId('attn-cell-6');
    expect(within(cell6).getByTestId('attn-day-1')).toBeTruthy();
    for (let i = 0; i < 6; i++) {
      const blank = await findByTestId(`attn-cell-${i}`);
      expect(within(blank).queryByTestId('attn-day-1')).toBeNull();
    }
  });

  // 2026-06-01 is a Monday (UTC) — the opposite end: no leading blanks.
  it('a month starting on Monday puts day 1 in column 1 (index 0)', async () => {
    (api.request as jest.Mock).mockResolvedValue(summaryFor('2026-06', [{ date: '2026-06-01', status: 'ABSENT' }]));
    const { findByTestId } = render(<Attendance />);

    const cell0 = await findByTestId('attn-cell-0');
    expect(within(cell0).getByTestId('attn-day-1')).toBeTruthy();
  });
});

describe('month navigation', () => {
  it('Prev fetches the previous month and Next fetches back to the current one', async () => {
    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2026-07'));
    const { findByTestId, findByText } = render(<Attendance />);
    await findByText('July 2026');

    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2026-06'));
    fireEvent.press(await findByTestId('attendance-prev-month'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/me/attendance?month=2026-06'));
    await findByText('June 2026');

    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2026-07'));
    fireEvent.press(await findByTestId('attendance-next-month'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/me/attendance?month=2026-07'));
    await findByText('July 2026');
  });

  it('edge: navigating back from January fetches December of the PREVIOUS year', async () => {
    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2026-01'));
    const { findByTestId, findByText } = render(<Attendance />);
    await findByText('January 2026');

    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2025-12'));
    fireEvent.press(await findByTestId('attendance-prev-month'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/me/attendance?month=2025-12'));
    await findByText('December 2025');
  });

  it('edge: navigating forward from December fetches January of the NEXT year', async () => {
    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2025-12'));
    const { findByTestId, findByText } = render(<Attendance />);
    await findByText('December 2025');

    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2026-01'));
    fireEvent.press(await findByTestId('attendance-next-month'));
    await waitFor(() => expect(api.request).toHaveBeenCalledWith('/me/attendance?month=2026-01'));
    await findByText('January 2026');
  });

  it('disables Next once the shown month is the device\'s current month', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 15)); // local July 2026
    (api.request as jest.Mock).mockResolvedValue(summaryFor('2026-07'));
    const { findByTestId } = render(<Attendance />);

    const nextBtn = await findByTestId('attendance-next-month');
    expect(nextBtn.props.accessibilityState).toEqual({ disabled: true });
    jest.useRealTimers();
  });
});

it('names the month in the empty state rather than saying "this month"', async () => {
  // Prev/Next walks this screen back through the term while the captions
  // stayed on "this month", so April's figures were announced as August's.
  // A month view has to name the month it is showing.
  (api.request as jest.Mock).mockResolvedValue(summaryFor('2026-08'));
  const { findByText } = render(<Attendance />);
  expect(await findByText('No attendance recorded yet for August 2026.')).toBeTruthy();
});

describe('fetch states', () => {
  it('shows a loading state before the fetch resolves', () => {
    (api.request as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { getByText } = render(<Attendance />);
    expect(getByText('Loading attendance…')).toBeTruthy();
  });

  it('shows the API error message verbatim when the fetch fails', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
    const { findByText } = render(<Attendance />);
    expect(await findByText('Could not reach the school server.')).toBeTruthy();
  });

  it('shows a generic message when a non-ApiError rejection occurs', async () => {
    (api.request as jest.Mock).mockRejectedValue(new Error('boom'));
    const { findByText } = render(<Attendance />);
    expect(await findByText('Something went wrong.')).toBeTruthy();
  });

  it('refetches the currently-shown month on focus', async () => {
    (api.request as jest.Mock).mockResolvedValueOnce(summaryFor('2026-07'));
    const { findByText } = render(<Attendance />);
    await findByText('July 2026');

    (api.request as jest.Mock).mockResolvedValueOnce(
      summaryFor('2026-07', [{ date: '2026-07-05', status: 'PRESENT' }]),
    );
    expect(capturedFocusEffect).toBeDefined();
    await act(async () => {
      capturedFocusEffect?.();
    });

    await findByText('2026-07-05');
    // Confirms the refetch used the currently-shown month, not a bare
    // no-param request that would silently re-default server-side.
    expect(api.request).toHaveBeenLastCalledWith('/me/attendance?month=2026-07');
  });
});

import { render } from '@testing-library/react-native';
import Attendance from '../attendance';
import { api, ApiError } from '@/lib/api';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
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

it('renders the stat row and the month grid from the real AttendanceSummary shape', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    month: '2026-07',
    percent: 90,
    present: 18,
    absent: 2,
    late: 0,
    days: [
      { date: '2026-07-01', status: 'PRESENT' },
      { date: '2026-07-02', status: 'ABSENT' },
      { date: '2026-07-03', status: 'PRESENT' },
    ],
  });

  const { findByTestId, findByText } = render(<Attendance />);

  expect(await findByTestId('stat-percent')).toHaveTextContent('90%');
  expect(await findByTestId('stat-absent')).toHaveTextContent('2');
  expect(await findByTestId('stat-total')).toHaveTextContent('20'); // present+absent+late
  // The Recent list renders raw dates from the summary.
  expect(await findByText('2026-07-01')).toBeTruthy();
});

it('shows an empty state for a month with no attendance records', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    month: '2026-08',
    percent: 0,
    present: 0,
    absent: 0,
    late: 0,
    days: [],
  });

  const { findByText } = render(<Attendance />);
  expect(await findByText('No attendance recorded yet this month.')).toBeTruthy();
});

it('shows the API error message when the fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<Attendance />);
  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});

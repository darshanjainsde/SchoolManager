import { render, screen } from '@testing-library/react-native';
import Today from '../today';
import { api, ApiError } from '@/lib/api';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | void) => {
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

function attendance(overrides: Partial<{ present: number; absent: number; late: number; onLeave: number; percent: number; days: { date: string; status: string }[] }> = {}) {
  return {
    person: { id: 'staff-1', firstName: 'Sam', lastName: 'Staff', role: 'OFFICE' },
    summary: { present: 0, absent: 0, late: 0, onLeave: 0, percent: 0, days: [], ...overrides },
  };
}

it('renders a loading state while /manage/staff-attendance/mine is in flight', () => {
  (api.request as jest.Mock).mockReturnValue(new Promise(() => {}));
  render(<Today />);
  expect(screen.getByText('Loading your attendance…')).toBeTruthy();
});

it("renders the server's error message verbatim on failure", async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(403, 'Only staff can view their own attendance'));
  render(<Today />);
  expect(await screen.findByText('Only staff can view their own attendance')).toBeTruthy();
});

it('renders an explicit empty state when nothing has been marked this month', async () => {
  (api.request as jest.Mock).mockResolvedValue(attendance());
  render(<Today />);
  expect(
    await screen.findByText('No attendance has been recorded for you yet this month.'),
  ).toBeTruthy();
});

it('renders the identity greeting, stat boxes, and recent days from the real MyStaffAttendanceResult shape', async () => {
  (api.request as jest.Mock).mockResolvedValue(
    attendance({
      present: 2,
      absent: 1,
      late: 0,
      percent: 67,
      days: [
        { date: '2026-07-01', status: 'PRESENT' },
        { date: '2026-07-02', status: 'ABSENT' },
        { date: '2026-07-03', status: 'PRESENT' },
      ],
    }),
  );
  render(<Today />);

  expect(await screen.findByText('Hi, Sam')).toBeTruthy();
  expect(screen.getByText('Office staff')).toBeTruthy();
  expect(screen.getByTestId('stat-percent')).toHaveTextContent('67%');
  expect(screen.getByTestId('stat-present')).toHaveTextContent('2');
  expect(screen.getByTestId('stat-absent')).toHaveTextContent('1');
  expect(screen.getByText('2026-07-01')).toBeTruthy();
});

it('always renders the honest "leave not available yet" note — v1 has no staff-leave path', async () => {
  (api.request as jest.Mock).mockResolvedValue(attendance());
  render(<Today />);
  expect(
    await screen.findByText(/Applying for leave isn.t available here yet/),
  ).toBeTruthy();
});

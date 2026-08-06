import { render } from '@testing-library/react-native';
import Holidays from '../(tabs)/home/holidays';
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

it('renders each holiday with its day number, weekday, and type pill', async () => {
  (api.request as jest.Mock).mockResolvedValue([
    { id: 'h1', name: 'Independence Day', type: 'PUBLIC', startDate: '2026-08-15T00:00:00.000Z', endDate: null },
    { id: 'h2', name: 'Diwali', type: 'FESTIVAL', startDate: '2026-11-08T00:00:00.000Z', endDate: null },
    { id: 'h3', name: 'Founders Day', type: 'SCHOOL', startDate: '2026-09-01T00:00:00.000Z', endDate: null },
  ]);

  const { findByText } = render(<Holidays />);

  expect(await findByText('Independence Day')).toBeTruthy();
  expect(await findByText('15')).toBeTruthy();
  expect(await findByText('PUBLIC')).toBeTruthy();

  expect(await findByText('Diwali')).toBeTruthy();
  expect(await findByText('FESTIVAL')).toBeTruthy();

  expect(await findByText('Founders Day')).toBeTruthy();
  expect(await findByText('SCHOOL')).toBeTruthy();

  expect(await findByText('Configured by your school admin on the web portal.')).toBeTruthy();
});

it('shows the empty state when there are no upcoming holidays', async () => {
  (api.request as jest.Mock).mockResolvedValue([]);
  const { findByText } = render(<Holidays />);
  expect(await findByText('No upcoming holidays.')).toBeTruthy();
});

it('shows the API error message when the fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<Holidays />);
  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});

/**
 * Regression net for N3: `Holiday.type` has no DB-level enum (only
 * `@IsIn`-validated at write time), so a value the shipped UI doesn't
 * recognize is a real possibility from any other writer. The screen must
 * render the holiday (falling back to the neutral tone) instead of crashing.
 */
it('renders a holiday with an unrecognized type instead of crashing the screen', async () => {
  (api.request as jest.Mock).mockResolvedValue([
    { id: 'h1', name: 'Mystery Day', type: 'SOME_FUTURE_TYPE', startDate: '2026-08-15T00:00:00.000Z', endDate: null },
  ]);

  const { findByText } = render(<Holidays />);

  expect(await findByText('Mystery Day')).toBeTruthy();
  expect(await findByText('SOME_FUTURE_TYPE')).toBeTruthy();
});

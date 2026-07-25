import { render } from '@testing-library/react-native';
import Notices from '../notices';
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

it('renders each announcement with its scope and a relative time', async () => {
  (api.request as jest.Mock).mockResolvedValue([
    {
      id: 'a1',
      schoolId: 's1',
      classSectionId: null,
      title: 'Annual Day on Aug 12',
      body: 'Details inside',
      createdByUserId: 'u1',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    },
    {
      id: 'a2',
      schoolId: 's1',
      classSectionId: 'cs1',
      title: 'Homework reminder',
      body: 'Chapter 4',
      createdByUserId: 'u2',
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30m ago
    },
  ]);

  const { findByText } = render(<Notices />);

  expect(await findByText('Annual Day on Aug 12')).toBeTruthy();
  expect(await findByText(/Whole school · 2h ago/)).toBeTruthy();
  expect(await findByText('Homework reminder')).toBeTruthy();
  expect(await findByText(/Your class · 30m ago/)).toBeTruthy();
});

it('shows the empty state when there are no notices', async () => {
  (api.request as jest.Mock).mockResolvedValue([]);
  const { findByText } = render(<Notices />);
  expect(await findByText('No notices yet — school updates will appear here.')).toBeTruthy();
});

it('shows the API error message when the fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<Notices />);
  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});

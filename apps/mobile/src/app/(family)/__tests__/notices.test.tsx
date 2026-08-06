import { render, fireEvent, waitFor } from '@testing-library/react-native';
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

it('renders each announcement with its title, scope and a relative time', async () => {
  (api.request as jest.Mock).mockResolvedValue([
    {
      id: 'a1',
      classSectionId: null,
      title: 'Annual Day on Aug 12',
      body: 'Doors open at 5pm, students should report by 4:30pm in uniform.',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    },
    {
      id: 'a2',
      classSectionId: 'cs1',
      title: 'Homework reminder',
      body: 'Chapter 4 exercises due Friday.',
      createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30m ago
    },
  ]);

  const { findByText } = render(<Notices />);

  expect(await findByText('Annual Day on Aug 12')).toBeTruthy();
  expect(await findByText(/Whole school · 2h ago/)).toBeTruthy();
  expect(await findByText('Homework reminder')).toBeTruthy();
  expect(await findByText(/Your class · 30m ago/)).toBeTruthy();
});

// Prove-by-deletion target: S8's bug was that `a.body` was never rendered at
// all. Removing the body <Text> from notices.tsx must fail this test.
it('renders the full body of every notice, not just the title', async () => {
  (api.request as jest.Mock).mockResolvedValue([
    {
      id: 'a1',
      classSectionId: null,
      title: 'Annual Day on Aug 12',
      body: 'Doors open at 5pm, students should report by 4:30pm in uniform.',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'a2',
      classSectionId: 'cs1',
      title: 'Homework reminder',
      body: 'Chapter 4 exercises due Friday.',
      createdAt: new Date().toISOString(),
    },
  ]);

  const { findByText } = render(<Notices />);

  expect(await findByText('Doors open at 5pm, students should report by 4:30pm in uniform.')).toBeTruthy();
  expect(await findByText('Chapter 4 exercises due Friday.')).toBeTruthy();
});

it('rows are tappable: pressing one toggles its expanded state', async () => {
  (api.request as jest.Mock).mockResolvedValue([
    { id: 'a1', classSectionId: null, title: 'Annual Day on Aug 12', body: 'Details inside.', createdAt: new Date().toISOString() },
  ]);

  const { findByTestId, findByText } = render(<Notices />);

  const row = await findByTestId('notice-a1');
  expect(await findByText('Show more')).toBeTruthy();

  fireEvent.press(row);
  await waitFor(async () => expect(await findByText('Show less')).toBeTruthy());

  fireEvent.press(row);
  await waitFor(async () => expect(await findByText('Show more')).toBeTruthy());
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

it('shows a generic message when a non-ApiError rejection occurs', async () => {
  (api.request as jest.Mock).mockRejectedValue(new Error('boom'));
  const { findByText } = render(<Notices />);
  expect(await findByText('Something went wrong.')).toBeTruthy();
});

it('shows a loading state before the fetch resolves', () => {
  (api.request as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
  const { getByLabelText } = render(<Notices />);
  expect(getByLabelText('Loading notices…')).toBeTruthy();
});

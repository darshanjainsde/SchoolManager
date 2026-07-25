import { render, fireEvent, waitFor } from '@testing-library/react-native';
import Post from '../post';
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

const CLASSES = [
  { classSectionId: 'cs1', name: 'Grade 5-B', studentCount: 28 },
  { classSectionId: 'cs2', name: 'Grade 6-A', studentCount: 31 },
];

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

it('disables the submit button until a class, title and details are all filled in', async () => {
  (api.request as jest.Mock).mockResolvedValue(CLASSES);
  const { findByTestId, findByText } = render(<Post />);

  const submit = await findByTestId('post-submit');
  expect(submit.props.accessibilityState?.disabled).toBe(true);

  fireEvent.press(await findByText('Grade 5-B'));
  expect(submit.props.accessibilityState?.disabled).toBe(true); // still no title/body

  fireEvent.changeText(await findByTestId('post-title'), 'Test title');
  fireEvent.changeText(await findByTestId('post-body'), 'Test body');
  expect(submit.props.accessibilityState?.disabled).toBe(false);
});

it('posts the exact {title, body, classSectionIds} contract for the selected classes and clears the form on success', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
    if (path === '/manage/announcements') return Promise.resolve([]);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, findByText, queryByText } = render(<Post />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByText('Grade 6-A'));
  fireEvent.changeText(await findByTestId('post-title'), 'PTM this Saturday');
  fireEvent.changeText(await findByTestId('post-body'), 'Please attend at 10 AM.');

  const submit = await findByTestId('post-submit');
  expect(await findByText('Post to 2 classes')).toBeTruthy();
  fireEvent.press(submit);

  await waitFor(() => expect(queryByText('Posted ✓')).toBeTruthy());

  const postCall = (api.request as jest.Mock).mock.calls.find(([path]) => path === '/manage/announcements');
  expect(postCall[1]).toEqual({
    method: 'POST',
    body: {
      title: 'PTM this Saturday',
      body: 'Please attend at 10 AM.',
      classSectionIds: ['cs1', 'cs2'],
    },
  });

  // Form clears and re-disables after a successful post.
  expect(await findByText('Post to 0 classes')).toBeTruthy();
});

it('shows the API error message when posting fails', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/attendance/my-classes') return Promise.resolve(CLASSES);
    if (path === '/manage/announcements') return Promise.reject(new ApiError(403, 'You can only announce to your own class sections'));
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, findByText } = render(<Post />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.changeText(await findByTestId('post-title'), 'T');
  fireEvent.changeText(await findByTestId('post-body'), 'B');
  fireEvent.press(await findByTestId('post-submit'));

  expect(await findByText('You can only announce to your own class sections')).toBeTruthy();
});

it('shows an empty state when the teacher has no classes', async () => {
  (api.request as jest.Mock).mockResolvedValue([]);
  const { findByText } = render(<Post />);

  expect(await findByText(/no classes assigned/i)).toBeTruthy();
});

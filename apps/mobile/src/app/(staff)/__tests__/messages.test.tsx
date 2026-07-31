import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import StaffMessages from '../messages';
import { api, ApiError } from '@/lib/api';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const THREAD_OLD = {
  id: 'th-old',
  studentId: 'stu1',
  studentName: 'Aarav',
  teacherId: 't1',
  teacherName: 'Ms Rao',
  subjectId: 's1',
  subjectName: 'Mathematics',
  lastMessageAt: '2026-07-01T09:00:00.000Z',
  lastMessagePreview: 'Thank you',
  unreadCount: 0,
};
const THREAD_NEW = {
  id: 'th-new',
  studentId: 'stu2',
  studentName: 'Diya',
  teacherId: 't1',
  teacherName: 'Ms Rao',
  subjectId: 's1',
  subjectName: 'Mathematics',
  lastMessageAt: '2026-07-20T09:00:00.000Z',
  lastMessagePreview: 'I have a doubt',
  unreadCount: 3,
};

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  mockPush.mockReset();
});

it('renders the teacher’s threads newest-first with the unread badge', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/messages') return Promise.resolve([THREAD_OLD, THREAD_NEW]);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByTestId, getByText, toJSON } = render(<StaffMessages />);

  await findByTestId('thread-th-new');
  expect(getByText('Diya')).toBeTruthy();
  expect(getByText('Aarav')).toBeTruthy();

  const tree = JSON.stringify(toJSON());
  expect(tree.indexOf('thread-th-new')).toBeLessThan(tree.indexOf('thread-th-old'));

  const badge = await findByTestId('thread-unread-th-new');
  expect(within(badge).getByText('3')).toBeTruthy();
});

it('opens a thread when a row is tapped', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/messages') return Promise.resolve([THREAD_NEW]);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByTestId } = render(<StaffMessages />);
  fireEvent.press(await findByTestId('thread-th-new'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(staff)/messages/th-new'));
});

it('shows an empty state when the teacher has no threads', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/messages') return Promise.resolve([]);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByText } = render(<StaffMessages />);
  expect(await findByText('No student questions yet.')).toBeTruthy();
});

it('shows the API error message verbatim when the thread list fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Messages service is unavailable'));
  const { findByTestId } = render(<StaffMessages />);
  const err = await findByTestId('threads-error');
  expect(err.props.children).toBe('Messages service is unavailable');
});

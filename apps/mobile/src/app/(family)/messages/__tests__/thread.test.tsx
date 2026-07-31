import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import StudentThread from '../[threadId]';
import { api, ApiError } from '@/lib/api';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
  useLocalSearchParams: () => ({ threadId: 'th1' }),
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const THREAD = {
  id: 'th1',
  studentId: 'stu1',
  studentName: 'Aarav',
  teacherId: 't1',
  teacherName: 'Ms Rao',
  subjectId: 's1',
  subjectName: 'Mathematics',
  lastMessageAt: '2026-07-20T10:00:00.000Z',
  lastMessagePreview: 'Any time',
  unreadCount: 0,
};
const DETAIL = {
  thread: THREAD,
  messages: [
    { id: 'm1', senderRole: 'STUDENT', body: 'When is the test?', createdAt: '2026-07-20T09:00:00.000Z', readAt: '2026-07-20T09:30:00.000Z' },
    { id: 'm2', senderRole: 'TEACHER', body: 'Next Monday', createdAt: '2026-07-20T10:00:00.000Z', readAt: null },
  ],
};

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

it('loads the thread and renders its messages chronologically', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/me/messages/th1') return Promise.resolve(DETAIL);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByTestId } = render(<StudentThread />);

  const m1 = await findByTestId('message-m1');
  expect(within(m1).getByText('When is the test?')).toBeTruthy();
  const m2 = await findByTestId('message-m2');
  expect(within(m2).getByText('Next Monday')).toBeTruthy();
  // The teacher's reply is attributed to the teacher, the student's own to "You".
  expect(within(m2).getByText('Ms Rao')).toBeTruthy();
  expect(within(m1).getByText('You')).toBeTruthy();
});

it('sends a reply as the exact {teacherId, subjectId, body} contract and clears the input', async () => {
  const next = {
    ...DETAIL,
    messages: [...DETAIL.messages, { id: 'm3', senderRole: 'STUDENT', body: 'Thanks!', createdAt: '2026-07-20T11:00:00.000Z', readAt: null }],
  };
  const request = jest.fn().mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/me/messages/th1') return Promise.resolve(DETAIL);
    if (path === '/me/messages' && init?.method === 'POST') return Promise.resolve(next);
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId } = render(<StudentThread />);
  const input = await findByTestId('reply-body');
  fireEvent.changeText(input, '  Thanks!  ');
  fireEvent.press(await findByTestId('reply-send'));

  await waitFor(() => {
    const post = request.mock.calls.find(([p, init]) => p === '/me/messages' && init?.method === 'POST');
    expect(post[1]).toEqual({ method: 'POST', body: { teacherId: 't1', subjectId: 's1', body: 'Thanks!' } });
  });
  await findByTestId('message-m3');
  expect((await findByTestId('reply-body')).props.value).toBe('');
});

it('shows an empty state for a thread with no messages', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/me/messages/th1') return Promise.resolve({ thread: THREAD, messages: [] });
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByText } = render(<StudentThread />);
  expect(await findByText('No messages in this conversation yet.')).toBeTruthy();
});

it('shows the API error message verbatim when the thread fails to load', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(404, 'Conversation not found'));
  const { findByTestId } = render(<StudentThread />);
  const err = await findByTestId('thread-error');
  expect(err.props.children).toBe('Conversation not found');
});

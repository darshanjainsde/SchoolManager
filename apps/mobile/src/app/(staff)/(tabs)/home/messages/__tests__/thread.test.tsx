import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import StaffThread from '../[threadId]';
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
  lastMessagePreview: 'When is the test?',
  unreadCount: 0,
};
const DETAIL = {
  thread: THREAD,
  messages: [
    { id: 'm1', senderRole: 'STUDENT', body: 'When is the test?', createdAt: '2026-07-20T09:00:00.000Z', readAt: null },
  ],
};

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

it('loads the thread and shows the student’s question', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/messages/th1') return Promise.resolve(DETAIL);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByTestId } = render(<StaffThread />);

  const m1 = await findByTestId('message-m1');
  expect(within(m1).getByText('When is the test?')).toBeTruthy();
  // The student's message is attributed to the student, not "You".
  expect(within(m1).getByText('Aarav')).toBeTruthy();
});

it('replies with the exact { body } contract to /manage/messages/:threadId and clears the input', async () => {
  const next = {
    ...DETAIL,
    messages: [...DETAIL.messages, { id: 'm2', senderRole: 'TEACHER', body: 'Next Monday', createdAt: '2026-07-20T10:00:00.000Z', readAt: null }],
  };
  const request = jest.fn().mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/manage/messages/th1' && init?.method === 'POST') return Promise.resolve(next);
    if (path === '/manage/messages/th1') return Promise.resolve(DETAIL);
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId } = render(<StaffThread />);
  fireEvent.changeText(await findByTestId('reply-body'), '  Next Monday  ');
  fireEvent.press(await findByTestId('reply-send'));

  await waitFor(() => {
    const post = request.mock.calls.find(([p, init]) => p === '/manage/messages/th1' && init?.method === 'POST');
    expect(post[1]).toEqual({ method: 'POST', body: { body: 'Next Monday' } });
  });
  await findByTestId('message-m2');
  expect((await findByTestId('reply-body')).props.value).toBe('');
});

it('shows an empty state for a thread with no messages', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/messages/th1') return Promise.resolve({ thread: THREAD, messages: [] });
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByText } = render(<StaffThread />);
  expect(await findByText('No messages in this conversation yet.')).toBeTruthy();
});

it('shows the API error message verbatim when the reply is rejected', async () => {
  const request = jest.fn().mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/manage/messages/th1' && init?.method === 'POST') {
      return Promise.reject(new ApiError(403, 'This conversation is not yours'));
    }
    if (path === '/manage/messages/th1') return Promise.resolve(DETAIL);
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId } = render(<StaffThread />);
  fireEvent.changeText(await findByTestId('reply-body'), 'Reply');
  fireEvent.press(await findByTestId('reply-send'));

  const err = await findByTestId('reply-error');
  expect(err.props.children).toBe('This conversation is not yours');
});

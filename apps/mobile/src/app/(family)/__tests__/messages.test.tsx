import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import Messages from '../(tabs)/home/messages';
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

const TEACHERS = [
  { teacherId: 't1', teacherName: 'Ms Rao', subjectId: 's1', subjectName: 'Mathematics' },
  { teacherId: 't2', teacherName: 'Mr Khan', subjectId: 's2', subjectName: 'Science' },
];

const THREAD_OLD = {
  id: 'th-old',
  studentId: 'stu1',
  studentName: 'Aarav',
  teacherId: 't1',
  teacherName: 'Ms Rao',
  subjectId: 's1',
  subjectName: 'Mathematics',
  lastMessageAt: '2026-07-01T09:00:00.000Z',
  lastMessagePreview: 'Thanks!',
  unreadCount: 0,
};
const THREAD_NEW = {
  id: 'th-new',
  studentId: 'stu1',
  studentName: 'Aarav',
  teacherId: 't2',
  teacherName: 'Mr Khan',
  subjectId: 's2',
  subjectName: 'Science',
  lastMessageAt: '2026-07-20T09:00:00.000Z',
  lastMessagePreview: 'See you then',
  unreadCount: 2,
};

/** Routes GET/POST /me/messages and GET /me/messages/teachers through the mock. */
function mockApi(routes: {
  threads?: unknown[] | Error;
  teachers?: unknown[] | Error;
  postResult?: unknown;
}) {
  return jest.fn().mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/me/messages' && init?.method === 'POST') {
      return Promise.resolve(routes.postResult);
    }
    if (path === '/me/messages') {
      if (routes.threads instanceof Error) return Promise.reject(routes.threads);
      return Promise.resolve(routes.threads ?? []);
    }
    if (path === '/me/messages/teachers') {
      if (routes.teachers instanceof Error) return Promise.reject(routes.teachers);
      return Promise.resolve(routes.teachers ?? TEACHERS);
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  mockPush.mockReset();
});

it('renders the thread list newest-first with the unread badge', async () => {
  // Supplied oldest-first; the screen must reorder newest-first.
  (api.request as jest.Mock).mockImplementation(mockApi({ threads: [THREAD_OLD, THREAD_NEW] }));
  const { findByTestId, getByText, queryByTestId, toJSON } = render(<Messages />);

  await findByTestId('thread-th-new');
  expect(getByText('Mr Khan')).toBeTruthy();
  expect(getByText('Ms Rao')).toBeTruthy();

  // Newest thread (th-new, 2026-07-20) renders above the older one (th-old, 2026-07-01).
  const tree = JSON.stringify(toJSON());
  expect(tree.indexOf('thread-th-new')).toBeLessThan(tree.indexOf('thread-th-old'));

  // Unread badge shows the count for the thread with unread messages, not the read one.
  const badge = await findByTestId('thread-unread-th-new');
  expect(within(badge).getByText('2')).toBeTruthy();
  expect(queryByTestId('thread-unread-th-old')).toBeNull();
});

it('shows an empty state when there are no threads', async () => {
  (api.request as jest.Mock).mockImplementation(mockApi({ threads: [] }));
  const { findByText } = render(<Messages />);
  expect(await findByText(/No messages yet/)).toBeTruthy();
});

it('shows the API error message verbatim when the thread list fails', async () => {
  (api.request as jest.Mock).mockImplementation(
    mockApi({ threads: new ApiError(500, 'Messages service is unavailable') }),
  );
  const { findByTestId } = render(<Messages />);
  const err = await findByTestId('threads-error');
  expect(err.props.children).toBe('Messages service is unavailable');
});

it('ask-a-teacher: picks a teacher+subject, POSTs the exact body, and opens the new thread', async () => {
  const detail = {
    thread: { ...THREAD_NEW, id: 'th-created' },
    messages: [{ id: 'm1', senderRole: 'STUDENT', body: 'What is on the test?', createdAt: '2026-07-20T09:00:00.000Z', readAt: null }],
  };
  const request = mockApi({ threads: [], teachers: TEACHERS, postResult: detail });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId } = render(<Messages />);

  fireEvent.press(await findByTestId('ask-teacher'));
  fireEvent.press(await findByTestId('teacher-option-t2-s2'));
  fireEvent.changeText(await findByTestId('compose-body'), '  What is on the test?  ');
  fireEvent.press(await findByTestId('compose-send'));

  await waitFor(() => {
    const post = (api.request as jest.Mock).mock.calls.find(
      ([p, init]) => p === '/me/messages' && init?.method === 'POST',
    );
    expect(post).toBeDefined();
    expect(post[1]).toEqual({
      method: 'POST',
      body: { teacherId: 't2', subjectId: 's2', body: 'What is on the test?' },
    });
  });
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/messages/th-created'));
});

it('ask-a-teacher: shows an empty state when no subject teachers are assigned', async () => {
  (api.request as jest.Mock).mockImplementation(mockApi({ threads: [], teachers: [] }));
  const { findByTestId } = render(<Messages />);
  fireEvent.press(await findByTestId('ask-teacher'));
  expect(await findByTestId('no-teachers')).toBeTruthy();
});

it('ask-a-teacher: shows the server error verbatim when the send is rejected', async () => {
  const request = jest.fn().mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/me/messages' && init?.method === 'POST') {
      return Promise.reject(new ApiError(403, 'This teacher does not teach you this subject'));
    }
    if (path === '/me/messages') return Promise.resolve([]);
    if (path === '/me/messages/teachers') return Promise.resolve(TEACHERS);
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId } = render(<Messages />);
  fireEvent.press(await findByTestId('ask-teacher'));
  fireEvent.press(await findByTestId('teacher-option-t1-s1'));
  fireEvent.changeText(await findByTestId('compose-body'), 'Hello');
  fireEvent.press(await findByTestId('compose-send'));

  const err = await findByTestId('send-error');
  expect(err.props.children).toBe('This teacher does not teach you this subject');
});

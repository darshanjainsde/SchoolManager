import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import Assignments from '../assignments';
import { api, ApiError } from '@/lib/api';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
async function settled(assertion: () => void) {
  await flush();
  await waitFor(assertion, { timeout: 8000 });
}

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
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
  { classSectionId: 'cs1', name: 'Grade 5-B', studentCount: 28, covering: false },
  { classSectionId: 'cs2', name: 'Grade 6-A', studentCount: 31, covering: true },
];
const SUBJECTS = [
  { id: 'sub1', code: 'MATH', name: 'Mathematics' },
  { id: 'sub2', code: 'ENG', name: 'English' },
];
const ASSIGNMENT = {
  id: 'a1',
  classSectionId: 'cs1',
  subjectId: 'sub1',
  title: 'Worksheet 3',
  instructions: 'Do questions 1-10.',
  dueDate: '2026-08-10',
  attachments: [],
  createdByTeacherId: 'u1',
  createdAt: '2026-07-01T00:00:00.000Z',
  seenCount: 4,
};
const PAST_ASSIGNMENT = { ...ASSIGNMENT, id: 'a0', title: 'Worksheet 0', dueDate: '2020-01-01', seenCount: 12 };

function mockApi(opts: {
  classes?: unknown;
  subjects?: unknown;
  list?: { upcoming: unknown[]; past: unknown[] };
  createResult?: unknown;
  deleteResult?: unknown;
}) {
  (api.request as jest.Mock).mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/manage/attendance/my-classes') return Promise.resolve(opts.classes ?? CLASSES);
    if (path === '/manage/subjects') return Promise.resolve(opts.subjects ?? SUBJECTS);
    if (path.startsWith('/manage/assignments?classSectionId=')) {
      return Promise.resolve(opts.list ?? { upcoming: [], past: [] });
    }
    if (path === '/manage/assignments') {
      if (opts.createResult instanceof Error) return Promise.reject(opts.createResult);
      return Promise.resolve(opts.createResult ?? ASSIGNMENT);
    }
    if (path.startsWith('/manage/assignments/') && init?.method === 'DELETE') {
      if (opts.deleteResult instanceof Error) return Promise.reject(opts.deleteResult);
      return Promise.resolve(opts.deleteResult ?? { ok: true });
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  mockPush.mockReset();
});

it('offers only owned (non-covering) classes — Grade 6-A is covering-only and must not appear (prove by deletion: dropping the filter would show it)', async () => {
  mockApi({});
  const { findByText, queryByText } = render(<Assignments />);

  await findByText('Grade 5-B');
  expect(queryByText('Grade 6-A')).toBeNull();
});

it('does not show the post form until a class is picked', async () => {
  mockApi({});
  const { findByText, queryByTestId } = render(<Assignments />);
  await findByText('Grade 5-B');
  expect(queryByTestId('assign-submit')).toBeNull();
});

it('blocks submit until subject, title, instructions and due date are all set, and fires no request', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Assignments />);

  fireEvent.press(await findByText('Grade 5-B'));
  const submit = await findByTestId('assign-submit');
  // Due date defaults to today, but subject/title/instructions are still empty.
  expect(submit.props.accessibilityState?.disabled).toBe(true);

  fireEvent.press(await findByTestId('subject-sub1'));
  expect(submit.props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(await findByTestId('assign-title'), 'Worksheet 3');
  expect(submit.props.accessibilityState?.disabled).toBe(true); // still no instructions

  fireEvent.changeText(await findByTestId('assign-instructions'), 'Do questions 1-10.');
  expect(submit.props.accessibilityState?.disabled).toBe(false);

  await flush();
  const postCalls = (api.request as jest.Mock).mock.calls.filter(([p]) => p === '/manage/assignments');
  expect(postCalls.length).toBe(0);
});

it('posts an assignment with no attachments field (mobile v1 has no file picker) and shows a success toast', async () => {
  mockApi({});
  const { findByText, findByTestId } = render(<Assignments />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId('subject-sub1'));
  fireEvent.changeText(await findByTestId('assign-title'), 'Worksheet 3');
  fireEvent.changeText(await findByTestId('assign-instructions'), 'Do questions 1-10.');
  fireEvent.press(await findByTestId('assign-submit'));

  await settled(() => expect(api.request).toHaveBeenCalledWith('/manage/assignments', expect.anything()));
  const call = (api.request as jest.Mock).mock.calls.find(([p]) => p === '/manage/assignments');
  expect(call[1].method).toBe('POST');
  expect(call[1].body).toMatchObject({
    classSectionId: 'cs1',
    subjectId: 'sub1',
    title: 'Worksheet 3',
    instructions: 'Do questions 1-10.',
  });
  expect('attachments' in call[1].body).toBe(false);

  expect(await findByTestId('post-success')).toBeTruthy();
});

it('shows the note that attachments come from the web portal', async () => {
  mockApi({});
  const { findByText } = render(<Assignments />);
  fireEvent.press(await findByText('Grade 5-B'));
  expect(await findByText(/attach files from the web portal/i)).toBeTruthy();
});

it('shows the server error message verbatim on a failed post', async () => {
  mockApi({ createResult: new ApiError(403, 'You can only post an assignment for your own classes.') });
  const { findByText, findByTestId } = render(<Assignments />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId('subject-sub1'));
  fireEvent.changeText(await findByTestId('assign-title'), 'Worksheet 3');
  fireEvent.changeText(await findByTestId('assign-instructions'), 'Do questions 1-10.');
  fireEvent.press(await findByTestId('assign-submit'));

  expect(await findByText('You can only post an assignment for your own classes.')).toBeTruthy();
});

it('splits assignments into upcoming and past groups, each showing its seen-count', async () => {
  mockApi({ list: { upcoming: [ASSIGNMENT], past: [PAST_ASSIGNMENT] } });
  const { findByText, findByTestId } = render(<Assignments />);

  fireEvent.press(await findByText('Grade 5-B'));

  expect(await findByTestId('assignment-a1')).toBeTruthy();
  expect(await findByTestId('assignment-a0')).toBeTruthy();
  expect(await findByText('Upcoming')).toBeTruthy();
  expect(await findByText('Past')).toBeTruthy();
  expect(await findByText(/4 seen/)).toBeTruthy();
  expect(await findByText(/12 seen/)).toBeTruthy();
});

it('shows an empty state when the class has no assignments yet', async () => {
  mockApi({ list: { upcoming: [], past: [] } });
  const { findByText } = render(<Assignments />);

  fireEvent.press(await findByText('Grade 5-B'));

  expect(await findByText(/no assignments for this class yet/i)).toBeTruthy();
});

it('deleting an assignment asks for confirmation before calling DELETE', async () => {
  mockApi({ list: { upcoming: [ASSIGNMENT], past: [] } });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const { findByText, findByTestId } = render(<Assignments />);

  fireEvent.press(await findByText('Grade 5-B'));
  fireEvent.press(await findByTestId('delete-a1'));

  expect(alertSpy).toHaveBeenCalledWith(
    'Delete this assignment?',
    '"Worksheet 3" will be removed for the class.',
    expect.any(Array),
  );
  expect(api.request).not.toHaveBeenCalledWith('/manage/assignments/a1', expect.objectContaining({ method: 'DELETE' }));
});

it('confirming the delete calls DELETE and refetches the list', async () => {
  mockApi({ list: { upcoming: [ASSIGNMENT], past: [] } });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    const confirm = buttons?.find((b) => b.text === 'Yes, delete');
    confirm?.onPress?.();
  });

  const { findByText, findByTestId } = render(<Assignments />);
  fireEvent.press(await findByText('Grade 5-B'));
  await findByTestId('assignment-a1');

  const callsBefore = (api.request as jest.Mock).mock.calls.filter(
    ([p]) => typeof p === 'string' && p.startsWith('/manage/assignments?classSectionId='),
  ).length;

  fireEvent.press(await findByTestId('delete-a1'));

  await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/assignments/a1', { method: 'DELETE' }));

  await waitFor(() => {
    const callsAfter = (api.request as jest.Mock).mock.calls.filter(
      ([p]) => typeof p === 'string' && p.startsWith('/manage/assignments?classSectionId='),
    ).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});

it('shows the server message verbatim when a delete is rejected', async () => {
  mockApi({
    list: { upcoming: [ASSIGNMENT], past: [] },
    deleteResult: new ApiError(403, 'You can only delete assignments for your own classes.'),
  });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    const confirm = buttons?.find((b) => b.text === 'Yes, delete');
    confirm?.onPress?.();
  });

  const { findByText, findByTestId } = render(<Assignments />);
  fireEvent.press(await findByText('Grade 5-B'));
  await findByTestId('assignment-a1');
  fireEvent.press(await findByTestId('delete-a1'));

  expect(await findByText('You can only delete assignments for your own classes.')).toBeTruthy();
});

import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ClassNotesHistory from '../[classSectionId]';
import { api } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
  useLocalSearchParams: () => ({
    classSectionId: 'sec-1',
    subjectId: 'subj-maths',
    className: '8-A',
    subjectName: 'Mathematics',
  }),
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const TODAY = todayISO();
const YESTERDAY = shiftISO(TODAY, -1);

const LOG = {
  notes: [
    { id: 'n-today', body: 'Bring worksheets', createdAt: `${TODAY}T03:00:00.000Z`, authorTeacherId: 't1', date: TODAY },
    { id: 'n-old', body: 'Trip consent forms', createdAt: `${YESTERDAY}T03:00:00.000Z`, authorTeacherId: 't1', date: YESTERDAY },
  ],
  todos: [
    { id: 'td-today', body: 'Collect homework', done: false, createdAt: `${TODAY}T03:00:00.000Z`, authorTeacherId: 't1', date: TODAY },
  ],
};

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

it('loads the class-log and groups notes and to-dos by day, newest first', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/class-log?')) return Promise.resolve(LOG);
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByTestId, getByText, toJSON } = render(<ClassNotesHistory />);

  await findByTestId(`day-${TODAY}`);
  expect(getByText('Today')).toBeTruthy();
  expect(getByText('Yesterday')).toBeTruthy();
  expect(getByText('Bring worksheets')).toBeTruthy();
  expect(getByText('Collect homework')).toBeTruthy();
  expect(getByText('Trip consent forms')).toBeTruthy();

  // Newest day renders above the older one.
  const tree = JSON.stringify(toJSON());
  expect(tree.indexOf(`day-${TODAY}`)).toBeLessThan(tree.indexOf(`day-${YESTERDAY}`));

  // Requests the exact class+subject contract.
  expect(api.request).toHaveBeenCalledWith(
    '/manage/class-log?classSectionId=sec-1&subjectId=subj-maths',
  );
});

it('the Note composer posts to /manage/class-notes with today’s date', async () => {
  const request = jest.fn().mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/manage/class-log?')) return Promise.resolve({ notes: [], todos: [] });
    if (path === '/manage/class-notes' && init?.method === 'POST') return Promise.resolve({ id: 'n2' });
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId, getByTestId } = render(<ClassNotesHistory />);
  await findByTestId('composer-input');
  // Note mode is the default.
  fireEvent.changeText(getByTestId('composer-input'), 'Homework due Friday');
  fireEvent.press(getByTestId('composer-add'));

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/manage/class-notes', {
      method: 'POST',
      body: { classSectionId: 'sec-1', subjectId: 'subj-maths', date: TODAY, body: 'Homework due Friday' },
    }),
  );
  expect(getByTestId('composer-input').props.value).toBe('');
});

it('the To-do composer posts to /manage/class-todos with today’s date', async () => {
  const request = jest.fn().mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/manage/class-log?')) return Promise.resolve({ notes: [], todos: [] });
    if (path === '/manage/class-todos' && init?.method === 'POST') return Promise.resolve({ id: 'td2' });
    throw new Error(`unexpected path: ${path}`);
  });
  (api.request as jest.Mock).mockImplementation(request);

  const { findByTestId, getByTestId } = render(<ClassNotesHistory />);
  await findByTestId('composer-input');
  fireEvent.press(getByTestId('composer-mode-todo'));
  fireEvent.changeText(getByTestId('composer-input'), 'Print the quiz');
  fireEvent.press(getByTestId('composer-add'));

  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/manage/class-todos', {
      method: 'POST',
      body: { classSectionId: 'sec-1', subjectId: 'subj-maths', date: TODAY, body: 'Print the quiz' },
    }),
  );
});

it('ticking a to-do PATCHes /manage/class-todos/:id with { done: true }', async () => {
  (api.request as jest.Mock).mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/manage/class-log?')) return Promise.resolve(LOG);
    if (path === '/manage/class-todos/td-today' && init?.method === 'PATCH') {
      return Promise.resolve({ id: 'td-today', done: true });
    }
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<ClassNotesHistory />);
  fireEvent.press(await findByTestId('todo-toggle-td-today'));

  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith('/manage/class-todos/td-today', {
      method: 'PATCH',
      body: { done: true },
    }),
  );
});

it('shows an empty state when the class has no notes or to-dos yet', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/class-log?')) return Promise.resolve({ notes: [], todos: [] });
    throw new Error(`unexpected path: ${path}`);
  });
  const { findByText } = render(<ClassNotesHistory />);
  expect(await findByText('Nothing here yet — add your first note or to-do below.')).toBeTruthy();
});

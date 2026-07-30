import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ClassNotesPanel } from '../ClassNotesPanel';
import { api, ApiError } from '@/lib/api';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const SUBJECT_ID = 'subj-maths';
const SUBJECT_NAME = 'Mathematics';

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

function renderPanel() {
  return render(
    <ClassNotesPanel classSectionId="sec-1" date="2026-07-29" subjectId={SUBJECT_ID} subjectName={SUBJECT_NAME} />,
  );
}

it('renders notes and to-dos returned by the API', async () => {
  (api.request as jest.Mock).mockResolvedValue({
    notes: [{ id: 'n1', body: 'Bring worksheets', createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' }],
    todos: [{ id: 'td1', body: 'Collect homework', done: false, createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' }],
  });
  renderPanel();

  expect(await screen.findByText('Bring worksheets')).toBeTruthy();
  expect(screen.getByText('Collect homework')).toBeTruthy();
});

it('names the subject in both panel headings', async () => {
  (api.request as jest.Mock).mockResolvedValue({ notes: [], todos: [] });
  renderPanel();

  expect(await screen.findByText('Notes · Mathematics')).toBeTruthy();
  expect(screen.getByText('To-dos · Mathematics')).toBeTruthy();
});

it('shows an empty state when both lists are empty', async () => {
  (api.request as jest.Mock).mockResolvedValue({ notes: [], todos: [] });
  renderPanel();

  expect(await screen.findByText('No notes yet.')).toBeTruthy();
  expect(screen.getByText('No to-dos yet.')).toBeTruthy();
});

it('requests classSectionId, date and subjectId exactly as given', async () => {
  (api.request as jest.Mock).mockResolvedValue({ notes: [], todos: [] });
  renderPanel();

  await screen.findByText('No notes yet.');
  expect(api.request).toHaveBeenCalledWith(
    `/manage/class-notes?classSectionId=sec-1&date=2026-07-29&subjectId=${SUBJECT_ID}`,
  );
});

it('adding a note posts { classSectionId, subjectId, date, body } and clears the input', async () => {
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith('/manage/class-notes?')) return Promise.resolve({ notes: [], todos: [] });
    if (path === '/manage/class-notes' && opts?.method === 'POST') return Promise.resolve({ id: 'n2' });
    throw new Error(`unexpected call: ${path}`);
  });
  renderPanel();
  await screen.findByText('No notes yet.');

  const input = screen.getByTestId('note-input');
  fireEvent.changeText(input, 'Homework due Friday');
  fireEvent.press(screen.getByTestId('note-add'));

  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith('/manage/class-notes', {
      method: 'POST',
      body: { classSectionId: 'sec-1', subjectId: SUBJECT_ID, date: '2026-07-29', body: 'Homework due Friday' },
    }),
  );
  expect(input.props.value).toBe('');
});

it('does not fire a request when submitting a whitespace-only note', async () => {
  (api.request as jest.Mock).mockResolvedValue({ notes: [], todos: [] });
  renderPanel();
  await screen.findByText('No notes yet.');

  const callsBefore = (api.request as jest.Mock).mock.calls.length;
  const input = screen.getByTestId('note-input');
  fireEvent.changeText(input, '   ');
  fireEvent.press(screen.getByTestId('note-add'));

  expect((api.request as jest.Mock).mock.calls.length).toBe(callsBefore);
});

it('ticking a to-do issues PATCH /manage/class-todos/:id with { done: true }', async () => {
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith('/manage/class-notes?')) {
      return Promise.resolve({
        notes: [],
        todos: [{ id: 'todo-1', body: 'Collect homework', done: false, createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' }],
      });
    }
    if (path === '/manage/class-todos/todo-1' && opts?.method === 'PATCH') {
      return Promise.resolve({ id: 'todo-1', done: true });
    }
    throw new Error(`unexpected call: ${path}`);
  });
  renderPanel();

  const toggle = await screen.findByTestId('todo-toggle-todo-1');
  fireEvent.press(toggle);

  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith('/manage/class-todos/todo-1', { method: 'PATCH', body: { done: true } }),
  );
});

it('a 403 under SUBJECT_TEACHERS renders the server’s explanation, not an empty log', async () => {
  // Server message verbatim, per ClassNotesService's READ_FORBIDDEN_MESSAGE.
  (api.request as jest.Mock).mockRejectedValue(
    new ApiError(403, 'These notes are visible to the teachers of this subject.'),
  );
  renderPanel();

  expect(await screen.findByText('These notes are visible to the teachers of this subject.')).toBeTruthy();
  // The critical distinction: a 403 must never look like "there's simply
  // nothing here yet" — a teacher reading "No notes yet." would have no way
  // to tell an empty log apart from one they're blocked from seeing.
  expect(screen.queryByText('No notes yet.')).toBeNull();
});

it('refetches the list after a successful add so the new note appears without a manual reload', async () => {
  const get = jest
    .fn()
    .mockResolvedValueOnce({ notes: [], todos: [] })
    .mockResolvedValueOnce({
      notes: [{ id: 'n3', body: 'New note from refetch', createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' }],
      todos: [],
    });
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith('/manage/class-notes?')) return get();
    if (path === '/manage/class-notes' && opts?.method === 'POST') return Promise.resolve({ id: 'n3' });
    throw new Error(`unexpected call: ${path}`);
  });
  renderPanel();
  await screen.findByText('No notes yet.');

  const input = screen.getByTestId('note-input');
  fireEvent.changeText(input, 'New note from refetch');
  fireEvent.press(screen.getByTestId('note-add'));

  expect(await screen.findByText('New note from refetch')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});

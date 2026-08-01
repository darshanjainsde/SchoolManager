import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { ClassLog, NoteClass } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherNotesPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function noteClass(overrides: Partial<NoteClass> = {}): NoteClass {
  return {
    classSectionId: 'sec-1',
    className: '8-A',
    subjectId: 'sub-1',
    subjectName: 'Mathematics',
    isClassTeacher: true,
    noteCount: 3,
    openTodoCount: 2,
    ...overrides,
  };
}

/** Today / yesterday as `YYYY-MM-DD`, local time — mirrors the page's own helpers. */
function iso(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * `GET /manage/note-classes` and `GET /manage/class-log` both flow through the
 * same `api.get` — route by path so each answers with its own shape rather
 * than a blanket `mockResolvedValue` that would feed the wrong data to one.
 */
function mockGet(routes: { classes?: NoteClass[] | Error; log?: ClassLog | Error }) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/manage/note-classes') {
      if (routes.classes instanceof Error) return Promise.reject(routes.classes);
      return Promise.resolve(routes.classes ?? []);
    }
    if (path.startsWith('/manage/class-log')) {
      if (routes.log instanceof Error) return Promise.reject(routes.log);
      return Promise.resolve(routes.log ?? { notes: [], todos: [] });
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderPage() {
  return renderWithProviders(
    <>
      <TeacherNotesPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherNotesPage', () => {
  it('renders a loading state while the class list is fetching', () => {
    let resolve!: (v: NoteClass[]) => void;
    const pending = new Promise<NoteClass[]>((r) => {
      resolve = r;
    });
    const api = mockApi({
      get: vi.fn().mockImplementation((path: string) => {
        if (path === '/manage/note-classes') return pending;
        return Promise.resolve({ notes: [], todos: [] });
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(screen.getByText('Loading your classes…')).toBeInTheDocument();
    resolve([]);
  });

  it('renders the server error message when the class list fails to load', async () => {
    const api = mockApi({ get: mockGet({ classes: new Error('Notes service is unavailable') }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Notes service is unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state when the teacher has no classes', async () => {
    const api = mockApi({ get: mockGet({ classes: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('No classes assigned to you yet — ask your admin.')).toBeInTheDocument();
  });

  it('renders a card per class with name · subject, counts, and the teacher-role label', async () => {
    const api = mockApi({
      get: mockGet({
        classes: [
          noteClass({ classSectionId: 'sec-1', className: '8-A', subjectName: 'Mathematics', isClassTeacher: true, noteCount: 3, openTodoCount: 2 }),
          noteClass({ classSectionId: 'sec-2', subjectId: 'sub-2', className: '9-B', subjectName: 'Science', isClassTeacher: false, noteCount: 1, openTodoCount: 0 }),
        ],
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('8-A · Mathematics')).toBeInTheDocument();
    expect(screen.getByText('9-B · Science')).toBeInTheDocument();
    // Class-teacher vs subject-teacher label.
    expect(screen.getByText('Class teacher')).toBeInTheDocument();
    expect(screen.getByText('Subject teacher')).toBeInTheDocument();
    // Counts, singularised.
    expect(screen.getByText('3 notes · 2 open to-dos')).toBeInTheDocument();
    expect(screen.getByText('1 note · 0 open to-dos')).toBeInTheDocument();
  });

  it('clicking a class loads its log from /manage/class-log and groups it by day', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({
        classes: [noteClass()],
        log: {
          notes: [
            { id: 'n1', body: 'Bright class today', createdAt: `${iso(0)}T09:00:00.000Z`, authorTeacherId: 't1', date: iso(0) },
            { id: 'n2', body: 'Covered chapter 3', createdAt: `${iso(1)}T09:00:00.000Z`, authorTeacherId: 't1', date: iso(1) },
          ],
          todos: [
            { id: 'td1', body: 'Mark homework', createdAt: `${iso(0)}T09:00:00.000Z`, authorTeacherId: 't1', date: iso(0), done: false },
          ],
        },
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    // Grouped by day, with friendly labels.
    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Yesterday')).toBeInTheDocument();
    expect(screen.getByText('Bright class today')).toBeInTheDocument();
    expect(screen.getByText('Covered chapter 3')).toBeInTheDocument();
    expect(screen.getByText('Mark homework')).toBeInTheDocument();
    // The class-log request carried both ids.
    const logPath = vi.mocked(api.get).mock.calls.map(([p]) => p).find((p) => p.startsWith('/manage/class-log'));
    expect(logPath).toContain('classSectionId=sec-1');
    expect(logPath).toContain('subjectId=sub-1');
  });

  it('shows a per-class empty state when the class has no notes yet', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    expect(await screen.findByText('Nothing here yet — add your first note or to-do above.')).toBeInTheDocument();
  });

  it('the back control returns from a class to the list', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));
    await screen.findByRole('heading', { name: '8-A · Mathematics' });

    await user.click(screen.getByRole('button', { name: '← All classes' }));

    expect(await screen.findByText('Your classes')).toBeInTheDocument();
  });

  it('Note mode posts to /manage/class-notes with today\'s date and the four fields', async () => {
    const user = userEvent.setup();
    const post = vi.fn().mockResolvedValue({ id: 'n9' });
    const api = mockApi({ get: mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } }), post });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    // Note is the default mode.
    await user.type(await screen.findByLabelText('New note'), '  Remember to collect forms  ');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/manage/class-notes', {
      classSectionId: 'sec-1',
      subjectId: 'sub-1',
      date: iso(0),
      body: 'Remember to collect forms',
    });
  });

  it('To-do mode posts to /manage/class-todos with today\'s date', async () => {
    const user = userEvent.setup();
    const post = vi.fn().mockResolvedValue({ id: 'td9' });
    const api = mockApi({ get: mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } }), post });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    await user.click(await screen.findByRole('button', { name: '✓ To-do' }));
    await user.type(screen.getByLabelText('New to-do'), 'Chase absent notes');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/manage/class-todos', {
      classSectionId: 'sec-1',
      subjectId: 'sub-1',
      date: iso(0),
      body: 'Chase absent notes',
    });
  });

  it('Add stays disabled for empty and whitespace-only input, firing no request', async () => {
    const user = userEvent.setup();
    const post = vi.fn();
    const api = mockApi({ get: mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } }), post });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    const add = await screen.findByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();

    await user.type(screen.getByLabelText('New note'), '   ');
    expect(add).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('toggling a to-do PATCHes /manage/class-todos/:id with the new done state', async () => {
    const user = userEvent.setup();
    const patch = vi.fn().mockResolvedValue({ ok: true });
    const api = mockApi({
      get: mockGet({
        classes: [noteClass()],
        log: {
          notes: [],
          todos: [
            { id: 'td1', body: 'Mark homework', createdAt: `${iso(0)}T09:00:00.000Z`, authorTeacherId: 't1', date: iso(0), done: false },
          ],
        },
      }),
      patch,
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    const todo = await screen.findByText('Mark homework');
    await user.click(within(todo.closest('label') as HTMLElement).getByRole('checkbox'));

    expect(patch).toHaveBeenCalledWith('/manage/class-todos/td1', { done: true });
  });

  it('the composer helper line changes with the selected mode', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    expect(await screen.findByText('Note = something to remember')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '✓ To-do' }));
    expect(screen.getByText('To-do = something to do — tick it off')).toBeInTheDocument();
  });

  it('caps the composer body at the length the server accepts', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));

    expect(await screen.findByLabelText('New note')).toHaveAttribute('maxLength', '1000');
    await user.click(screen.getByRole('button', { name: '✓ To-do' }));
    expect(screen.getByLabelText('New to-do')).toHaveAttribute('maxLength', '1000');
  });

  it('a successful add clears the box and refreshes the class log', async () => {
    const user = userEvent.setup();
    const post = vi.fn().mockResolvedValue({ id: 'n9' });
    const get = mockGet({ classes: [noteClass()], log: { notes: [], todos: [] } });
    const api = mockApi({ get, post });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('8-A · Mathematics'));
    await screen.findByLabelText('New note');

    const before = get.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith('/manage/class-log')).length;

    await user.type(screen.getByLabelText('New note'), 'Collect forms');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Note added')).toBeInTheDocument();
    expect(screen.getByLabelText('New note')).toHaveValue('');

    await vi.waitFor(() => {
      const after = get.mock.calls.filter((c: unknown[]) => String(c[0]).startsWith('/manage/class-log')).length;
      expect(after).toBeGreaterThan(before);
    });
  });
});

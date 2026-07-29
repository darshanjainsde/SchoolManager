import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ClassNotes } from './ClassNotes';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('ClassNotes', () => {
  it('renders notes and to-dos returned by the API', async () => {
    const api = mockApi({
      get: vi.fn().mockResolvedValue({
        notes: [{ id: 'n1', body: 'Bring worksheets', createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' }],
        todos: [
          { id: 'td1', body: 'Collect homework', done: false, createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' },
        ],
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);

    expect(await screen.findByText('Bring worksheets')).toBeInTheDocument();
    expect(screen.getByText('Collect homework')).toBeInTheDocument();
  });

  it('adding a note posts { classSectionId, date, body } and clears the input', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue({ notes: [], todos: [] }),
      post: vi.fn().mockResolvedValue({ id: 'n2' }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);
    await screen.findByText('No notes yet.');

    const input = screen.getByLabelText('Add a note');
    await user.type(input, 'Homework due Friday');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    expect(api.post).toHaveBeenCalledWith('/manage/class-notes', {
      classSectionId: 'sec-1',
      date: '2026-07-29',
      body: 'Homework due Friday',
    });
    expect(input).toHaveValue('');
  });

  it('does not fire a request when submitting a whitespace-only note', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: vi.fn().mockResolvedValue({ notes: [], todos: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);
    await screen.findByText('No notes yet.');

    const input = screen.getByLabelText('Add a note');
    await user.type(input, '   ');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    expect(api.post).not.toHaveBeenCalled();
  });

  it('ticking a to-do issues PATCH /manage/class-todos/:id with { done: true }', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue({
        notes: [],
        todos: [
          { id: 'todo-1', body: 'Collect homework', done: false, createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' },
        ],
      }),
      patch: vi.fn().mockResolvedValue({ id: 'todo-1', done: true }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);
    const checkbox = await screen.findByRole('checkbox');
    await user.click(checkbox);

    expect(api.patch).toHaveBeenCalledWith('/manage/class-todos/todo-1', { done: true });
  });

  it('shows an empty state when both lists are empty', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue({ notes: [], todos: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);

    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
    expect(screen.getByText('No to-dos yet.')).toBeInTheDocument();
  });

  it('requests classSectionId and date exactly as given', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue({ notes: [], todos: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-42" date="2026-07-29" />);
    await screen.findByText('No notes yet.');

    expect(api.get).toHaveBeenCalledWith('/manage/class-notes?classSectionId=sec-42&date=2026-07-29');
  });

  it('the To-dos card shows a loading state while the query is pending, not the empty state', async () => {
    // Resolve from a deferred we control, rather than mockResolvedValue, so
    // we can assert on the in-flight state before it ever settles.
    let resolveGet!: (value: { notes: never[]; todos: never[] }) => void;
    const pending = new Promise<{ notes: never[]; todos: never[] }>((resolve) => {
      resolveGet = resolve;
    });
    const api = mockApi({ get: vi.fn().mockReturnValue(pending) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);

    const todosCard = screen.getByText('To-dos').closest('.sk-card');
    expect(todosCard).not.toBeNull();
    expect(within(todosCard as HTMLElement).getByText('Loading…')).toBeInTheDocument();
    expect(within(todosCard as HTMLElement).queryByText('No to-dos yet.')).not.toBeInTheDocument();

    resolveGet({ notes: [], todos: [] });
    expect(await within(todosCard as HTMLElement).findByText('No to-dos yet.')).toBeInTheDocument();
  });

  it('the To-dos card shows the error message when the query rejects, not the empty state', async () => {
    const api = mockApi({ get: vi.fn().mockRejectedValue(new Error('Could not reach the notes service')) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);

    const todosCard = screen.getByText('To-dos').closest('.sk-card');
    expect(todosCard).not.toBeNull();
    expect(await within(todosCard as HTMLElement).findByText('Could not reach the notes service')).toBeInTheDocument();
    expect(within(todosCard as HTMLElement).queryByText('No to-dos yet.')).not.toBeInTheDocument();
  });

  it('refetches the list after a successful add so the new note appears without a manual reload', async () => {
    const user = userEvent.setup();
    const get = vi
      .fn()
      .mockResolvedValueOnce({ notes: [], todos: [] })
      .mockResolvedValueOnce({
        notes: [
          { id: 'n3', body: 'New note from refetch', createdAt: '2026-07-29T03:00:00.000Z', authorTeacherId: 't1' },
        ],
        todos: [],
      });
    const api = mockApi({ get, post: vi.fn().mockResolvedValue({ id: 'n3' }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<ClassNotes classSectionId="sec-1" date="2026-07-29" />);
    await screen.findByText('No notes yet.');

    const input = screen.getByLabelText('Add a note');
    await user.type(input, 'New note from refetch');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    expect(await screen.findByText('New note from refetch')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { MessageThreadRow, MessageThreadDetail, MessageRow } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherInboxPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function threadRow(overrides: Partial<MessageThreadRow> = {}): MessageThreadRow {
  return {
    id: 'thread-1',
    studentId: 'stu-1',
    studentName: 'Aarav Kapoor',
    teacherId: 'tea-1',
    teacherName: 'Ms Rao',
    subjectId: 'sub-1',
    subjectName: 'Mathematics',
    lastMessageAt: '2026-07-30T09:00:00.000Z',
    lastMessagePreview: 'When is the test?',
    unreadCount: 1,
    ...overrides,
  };
}

function message(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'msg-1',
    senderRole: 'STUDENT',
    body: 'When is the test?',
    createdAt: '2026-07-30T09:00:00.000Z',
    readAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<MessageThreadDetail> = {}): MessageThreadDetail {
  return { thread: threadRow(), messages: [message()], ...overrides };
}

/** Route the shared `api.get` by path: the thread list vs. a single thread. */
function mockGet(routes: { list?: MessageThreadRow[] | Error; detail?: MessageThreadDetail }) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/manage/messages') {
      if (routes.list instanceof Error) return Promise.reject(routes.list);
      return Promise.resolve(routes.list ?? []);
    }
    if (path.startsWith('/manage/messages/')) {
      return Promise.resolve(routes.detail ?? detail());
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderPage() {
  return renderWithProviders(
    <>
      <TeacherInboxPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
  // jsdom has no layout engine; make scrollIntoView a harmless spy.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('TeacherInboxPage', () => {
  it('shows a loading state while the thread list is fetching', () => {
    const api = mockApi({ get: vi.fn().mockReturnValue(new Promise(() => {})) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(screen.getByText('Loading your messages…')).toBeInTheDocument();
  });

  it('renders the server error message verbatim when the list fails to load', async () => {
    const api = mockApi({ get: mockGet({ list: new Error('Messages service is unavailable') }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Messages service is unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state when there are no threads', async () => {
    const api = mockApi({ get: mockGet({ list: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(
      await screen.findByText('No messages yet. Students can reach you here once they ask a question.'),
    ).toBeInTheDocument();
  });

  it('renders each thread with student name, subject, preview and an unread badge, newest first', async () => {
    const api = mockApi({
      get: mockGet({
        list: [
          threadRow({ id: 'thread-1', studentName: 'Aarav Kapoor', subjectName: 'Mathematics', unreadCount: 2 }),
          threadRow({ id: 'thread-2', studentName: 'Diya Sharma', subjectName: 'Science', unreadCount: 0 }),
        ],
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Aarav Kapoor')).toBeInTheDocument();
    expect(screen.getByText(/Mathematics · When is the test\?/)).toBeInTheDocument();
    expect(screen.getByLabelText('2 unread')).toBeInTheDocument();
    expect(screen.getByText('Diya Sharma')).toBeInTheDocument();
  });

  it('opening a thread fetches and shows its messages', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({
        list: [threadRow()],
        detail: detail({
          messages: [
            message({ id: 'm1', senderRole: 'STUDENT', body: 'When is the test?' }),
            message({ id: 'm2', senderRole: 'TEACHER', body: 'Next Monday.' }),
          ],
        }),
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('Aarav Kapoor'));

    expect(await screen.findByText('Next Monday.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/manage/messages/thread-1');
  });

  it('sending a reply POSTs exactly { body } to the thread and shows the new message', async () => {
    const user = userEvent.setup();
    const posted = detail({
      messages: [
        message({ id: 'm1', senderRole: 'STUDENT', body: 'When is the test?' }),
        message({ id: 'm2', senderRole: 'TEACHER', body: 'Next Monday, be ready.' }),
      ],
    });
    const api = mockApi({
      get: mockGet({ list: [threadRow()], detail: detail() }),
      post: vi.fn().mockResolvedValue(posted),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('Aarav Kapoor'));
    await screen.findByText('When is the test?');

    await user.type(screen.getByLabelText('Reply'), '  Next Monday, be ready.  ');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(api.post).toHaveBeenCalledWith('/manage/messages/thread-1', { body: 'Next Monday, be ready.' });
    expect(await screen.findByText('Next Monday, be ready.')).toBeInTheDocument();
  });

  it('surfaces the server message verbatim when a reply is rejected', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({ list: [threadRow()], detail: detail() }),
      post: vi.fn().mockRejectedValue(new Error('This conversation is not yours')),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('Aarav Kapoor'));
    await screen.findByText('When is the test?');

    await user.type(screen.getByLabelText('Reply'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByText('This conversation is not yours')).toBeInTheDocument();
  });

  it('caps the reply at MESSAGE_BODY_MAX', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: mockGet({ list: [threadRow()], detail: detail() }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByText('Aarav Kapoor'));

    expect(await screen.findByLabelText('Reply')).toHaveAttribute('maxLength', '2000');
  });
});

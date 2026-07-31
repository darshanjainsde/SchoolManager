import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type {
  MessageThreadRow,
  MessageThreadDetail,
  MessageRow,
  MessageableTeacher,
} from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import PortalMessagesPage from './page';

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
    lastMessagePreview: 'Next Monday.',
    unreadCount: 1,
    ...overrides,
  };
}

function message(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'msg-1',
    senderRole: 'TEACHER',
    body: 'Next Monday.',
    createdAt: '2026-07-30T09:00:00.000Z',
    readAt: null,
    ...overrides,
  };
}

function detail(overrides: Partial<MessageThreadDetail> = {}): MessageThreadDetail {
  return { thread: threadRow(), messages: [message()], ...overrides };
}

function teacher(overrides: Partial<MessageableTeacher> = {}): MessageableTeacher {
  return { teacherId: 'tea-1', teacherName: 'Ms Rao', subjectId: 'sub-1', subjectName: 'Mathematics', ...overrides };
}

/** Route the shared `api.get` — teachers picker, thread list, and one thread. */
function mockGet(routes: {
  list?: MessageThreadRow[] | Error;
  teachers?: MessageableTeacher[] | Error;
  detail?: MessageThreadDetail;
}) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/me/messages') {
      if (routes.list instanceof Error) return Promise.reject(routes.list);
      return Promise.resolve(routes.list ?? []);
    }
    if (path === '/me/messages/teachers') {
      if (routes.teachers instanceof Error) return Promise.reject(routes.teachers);
      return Promise.resolve(routes.teachers ?? []);
    }
    if (path.startsWith('/me/messages/')) {
      return Promise.resolve(routes.detail ?? detail());
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderPage() {
  return renderWithProviders(
    <>
      <PortalMessagesPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe('PortalMessagesPage', () => {
  it('shows a loading state while the thread list is fetching', () => {
    const api = mockApi({ get: vi.fn().mockReturnValue(new Promise(() => {})) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(screen.getByText('Loading messages…')).toBeInTheDocument();
  });

  it('renders the server error message verbatim when the list fails to load', async () => {
    const api = mockApi({ get: mockGet({ list: new Error('No student record for this login') }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('No student record for this login')).toBeInTheDocument();
  });

  it('renders an empty state and role-neutral copy — never "your child"', async () => {
    const api = mockApi({ get: mockGet({ list: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText(/Tap .New message. to ask a teacher a question\./)).toBeInTheDocument();
    // Shared parent/student login — copy addresses "your teacher", never "your child's teacher".
    expect(screen.getByText('Ask one of your teachers a question about a subject they teach you.')).toBeInTheDocument();
    expect(screen.queryByText(/your child/i)).not.toBeInTheDocument();
  });

  it('renders each thread with teacher name, subject and preview, newest first', async () => {
    const api = mockApi({
      get: mockGet({
        list: [
          threadRow({ id: 'thread-1', teacherName: 'Ms Rao', subjectName: 'Mathematics' }),
          threadRow({ id: 'thread-2', teacherName: 'Mr Sen', subjectName: 'Science', lastMessagePreview: 'See page 4.' }),
        ],
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Ms Rao')).toBeInTheDocument();
    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(screen.getByText('Mr Sen')).toBeInTheDocument();
    expect(screen.getByText('See page 4.')).toBeInTheDocument();
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
    await user.click(await screen.findByText('Ms Rao'));

    expect(await screen.findByText('When is the test?')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/me/messages/thread-1');
  });

  it('"New message" reveals the pick list drawn from /me/messages/teachers', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({
        list: [],
        teachers: [
          teacher({ teacherId: 'tea-1', teacherName: 'Ms Rao', subjectName: 'Mathematics' }),
          teacher({ teacherId: 'tea-2', teacherName: 'Mr Sen', subjectId: 'sub-2', subjectName: 'Science' }),
        ],
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByText(/ask a teacher a question/);
    await user.click(screen.getByRole('button', { name: /New message/ }));

    expect(await screen.findByText('Choose a teacher and subject')).toBeInTheDocument();
    expect(screen.getByText('Ms Rao')).toBeInTheDocument();
    expect(screen.getByText('Mr Sen')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/me/messages/teachers');
  });

  it('picking a teacher then sending POSTs exactly {teacherId, subjectId, body} to /me/messages', async () => {
    const user = userEvent.setup();
    const posted = detail({
      thread: threadRow({ id: 'thread-9' }),
      messages: [message({ id: 'm1', senderRole: 'STUDENT', body: 'When is the test?' })],
    });
    const api = mockApi({
      // The post-send GET refetch of the new thread returns the same detail.
      get: mockGet({ list: [], teachers: [teacher()], detail: posted }),
      post: vi.fn().mockResolvedValue(posted),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByText(/ask a teacher a question/);
    await user.click(screen.getByRole('button', { name: /New message/ }));
    await user.click(await screen.findByText('Ms Rao'));

    await user.type(screen.getByLabelText('Your message'), '  When is the test?  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(api.post).toHaveBeenCalledWith('/me/messages', {
      teacherId: 'tea-1',
      subjectId: 'sub-1',
      body: 'When is the test?',
    });
    expect(await screen.findByText('When is the test?')).toBeInTheDocument();
  });

  it('surfaces the server message verbatim when a send is rejected', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({ list: [], teachers: [teacher()] }),
      post: vi.fn().mockRejectedValue(new Error('That teacher does not teach you this subject')),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByText(/ask a teacher a question/);
    await user.click(screen.getByRole('button', { name: /New message/ }));
    await user.click(await screen.findByText('Ms Rao'));

    await user.type(screen.getByLabelText('Your message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('That teacher does not teach you this subject')).toBeInTheDocument();
  });

  it('caps the composer at MESSAGE_BODY_MAX', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: mockGet({ list: [], teachers: [teacher()] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByText(/ask a teacher a question/);
    await user.click(screen.getByRole('button', { name: /New message/ }));
    await user.click(await screen.findByText('Ms Rao'));

    expect(screen.getByLabelText('Your message')).toHaveAttribute('maxLength', '2000');
  });
});

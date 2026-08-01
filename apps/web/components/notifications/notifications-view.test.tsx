import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { NotificationListResult, NotificationRow } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { NotificationsView } from './notifications-view';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'n1',
    kind: 'MESSAGE',
    title: 'New message from Ms Rao',
    body: 'When is the test?',
    linkType: null,
    linkId: null,
    readAt: null,
    createdAt: '2026-07-30T09:00:00.000Z',
    ...overrides,
  };
}

/** Route `api.get` for the list endpoint. */
function mockGet(result: NotificationListResult | Error) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/me/notifications') {
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

function renderView(portal: 'teacher' | 'student' = 'student') {
  return renderWithProviders(
    <>
      <NotificationsView portal={portal} />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('NotificationsView', () => {
  it('shows a loading state while the list is fetching', () => {
    const api = mockApi({ get: vi.fn().mockReturnValue(new Promise(() => {})) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView();

    expect(screen.getByText('Loading notifications…')).toBeInTheDocument();
  });

  it('renders the server error verbatim when the list fails', async () => {
    const api = mockApi({ get: mockGet(new Error('No account for this login')) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView();

    expect(await screen.findByText('No account for this login')).toBeInTheDocument();
  });

  it('renders an empty state when there are no notifications', async () => {
    const api = mockApi({ get: mockGet({ notifications: [], unreadCount: 0 }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView();

    expect(await screen.findByText(/You.re all caught up/)).toBeInTheDocument();
  });

  it('groups unread under "New" and read under "Earlier"', async () => {
    const api = mockApi({
      get: mockGet({
        notifications: [
          row({ id: 'n1', title: 'Unread message', readAt: null }),
          row({ id: 'n2', kind: 'RESULT', title: 'Old result', readAt: '2026-07-29T09:00:00.000Z' }),
        ],
        unreadCount: 1,
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView();

    const newSection = (await screen.findByText('New')).closest('section')!;
    expect(within(newSection).getByText('Unread message')).toBeInTheDocument();

    const earlierSection = screen.getByText('Earlier').closest('section')!;
    expect(within(earlierSection).getByText('Old result')).toBeInTheDocument();
  });

  it('"Mark all read" posts to /me/notifications/read and clears the New group', async () => {
    const user = userEvent.setup();
    // Stateful mock: the post flips every row to read, so the post-mutation
    // refetch reflects the write the way a real server would.
    const state: NotificationRow[] = [row({ id: 'n1', title: 'Unread message' })];
    const api = mockApi({
      get: vi.fn().mockImplementation((path: string) => {
        if (path === '/me/notifications') {
          return Promise.resolve({
            notifications: state.map((n) => ({ ...n })),
            unreadCount: state.filter((n) => n.readAt === null).length,
          });
        }
        throw new Error(`unexpected path: ${path}`);
      }),
      post: vi.fn().mockImplementation((_path: string) => {
        for (const n of state) n.readAt = '2026-07-30T10:00:00.000Z';
        return Promise.resolve({ count: 1 });
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView();

    await user.click(await screen.findByRole('button', { name: 'Mark all read' }));

    expect(api.post).toHaveBeenCalledWith('/me/notifications/read', {});
    // The New heading disappears once every row is read.
    expect(await screen.findByText('Earlier')).toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });

  it('clicking an unread MESSAGE row marks it read and routes to /portal/messages for a student', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({ notifications: [row({ id: 'n1', kind: 'MESSAGE', title: 'Unread message' })], unreadCount: 1 }),
      post: vi.fn().mockResolvedValue({ count: 1 }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView('student');

    await user.click(await screen.findByText('Unread message'));

    expect(api.post).toHaveBeenCalledWith('/me/notifications/read', { ids: ['n1'] });
    expect(push).toHaveBeenCalledWith('/portal/messages');
  });

  it('clicking a MESSAGE row routes to /teacher/inbox for a teacher', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({ notifications: [row({ id: 'n1', kind: 'MESSAGE', title: 'Unread message' })], unreadCount: 1 }),
      post: vi.fn().mockResolvedValue({ count: 1 }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView('teacher');

    await user.click(await screen.findByText('Unread message'));

    expect(push).toHaveBeenCalledWith('/teacher/inbox');
  });

  it('a student REQUEST_DECISION row marks read but does not navigate (no student route)', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({
        notifications: [row({ id: 'n1', kind: 'REQUEST_DECISION', title: 'Leave decided' })],
        unreadCount: 1,
      }),
      post: vi.fn().mockResolvedValue({ count: 1 }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderView('student');

    await user.click(await screen.findByText('Leave decided'));

    expect(api.post).toHaveBeenCalledWith('/me/notifications/read', { ids: ['n1'] });
    expect(push).not.toHaveBeenCalled();
  });
});

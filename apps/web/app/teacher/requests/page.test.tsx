import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherRequestsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

/**
 * Routes GET calls by path prefix, like the attendance page test. Each prefix
 * may supply more than one response function, consumed in order — the last
 * one repeats for any call past the end — so a single test can assert on a
 * refetch returning different data.
 */
function mockGet(handlers: Array<[string, Array<() => Promise<unknown>>]>) {
  const counts = new Map<string, number>();
  return vi.fn((path: string) => {
    const hit = handlers.find(([prefix]) => path.startsWith(prefix));
    if (!hit) return Promise.reject(new Error(`Unhandled GET ${path}`));
    const [prefix, fns] = hit;
    const i = counts.get(prefix) ?? 0;
    counts.set(prefix, i + 1);
    return fns[Math.min(i, fns.length - 1)]();
  });
}

function leaveApp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'leave-1',
    type: 'SICK',
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    reason: 'Fever',
    status: 'PENDING',
    createdAt: '2026-07-29T03:00:00.000Z',
    ...overrides,
  };
}

function registerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'reg-1',
    classSectionId: 'sec-1',
    className: '8-A',
    date: '2026-07-20',
    reason: 'Late enrolment correction',
    status: 'PENDING',
    requestedByTeacherId: 't1',
    requestedByName: null,
    reviewedAt: null,
    expiresAt: null,
    createdAt: '2026-07-20T03:00:00.000Z',
    ...overrides,
  };
}

function forbidden() {
  return Object.assign(new Error('Forbidden resource'), { status: 403 });
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherRequestsPage', () => {
  it('renders a loading state while both queries are in flight', async () => {
    let resolveLeave!: (v: unknown[]) => void;
    const pending = new Promise<unknown[]>((resolve) => {
      resolveLeave = resolve;
    });
    const api = mockApi({
      get: mockGet([
        ['/manage/leave/mine', [() => pending]],
        ['/manage/register-changes/mine', [() => Promise.resolve([])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherRequestsPage />);

    expect(await screen.findByText('Loading your requests…')).toBeInTheDocument();
    resolveLeave([]);
    expect(await screen.findByText('No requests yet.')).toBeInTheDocument();
  });

  it('renders the server error message when both queries fail', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave/mine', [() => Promise.reject(new Error('Leave service is unavailable'))]],
        ['/manage/register-changes/mine', [() => Promise.reject(new Error('Leave service is unavailable'))]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherRequestsPage />);

    expect(await screen.findByText('Leave service is unavailable')).toBeInTheDocument();
    // A total failure must not also claim there is nothing to see.
    expect(screen.queryByText('No requests yet.')).not.toBeInTheDocument();
  });

  it('renders an explicit empty state when both queries succeed with nothing', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave/mine', [() => Promise.resolve([])]],
        ['/manage/register-changes/mine', [() => Promise.resolve([])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherRequestsPage />);

    expect(await screen.findByText('No requests yet.')).toBeInTheDocument();
  });

  it('both queries feed one merged list', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave/mine', [() => Promise.resolve([leaveApp()])]],
        ['/manage/register-changes/mine', [() => Promise.resolve([registerRow()])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherRequestsPage />);

    // "Sick leave" is ambiguous on its own — LeaveForm's own type <select>
    // always renders that exact label as an option, resolved or not — so
    // every assertion here is scoped to the "My requests" card.
    const card = screen.getByText('My requests').closest('.sk-card') as HTMLElement;
    expect(await within(card).findByText('8-A')).toBeInTheDocument();
    expect(within(card).getByText('Sick leave')).toBeInTheDocument();
    expect(card.querySelectorAll('.sk-row')).toHaveLength(2);
  });

  it('shows the successful data AND surfaces the failure when one query fails and the other succeeds', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave/mine', [() => Promise.reject(new Error('Leave service is unavailable'))]],
        ['/manage/register-changes/mine', [() => Promise.resolve([registerRow()])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherRequestsPage />);

    // The successful half renders...
    expect(await screen.findByText('8-A')).toBeInTheDocument();
    // ...next to an honest indication that the other half did not load.
    expect(screen.getByText('Leave service is unavailable')).toBeInTheDocument();
  });

  it('renders a "this page is for teachers" state on a 403 from both queries, not an empty queue', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave/mine', [() => Promise.reject(forbidden())]],
        ['/manage/register-changes/mine', [() => Promise.reject(forbidden())]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherRequestsPage />);

    expect(await screen.findByText(/this page is for teachers/i)).toBeInTheDocument();
    expect(screen.queryByText('No requests yet.')).not.toBeInTheDocument();
  });

  it('cancelling a leave refetches the list and the DOM reflects the new data', async () => {
    const user = userEvent.setup();
    const getLeave = vi
      .fn()
      .mockResolvedValueOnce([leaveApp({ status: 'PENDING' })])
      .mockResolvedValueOnce([leaveApp({ status: 'CANCELLED' })]);
    const api = mockApi({
      get: mockGet([
        ['/manage/leave/mine', [() => getLeave()]],
        ['/manage/register-changes/mine', [() => Promise.resolve([])]],
      ]),
      post: vi.fn().mockResolvedValue({ status: 'CANCELLED', restoredDates: 2 }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<TeacherRequestsPage />);

    // Scoped to the "My requests" card — LeaveForm's own type <select> always
    // renders the literal text "Sick leave" as an option, which would
    // otherwise make an unscoped wait resolve before the query actually has.
    const card = screen.getByText('My requests').closest('.sk-card') as HTMLElement;
    expect(await within(card).findByText('Pending')).toBeInTheDocument();
    expect(within(card).getByText('Sick leave')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /yes, cancel leave/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await within(card).findByText('Cancelled')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/manage/leave/leave-1/cancel');
  });
});

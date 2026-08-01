import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import AdminRequestsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

/**
 * Routes GET calls by path prefix (same shape as the /teacher/requests test).
 * Each prefix may supply more than one response function, consumed in order —
 * the last one repeats — so a test can assert on a refetch returning
 * different data.
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

/** `GET /manage/leave?status=PENDING` row — Prisma spread + joined teacherName. */
function leaveApp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'leave-1',
    teacherId: 't1',
    teacherName: 'Asha Verma',
    type: 'SICK',
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2026-08-03T00:00:00.000Z',
    reason: 'Fever',
    status: 'PENDING',
    createdAt: '2026-07-29T03:00:00.000Z',
    ...overrides,
  };
}

/** `GET /manage/register-changes` row — the shared RegisterChangeRow shape. */
function registerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'reg-1',
    classSectionId: 'sec-1',
    className: '8-A',
    date: '2026-07-20',
    reason: 'Late enrolment correction',
    status: 'PENDING',
    requestedByTeacherId: 't2',
    requestedByName: 'Ravi Kumar',
    reviewedAt: null,
    expiresAt: null,
    createdAt: '2026-07-20T03:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('AdminRequestsPage', () => {
  it('renders both kinds in one inbox with a pending count', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave', [() => Promise.resolve([leaveApp()])]],
        ['/manage/register-changes', [() => Promise.resolve([registerRow()])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<AdminRequestsPage />);

    expect(await screen.findByText('Asha Verma')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Leave')).toBeInTheDocument();
    expect(screen.getByText('Register change')).toBeInTheDocument();
    expect(screen.getByText(/2 pending/)).toBeInTheDocument();
    expect(document.querySelectorAll('.sk-row')).toHaveLength(2);
    // Newest first: the leave request (29 Jul) above the register change (20 Jul).
    const names = [...document.querySelectorAll('.sk-row .nm')].map((n) => n.textContent);
    expect(names).toEqual(['Asha Verma', 'Ravi Kumar']);
  });

  it('approving a leave fires the right POST and the row disappears on refetch', async () => {
    const user = userEvent.setup();
    const getLeave = vi
      .fn()
      .mockResolvedValueOnce([leaveApp()])
      .mockResolvedValue([]);
    const api = mockApi({
      get: mockGet([
        ['/manage/leave', [() => getLeave()]],
        ['/manage/register-changes', [() => Promise.resolve([registerRow()])]],
      ]),
      post: vi.fn().mockResolvedValue({ gaps: 0 }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<AdminRequestsPage />);

    const row = (await screen.findByText('Asha Verma')).closest('.sk-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Approve' }));

    expect(api.post).toHaveBeenCalledWith('/manage/leave/leave-1/approve');
    await waitFor(() => expect(screen.queryByText('Asha Verma')).not.toBeInTheDocument());
    // The other kind is untouched.
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });

  it('approving a register change fires the register-changes POST', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet([
        ['/manage/leave', [() => Promise.resolve([])]],
        ['/manage/register-changes', [() => Promise.resolve([registerRow()])]],
      ]),
      post: vi.fn().mockResolvedValue(registerRow({ status: 'APPROVED' })),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<AdminRequestsPage />);

    const row = (await screen.findByText('Ravi Kumar')).closest('.sk-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Approve' }));

    expect(api.post).toHaveBeenCalledWith('/manage/register-changes/reg-1/approve');
  });

  it('reject asks for confirmation first, and only the confirm fires the POST', async () => {
    const user = userEvent.setup();
    const getRegister = vi
      .fn()
      .mockResolvedValueOnce([registerRow()])
      .mockResolvedValue([]);
    const api = mockApi({
      get: mockGet([
        ['/manage/leave', [() => Promise.resolve([])]],
        ['/manage/register-changes', [() => getRegister()]],
      ]),
      post: vi.fn().mockResolvedValue(registerRow({ status: 'REJECTED' })),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<AdminRequestsPage />);

    const row = (await screen.findByText('Ravi Kumar')).closest('.sk-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Reject' }));

    // No POST yet — the row is asking for confirmation instead.
    expect(api.post).not.toHaveBeenCalled();
    expect(within(row).getByText('Reject this request?')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Confirm reject' }));
    expect(api.post).toHaveBeenCalledWith('/manage/register-changes/reg-1/reject');
    await waitFor(() => expect(screen.queryByText('Ravi Kumar')).not.toBeInTheDocument());
  });

  it('"Keep" backs out of the reject confirmation without any POST', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet([
        ['/manage/leave', [() => Promise.resolve([leaveApp()])]],
        ['/manage/register-changes', [() => Promise.resolve([])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<AdminRequestsPage />);

    const row = (await screen.findByText('Asha Verma')).closest('.sk-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Reject' }));
    await user.click(within(row).getByRole('button', { name: 'Keep' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('renders the quiet-desk empty state when both queries return nothing', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave', [() => Promise.resolve([])]],
        ['/manage/register-changes', [() => Promise.resolve([])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<AdminRequestsPage />);

    expect(await screen.findByText('No pending requests — a quiet desk.')).toBeInTheDocument();
    expect(screen.getByText(/0 pending/)).toBeInTheDocument();
  });

  it('shows the loaded half next to the error when one query fails', async () => {
    const api = mockApi({
      get: mockGet([
        ['/manage/leave', [() => Promise.reject(new Error('Leave service is unavailable'))]],
        ['/manage/register-changes', [() => Promise.resolve([registerRow()])]],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderWithProviders(<AdminRequestsPage />);

    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('Leave service is unavailable')).toBeInTheDocument();
    // A partial failure must not claim the desk is empty.
    expect(screen.queryByText('No pending requests — a quiet desk.')).not.toBeInTheDocument();
  });
});

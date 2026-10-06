import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import AdminLeavePage from './page';

/**
 * Two desks decide the same leave: the console here, and the accounts officer
 * on WhatsApp. The API lets exactly one win; the loser gets a 409 that names
 * the winner. This page must then drop the row instead of leaving it to be
 * tapped again — and must never offer the viewer a decision on their own leave.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (id: string, name: string, personUserId: string | null) => ({
  id, teacherId: `t-${id}`, teacherName: name, personUserId, type: 'SICK' as const,
  startDate: '2026-10-05', endDate: '2026-10-06', reason: null, status: 'PENDING' as const,
  createdAt: '2026-10-01T00:00:00.000Z',
});

function mockApi(pending: () => Promise<unknown>, post: ApiStub['post']): ApiStub {
  const get = vi.fn((path: string) => {
    if (path.startsWith('/auth/me')) return Promise.resolve({ userId: 'u-me' });
    if (path.includes('status=PENDING')) return pending();
    if (path.includes('status=APPROVED')) return Promise.resolve([]);
    if (path.startsWith('/manage/leave/coverage')) return Promise.resolve([]);
    if (path.startsWith('/manage/availability')) return Promise.resolve({ teachers: [], busy: [], periods: [] });
    if (path.startsWith('/manage/leave-policy/pending-context')) return Promise.resolve({});
    return Promise.resolve([]);
  });
  return { get, post, put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('deciding leave on the Leave desk', () => {
  it('a 409 on Reject (decided elsewhere first) refetches Pending, so the row leaves', async () => {
    const pending = vi.fn().mockResolvedValueOnce([row('l1', 'Asha Verma', 'u-asha')]).mockResolvedValue([]);
    const post = vi.fn().mockRejectedValue(new ApiError(409, 'Already approved by Darshan Jain at 9:42 am. Nothing changed.', { code: 'LEAVE_NOT_PENDING' }));
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(pending, post));

    renderWithProviders(<AdminLeavePage />);
    const card = (await screen.findByText('Asha Verma')).closest('.sk-row') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(screen.queryByText('Asha Verma')).toBeNull());
    expect(post).toHaveBeenCalledWith('/manage/leave/l1/reject');
  });

  it('a 409 on Approve refetches Pending the same way', async () => {
    const pending = vi.fn().mockResolvedValueOnce([row('l1', 'Asha Verma', 'u-asha')]).mockResolvedValue([]);
    const post = vi.fn().mockRejectedValue(new ApiError(409, 'Already rejected by Darshan Jain at 10:00 am. Nothing changed.', { code: 'LEAVE_NOT_PENDING' }));
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(pending, post));

    renderWithProviders(<AdminLeavePage />);
    const card = (await screen.findByText('Asha Verma')).closest('.sk-row') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(screen.queryByText('Asha Verma')).toBeNull());
  });

  it("the viewer's own leave shows the hint and no live Approve/Reject", async () => {
    const pending = vi.fn().mockResolvedValue([row('mine', 'Me Myself', 'u-me'), row('l2', 'Asha Verma', 'u-asha')]);
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(pending, vi.fn()));

    renderWithProviders(<AdminLeavePage />);
    const mine = (await screen.findByText('Me Myself')).closest('.sk-row') as HTMLElement;
    await waitFor(() => expect(within(mine).getByRole('button', { name: 'Approve' })).toBeDisabled());
    expect(within(mine).getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(within(mine).getByText('Your own leave — another admin or the accounts officer decides it')).toBeTruthy();

    const theirs = screen.getByText('Asha Verma').closest('.sk-row') as HTMLElement;
    expect(within(theirs).getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});

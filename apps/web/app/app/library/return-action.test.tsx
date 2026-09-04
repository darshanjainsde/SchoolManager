import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ReturnAction } from './return-action';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const ISSUE = {
  id: 'i1', accessionNo: 'B-00042', titleId: 't1', title: 'Matilda', author: 'Roald Dahl',
  borrower: { kind: 'STUDENT', id: 's1', name: 'Ananya Rao', code: 'RVS-00231', className: '6A', classSectionId: 'cs1' },
  issuedOn: '2026-08-04', dueOn: '2026-08-18', returnedOn: '2026-09-03', wasLost: false, accruedFineRupees: 0,
};

function makeApi(result: { fineRupees: number; fineId: string | null }): { api: ApiStub; post: ReturnType<typeof vi.fn> } {
  const post = vi.fn((path: string) => {
    if (path === '/library/issues/i1/return') return Promise.resolve({ issue: ISSUE, ...result });
    return Promise.resolve({});
  });
  return {
    api: { get: vi.fn(), post, put: vi.fn(), patch: vi.fn(), del: vi.fn() } as unknown as ApiStub,
    post,
  };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

describe('taking a book back from the row it is listed on', () => {
  it('returns a book that is not late and says so', async () => {
    const { api, post } = makeApi({ fineRupees: 0, fineId: null });
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup();
    renderWithProviders(<ReturnAction issueId="i1" />);

    await user.click(screen.getByRole('button', { name: 'Return' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/library/issues/i1/return', {}));
    // Nothing is owed, so nothing is asked — no settle controls appear.
    expect(screen.queryByRole('button', { name: 'Collected' })).not.toBeInTheDocument();
  });

  /**
   * THE REASON THIS COMPONENT HOLDS STATE.
   *
   * A late return raises a fine, and the moment to settle it is now, with the
   * reader still at the desk. Invalidating the dashboard on success would
   * unmount this row and take the fine question with it — the librarian would
   * watch the line vanish and never be asked. So a fine must keep the row.
   */
  it('holds the row open when the return raised a fine, and offers the three ways to settle it', async () => {
    const { api } = makeApi({ fineRupees: 75, fineId: 'f9' });
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup();
    renderWithProviders(<ReturnAction issueId="i1" />);

    await user.click(screen.getByRole('button', { name: 'Return' }));

    expect(await screen.findByText('₹75 late')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collected' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
    // And the return itself is done — it must not be offered again.
    expect(screen.queryByRole('button', { name: 'Return' })).not.toBeInTheDocument();
  });

  it('collects the fine against the id the return reported', async () => {
    const { api, post } = makeApi({ fineRupees: 75, fineId: 'f9' });
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup();
    renderWithProviders(<ReturnAction issueId="i1" />);

    await user.click(screen.getByRole('button', { name: 'Return' }));
    await user.click(await screen.findByRole('button', { name: 'Collected' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/library/fines/f9/collect', {}));
  });

  it('“Later” settles nothing — the fine stays owed on the Fines tab', async () => {
    const { api, post } = makeApi({ fineRupees: 75, fineId: 'f9' });
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup();
    renderWithProviders(<ReturnAction issueId="i1" />);

    await user.click(screen.getByRole('button', { name: 'Return' }));
    await user.click(await screen.findByRole('button', { name: 'Later' }));

    await waitFor(() => expect(screen.queryByText('₹75 late')).not.toBeInTheDocument());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).not.toHaveBeenCalledWith('/library/fines/f9/waive', {});
    expect(post).not.toHaveBeenCalledWith('/library/fines/f9/collect', {});
  });
});

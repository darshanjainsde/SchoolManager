import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CollectionsPage from './page';

/**
 * The tile that must not lie.
 *
 * "Let off" is money the school genuinely forgave. A book that was found, or
 * replaced by the family, also closes a charge without money — but the school
 * lost nothing, and folding those in would make the figure read as generosity
 * when it is book-keeping. The API already excludes them; this asserts the
 * screen shows them as a SEPARATE tile rather than quietly adding them back.
 */

// A STABLE object, hoisted. Returning a fresh `{host, token}` on every render
// changes the identity of `useCallback`'s dependency each time, so the loading
// effect re-fires forever and the test OOMs. The real `useApiCtx` holds it in
// state and is stable after mount — the mock has to be too, or it is testing a
// component that does not exist.
const CTX = { host: 'h', token: 't' };
vi.mock('@/lib/session', () => ({ useApiCtx: () => CTX }));

const getCollectionsMock = vi.hoisted(() => vi.fn());
const listWaiversMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/lost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/lost')>()),
  getCollections: getCollectionsMock,
  listWaivers: listWaiversMock,
}));

describe('CollectionsPage', () => {
  beforeEach(() => {
    getCollectionsMock.mockReset().mockResolvedValue({
      from: '2026-08-14',
      to: '2026-08-14',
      collected: 399,
      letOff: 75,
      clearedInKind: 470,
      stillOwed: 60,
      membersOwing: 1,
      byReason: [{ kind: 'LOST', collected: 299, owed: 0 }],
      byMethod: [{ method: 'CASH', collected: 299, count: 1 }],
    });
    listWaiversMock.mockReset().mockResolvedValue([
      {
        fineId: 'f1',
        member: { id: 'm1', firstName: 'Meera', lastName: 'Nair', code: 'M1' },
        kind: 'LOST',
        amount: '195',
        reasonCode: 'BOOK_FOUND',
        reason: 'The original copy was found',
        waivedAt: null,
        book: 'Panchatantra',
        accessionNumber: '1009',
        mechanical: true,
      },
    ]);
  });

  it('shows what was genuinely let off SEPARATELY from what was cleared in kind', async () => {
    render(<CollectionsPage />);

    // 75 forgiven; 470 cleared in kind. If these were ever summed into one
    // tile the school's generosity would read as 545.
    expect(await screen.findByText('₹75.00')).toBeInTheDocument();
    expect(screen.getByText('₹470.00')).toBeInTheDocument();
    expect(screen.queryByText('₹545.00')).not.toBeInTheDocument();
  });

  it('marks a mechanical waiver in the log so it is not read as generosity', async () => {
    render(<CollectionsPage />);
    await waitFor(() => expect(screen.getByText(/the school lost nothing/)).toBeInTheDocument());
  });

  it('shows what is still owed and by how many members', async () => {
    render(<CollectionsPage />);
    expect(await screen.findByText('₹60.00')).toBeInTheDocument();
    expect(screen.getByText('1 members')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { DeskSearch } from './desk-search';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const MEMBER_HIT = { kind: 'STUDENT', id: 's1', name: 'Ananya Rao', code: 'RVS-00231', className: '6A', holding: 1 };
const BORROWER = { kind: 'STUDENT', id: 's1', name: 'Ananya Rao', code: 'RVS-00231', className: '6A', classSectionId: 'cs1' };
const HOLDING = {
  id: 'i1', accessionNo: 'B-00042', titleId: 't1', title: 'Matilda', author: 'Roald Dahl',
  borrower: BORROWER, issuedOn: '2026-08-04', dueOn: '2026-09-30', returnedOn: null, wasLost: false,
  accruedFineRupees: 0,
};
const MEMBER_CARD = { borrower: BORROWER, limit: 3, holdings: [HOLDING], duesRupees: 0 };
const TITLE = {
  id: 't1', title: 'Matilda', author: 'Roald Dahl', shelf: 'F-2',
  totalCopies: 2, inCopies: 1, lostCopies: 0, earliestBack: null,
  copies: [{ id: 'c1', accessionNo: 'B-00042', status: 'OUT', issueId: 'i1', borrower: BORROWER, dueOn: '2026-09-30' }],
};

function makeApi(): ApiStub {
  return {
    get: vi.fn((path: string) => {
      if (path.startsWith('/library/members?q=')) return Promise.resolve([MEMBER_HIT]);
      if (path.startsWith('/library/members/student/s1')) return Promise.resolve(MEMBER_CARD);
      if (path.startsWith('/library/titles?q=')) return Promise.resolve([TITLE]);
      if (path.startsWith('/library/titles/t1')) return Promise.resolve(TITLE);
      return Promise.resolve([]);
    }),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  } as unknown as ApiStub;
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
  vi.mocked(useApi).mockReturnValue(makeApi() as never);
});

describe('the desk search on the dashboard', () => {
  it('finds a reader and a book from one box', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeskSearch />);

    await user.type(screen.getByLabelText('Search the library'), 'Mat');

    expect(await screen.findByText('Readers')).toBeInTheDocument();
    expect(screen.getByText('Ananya Rao')).toBeInTheDocument();
    expect(await screen.findByText('Books')).toBeInTheDocument();
  });

  /**
   * The point of the box: a loan found here can be taken back here. Before
   * this, acting on anything the dashboard showed meant leaving for the Counter
   * and searching for the same reader a second time.
   */
  it('lists a reader’s loans with a Return on each', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DeskSearch />);

    await user.type(screen.getByLabelText('Search the library'), 'Ana');
    await user.click((await screen.findAllByRole('button', { name: 'Open' }))[0]);

    expect(await screen.findByText('B-00042 · Roald Dahl')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
  });

  it('does not try to be the counter — nothing here issues a book', async () => {
    // Issuing needs a reader AND a title chosen together plus the limit and
    // duplicate warnings. Two screens doing that is two screens to keep in step.
    const user = userEvent.setup();
    renderWithProviders(<DeskSearch />);

    await user.type(screen.getByLabelText('Search the library'), 'Mat');
    await screen.findByText('Readers');

    expect(screen.queryByRole('button', { name: /^Issue/ })).not.toBeInTheDocument();
  });

  it('waits for the host before asking the API anything', async () => {
    // Every tenant-scoped query in the console must be gated on the host, or it
    // fires with no X-Skoolos-Host, 401s, and signs the admin out.
    vi.mocked(useHost).mockReturnValue(undefined as never);
    const api = makeApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup();
    renderWithProviders(<DeskSearch />);

    await user.type(screen.getByLabelText('Search the library'), 'Mat');

    expect(api.get).not.toHaveBeenCalled();
  });
});

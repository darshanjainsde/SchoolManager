import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type { MeLibraryPayload } from '@/lib/library-types';
import PortalLibraryPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const SHELF: MeLibraryPayload = {
  kind: 'STUDENT',
  limit: 2,
  loanDays: 14,
  finesEnabled: true,
  holdings: [
    {
      issueId: 'i1', title: 'Matilda', author: 'Roald Dahl', accessionNo: 'B-00042',
      issuedOn: '2026-08-04', dueOn: '2026-08-18', daysLeft: 2, accruedFineRupees: 0,
    },
    {
      issueId: 'i2', title: 'Wonder', author: 'R.J. Palacio', accessionNo: 'B-00077',
      issuedOn: '2026-07-30', dueOn: '2026-08-13', daysLeft: -3, accruedFineRupees: 10,
    },
  ],
  history: [
    { issueId: 'i3', title: 'The BFG', author: 'Roald Dahl', returnedOn: '2026-07-28', wasLost: false },
  ],
  fines: [{ id: 'f1', title: 'Hatchet', reason: 'LOST', amountRupees: 120 }],
  finesDueRupees: 130,
  today: '2026-08-16',
};

function stub(payload: MeLibraryPayload | Error): ApiStub {
  return {
    get: vi.fn(() => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload))),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as unknown as ApiStub;
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

describe('the student library shelf', () => {
  it('shows the limit, each book with its time-left chip, fines pinned to the shelf', async () => {
    vi.mocked(useApi).mockReturnValue(stub(SHELF) as never);
    renderWithProviders(<PortalLibraryPage />);

    expect(await screen.findByText('Holding 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('return one to borrow more')).toBeInTheDocument();
    // Soon (2 days) and late (3 days · fine-so-far) chips carry the words, not just colour.
    expect(screen.getByText(/2 days left — due/)).toBeInTheDocument();
    expect(screen.getByText(/3 days late · ₹10 so far/)).toBeInTheDocument();
    // The fine banner totals fixed + accruing.
    expect(screen.getByTestId('fine-banner')).toHaveTextContent('₹130 to clear at the counter');
    // History names the returned book.
    expect(screen.getByText('The BFG')).toBeInTheDocument();
  });

  it('hides the fine banner entirely when nothing is owed', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({ ...SHELF, finesDueRupees: 0, fines: [], holdings: [SHELF.holdings[0]] }) as never,
    );
    renderWithProviders(<PortalLibraryPage />);
    expect(await screen.findByText('Holding 1 of 2')).toBeInTheDocument();
    expect(screen.queryByTestId('fine-banner')).not.toBeInTheDocument();
    expect(screen.getByText('you can borrow 1 more')).toBeInTheDocument();
  });

  it('says so quietly when the plan has no library (403), instead of erroring', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub(new ApiError(403, 'forbidden', { code: 'FORBIDDEN_FEATURE' })) as never,
    );
    renderWithProviders(<PortalLibraryPage />);
    expect(await screen.findByText(/isn’t part of your school’s plan/)).toBeInTheDocument();
  });
});

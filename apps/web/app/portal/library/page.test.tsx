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
  rules: { finePerDayRupees: 5, graceDays: 1, lostFeeRupees: 120 },
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
    // The fines are LISTED, not just counted — the lost book and the one still accruing.
    expect(screen.getByTestId('fine-banner')).toHaveTextContent('Hatchet');
    expect(screen.getByTestId('fine-banner')).toHaveTextContent('Marked lost');
    expect(screen.getByTestId('fine-banner')).toHaveTextContent('Wonder');
    // The rules are said in words, before a fine teaches them.
    expect(screen.getByTestId('library-rules')).toHaveTextContent("2 books at a time · 14 days each · ₹5 a day late after 1 day's grace · lost book ₹120");
    expect(screen.getByTestId('library-next-due')).toHaveTextContent('2 days');
    expect(screen.getByTestId('library-returned-count')).toHaveTextContent('1');
  });

  it('an empty shelf says what you may take, and a reader without fines sees no fine figure', async () => {
    vi.mocked(useApi).mockReturnValue(stub({ ...SHELF, kind: 'TEACHER', limit: 5, finesEnabled: false, finesDueRupees: 0, fines: [], holdings: [], history: [] }) as never);
    renderWithProviders(<PortalLibraryPage />);
    expect(await screen.findByTestId('library-empty')).toHaveTextContent('Nothing out right now. You can take 5 books for 14 days each — ask at the counter.');
    expect(screen.queryByTestId('library-fine')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-rules')).toHaveTextContent('5 books at a time · 14 days each');
    expect(screen.getByTestId('library-rules')).not.toHaveTextContent('₹');
    expect(screen.getByText('Nothing returned yet. Books you bring back are listed here.')).toBeInTheDocument();
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

  it('survives an API older than this build (no `rules`): limit and loan, no money', async () => {
    const { rules: _drop, ...older } = SHELF;
    vi.mocked(useApi).mockReturnValue(stub(older as MeLibraryPayload) as never);
    renderWithProviders(<PortalLibraryPage />);
    expect(await screen.findByText('Holding 2 of 2')).toBeInTheDocument();
    expect(screen.getByTestId('library-rules')).toHaveTextContent('2 books at a time · 14 days each');
    expect(screen.getByTestId('library-rules')).not.toHaveTextContent('₹');
    expect(screen.getByText(/Late and lost books carry a fine, paid at the counter/)).toBeInTheDocument();
  });

  it('says so quietly when the plan has no library (403), instead of erroring', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub(new ApiError(403, 'forbidden', { code: 'FORBIDDEN_FEATURE' })) as never,
    );
    renderWithProviders(<PortalLibraryPage />);
    expect(await screen.findByText(/isn’t part of your school’s plan/)).toBeInTheDocument();
  });
});

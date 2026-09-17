import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { MeLibraryPayload } from '@/lib/library-types';
import TeacherLibraryPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const BASE: MeLibraryPayload = {
  kind: 'TEACHER',
  limit: 5,
  loanDays: 14,
  finesEnabled: false,
  holdings: [
    {
      issueId: 'i1', title: 'A Brief History of Time', author: 'Stephen Hawking', accessionNo: 'B-00901',
      issuedOn: '2026-08-05', dueOn: '2026-08-19', daysLeft: 3, accruedFineRupees: 0,
    },
  ],
  history: [
    { issueId: 'i2', title: 'Wings of Fire', author: 'A.P.J. Abdul Kalam', returnedOn: '2026-08-02', wasLost: false },
  ],
  fines: [],
  finesDueRupees: 0,
  today: '2026-08-16',
  rules: { finePerDayRupees: 5, graceDays: 1, lostFeeRupees: 120 },
};

function stub(payload: MeLibraryPayload): ApiStub {
  return {
    get: vi.fn(() => Promise.resolve(payload)),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as unknown as ApiStub;
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

describe('the teacher library tab', () => {
  it('shows holdings and history, and NO fines section while teacher fines are off', async () => {
    vi.mocked(useApi).mockReturnValue(stub(BASE) as never);
    renderWithProviders(<TeacherLibraryPage />);

    // The title is on the shelf card AND in the Next-due figure's hint — scope to the shelf.
    expect(within(await screen.findByTestId('library-shelf')).getByText(/A Brief History of Time/)).toBeInTheDocument();
    expect(screen.getByText('Holding 1 of 5')).toBeInTheDocument();
    expect(within(screen.getByTestId('library-history')).getByText(/Wings of Fire/)).toBeInTheDocument();
    // The rule, not just an empty list: no fine figure, no fine card, and the rules say so in words.
    expect(screen.queryByTestId('library-fine')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fine-banner')).not.toBeInTheDocument();
    expect(screen.getByText(/No fines apply to you/)).toBeInTheDocument();
    expect(screen.getByTestId('library-rules')).toHaveTextContent('5 books at a time · 14 days each');
  });

  it('grows a fines section — with amounts — the moment the librarian turns teacher fines on', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({
        ...BASE,
        finesEnabled: true,
        fines: [{ id: 'f1', title: 'Godaan', reason: 'LATE', amountRupees: 15 }],
        finesDueRupees: 15,
      }) as never,
    );
    renderWithProviders(<TeacherLibraryPage />);

    expect(await screen.findByTestId('fine-banner')).toHaveTextContent('₹15 to clear at the counter');
    expect(screen.getByTestId('fine-banner')).toHaveTextContent('Godaan');
    expect(screen.getByTestId('fine-banner')).toHaveTextContent('Returned late');
    expect(screen.getByTestId('library-fine')).toHaveTextContent('₹15');
    // Once fines apply, the rules say the rate.
    expect(screen.getByTestId('library-rules')).toHaveTextContent("₹5 a day late after 1 day's grace");
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

    expect(await screen.findByText(/A Brief History of Time/)).toBeInTheDocument();
    expect(screen.getByText('Holding now · 1 of 5')).toBeInTheDocument();
    expect(screen.getByText(/Wings of Fire/)).toBeInTheDocument();
    // The rule, not just an empty list: the section itself is absent.
    expect(screen.queryByText('Fines')).not.toBeInTheDocument();
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

    expect(await screen.findByText('Fines')).toBeInTheDocument();
    expect(screen.getByText('Godaan')).toBeInTheDocument();
    expect(screen.getByText('₹15')).toBeInTheDocument();
    expect(screen.getByText(/₹15 due/)).toBeInTheDocument();
  });
});

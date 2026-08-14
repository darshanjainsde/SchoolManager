import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import StudentLibraryPage from './page';
import type { MyLibrary } from '@/lib/library';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));

function stub(mine: MyLibrary): ReturnType<typeof useApi> {
  return {
    get: vi.fn((path: string) => {
      if (path === '/me/library') return Promise.resolve(mine);
      return Promise.resolve([]);
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
    // Typed as what `mockReturnValue` expects rather than as ApiStub, so no
    // per-call cast is needed. vitest never runs tsc, so a test file that is
    // green under the runner can still fail the typecheck gate — this shape
    // keeps the two agreeing.
  } as unknown as ReturnType<typeof useApi>;
}

const book = (over: Partial<MyLibrary['books'][number]> = {}) => ({
  issueId: 'i1',
  title: 'The Hungry Tide',
  accessionNumber: '1042',
  backBy: '2026-08-26T00:00:00.000Z',
  daysLeft: 3,
  renewCount: 0,
  ...over,
});

describe('the student library screen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a borrowed book with its number and when it goes back', async () => {
    vi.mocked(useApi).mockReturnValue(stub({ isMember: true, books: [book()] }));
    renderWithProviders(<StudentLibraryPage />);

    expect(await screen.findByText('The Hungry Tide')).toBeInTheDocument();
    // "no. 1042", not "accession number" — that word survives only in the
    // register, which is the auditor's document.
    expect(screen.getByText('no. 1042')).toBeInTheDocument();
    expect(screen.getByText(/back by 26 Aug/)).toBeInTheDocument();
    expect(screen.getByText('3 days left')).toBeInTheDocument();
  });

  it('NEVER renders a bare "Late" badge on an overdue book', async () => {
    // `Late` is already an attendance chip meaning "arrived late to class" in
    // four screens of this product. A child reading it here would reasonably
    // think it was a mark against their attendance.
    vi.mocked(useApi).mockReturnValue(
      stub({ isMember: true, books: [book({ daysLeft: -6 })] }),
    );
    renderWithProviders(<StudentLibraryPage />);

    expect(await screen.findByText('6 days late')).toBeInTheDocument();
    expect(screen.queryByText(/^late$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it('shows NOTHING about money when nothing is owed', async () => {
    // Absent, not "₹0". A permanent zero teaches a family to expect a charge
    // from a library that mostly charges nothing.
    vi.mocked(useApi).mockReturnValue(stub({ isMember: true, books: [book()] }));
    renderWithProviders(<StudentLibraryPage />);

    await screen.findByText('The Hungry Tide');
    expect(screen.queryByText(/what i owe/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it('shows what is owed only when something is', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({ isMember: true, books: [book()], owed: 6 }),
    );
    renderWithProviders(<StudentLibraryPage />);

    expect(await screen.findByText('₹6')).toBeInTheDocument();
  });

  it('says plainly when the child is not enrolled yet, without sounding like an error', async () => {
    // Schools enrol class by class, so a child can legitimately arrive here
    // before their turn. This must not read as a failure or a permission wall.
    vi.mocked(useApi).mockReturnValue(stub({ isMember: false, books: [] }));
    renderWithProviders(<StudentLibraryPage />);

    expect(await screen.findByText(/not signed up at the library yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/error|denied|forbidden/i)).not.toBeInTheDocument();
  });

  it('handles having borrowed nothing', async () => {
    vi.mocked(useApi).mockReturnValue(stub({ isMember: true, books: [] }));
    renderWithProviders(<StudentLibraryPage />);

    expect(await screen.findByText(/nothing borrowed right now/i)).toBeInTheDocument();
  });
});

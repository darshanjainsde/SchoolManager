import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import TeacherLibraryPage from './page';
import type { ClassNotReturned, MyLibrary } from '@/lib/library';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));

function stub(mine: MyLibrary, klass: ClassNotReturned[] = []): ReturnType<typeof useApi> {
  return {
    get: vi.fn((path: string) => {
      if (path === '/me/library') return Promise.resolve(mine);
      if (path === '/me/library/class') return Promise.resolve(klass);
      return Promise.resolve([]);
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
    // Typed as what `mockReturnValue` expects rather than as ApiStub, so no
    // per-call cast is needed. vitest never runs tsc, so a test file that is
    // green under the runner can still fail the typecheck gate — this shape
    // keeps the two agreeing.
  } as unknown as ReturnType<typeof useApi>;
}

const teacherBook = {
  issueId: 't1',
  title: 'Sapiens',
  accessionNumber: '2201',
  // 30-day loan — the teacher's longer limit, from CirculationPolicy.
  backBy: '2026-09-12T00:00:00.000Z',
  daysLeft: 18,
  renewCount: 0,
};

describe('the teacher library screen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the teacher their own borrowed books, same shape as a student', async () => {
    vi.mocked(useApi).mockReturnValue(stub({ isMember: true, books: [teacherBook] }));
    renderWithProviders(<TeacherLibraryPage />);

    expect(await screen.findByText('Sapiens')).toBeInTheDocument();
    expect(screen.getByText('no. 2201')).toBeInTheDocument();
    expect(screen.getByText('18 days left')).toBeInTheDocument();
  });

  it('lists which children have not brought a book back', async () => {
    // The only mechanism in the product that actually recovers a book from a
    // ten-year-old: the librarian has no authority over a child, the class
    // teacher does.
    vi.mocked(useApi).mockReturnValue(
      stub({ isMember: true, books: [] }, [
        { name: 'Meera Nair', title: 'Panchatantra', daysLate: 4 },
        { name: 'Kabir Shah', title: 'Matilda', daysLate: 11 },
      ]),
    );
    renderWithProviders(<TeacherLibraryPage />);

    expect(await screen.findByText('Meera Nair')).toBeInTheDocument();
    expect(screen.getByText('Kabir Shah')).toBeInTheDocument();
    expect(screen.getByText('Panchatantra')).toBeInTheDocument();
    expect(screen.getByText('2 books not returned')).toBeInTheDocument();
  });

  it('NEVER shows an amount against a child, even when fines are on', async () => {
    // The load-bearing assertion. A staffroom is a public place, and the moment
    // this screen shows what children owe it becomes fee collection — the
    // teacher stops opening it, and then nothing recovers the books at all.
    vi.mocked(useApi).mockReturnValue(
      stub({ isMember: true, books: [], owed: 40 }, [
        { name: 'Meera Nair', title: 'Panchatantra', daysLate: 4 },
      ]),
    );
    renderWithProviders(<TeacherLibraryPage />);

    await screen.findByText('Meera Nair');
    // Word-boundary anchored. `/owe/i` was the first attempt and it matched
    // "Nothing b-orrowe-d right now", failing on correct code — a loose
    // substring in an absence-assertion fails wrongly, and the same looseness
    // in a presence-assertion passes wrongly and says nothing.
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bowe[sd]?\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bfines?\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\brupees?\b/i)).not.toBeInTheDocument();
  });

  it('offers NO issue or return controls — a teacher borrows, they do not run the counter', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({ isMember: true, books: [teacherBook] }, [
        { name: 'Meera Nair', title: 'Panchatantra', daysLate: 4 },
      ]),
    );
    renderWithProviders(<TeacherLibraryPage />);

    await screen.findByText('Sapiens');
    expect(screen.queryByRole('button', { name: /issue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument();
  });

  it('shows no class block at all when everything is back', async () => {
    // An empty "0 books not returned" heading is noise on a screen a teacher
    // opens between lessons.
    vi.mocked(useApi).mockReturnValue(stub({ isMember: true, books: [teacherBook] }, []));
    renderWithProviders(<TeacherLibraryPage />);

    await screen.findByText('Sapiens');
    expect(screen.queryByText(/not returned/i)).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import CounterPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const MEMBER_HIT = {
  kind: 'STUDENT', id: 's1', name: 'Ananya Rao', code: 'RVS-00231', className: '6A', holding: 2,
};
const BORROWER = {
  kind: 'STUDENT', id: 's1', name: 'Ananya Rao', code: 'RVS-00231', className: '6A', classSectionId: 'cs1',
};
const HOLDING = {
  id: 'i1', accessionNo: 'B-00001', titleId: 't9', title: "Charlotte's Web", author: 'E.B. White',
  borrower: BORROWER, issuedOn: '2026-08-04', dueOn: '2026-08-18', returnedOn: null, wasLost: false,
  accruedFineRupees: 0,
};
const MEMBER_CARD = { borrower: BORROWER, limit: 2, holdings: [HOLDING, { ...HOLDING, id: 'i2' }], duesRupees: 0 };
const TITLE = {
  id: 't1', title: 'Matilda', author: 'Roald Dahl', shelf: 'F-2',
  totalCopies: 5, inCopies: 3, lostCopies: 0, earliestBack: null,
  copies: [{ id: 'c1', accessionNo: 'B-00042', status: 'IN' }],
};
const ISSUED = {
  id: 'i9', accessionNo: 'B-00042', titleId: 't1', title: 'Matilda', author: 'Roald Dahl',
  borrower: BORROWER, issuedOn: '2026-08-16', dueOn: '2026-08-30', returnedOn: null, wasLost: false,
  accruedFineRupees: 0,
};

function makeApi(): { api: ApiStub; post: ReturnType<typeof vi.fn> } {
  const post = vi.fn((path: string, body?: unknown) => {
    if (path === '/library/issues') {
      const b = body as { override?: boolean };
      // The counter warns, never silently blocks: the first attempt 409s,
      // the explicit override goes through.
      if (!b.override) {
        return Promise.reject(
          new ApiError(409, 'Already holding 2 of 2. Send override: true to issue anyway.', {
            code: 'LIBRARY_LIMIT',
            message: 'Already holding 2 of 2. Send override: true to issue anyway.',
          }),
        );
      }
      return Promise.resolve(ISSUED);
    }
    return Promise.resolve({});
  });
  const api = {
    get: vi.fn((path: string) => {
      if (path.startsWith('/library/members?q=')) return Promise.resolve([MEMBER_HIT]);
      if (path.startsWith('/library/members/student/s1')) return Promise.resolve(MEMBER_CARD);
      if (path.startsWith('/library/titles?q=')) return Promise.resolve([TITLE]);
      if (path.startsWith('/library/titles/t1')) return Promise.resolve(TITLE);
      if (path.startsWith('/library/dashboard'))
        return Promise.resolve({ counts: { outNow: 0 }, outNow: [], dueSoon: [], today: '2026-08-16' });
      return Promise.resolve([]);
    }),
    post,
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(() => Promise.resolve({ ok: true })),
  } as unknown as ApiStub;
  return { api, post };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

describe('the counter — give out', () => {
  it('walks reader → book → warn at the limit → explicit "Issue anyway" issues', async () => {
    const { api, post } = makeApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup();
    renderWithProviders(<CounterPage />);

    // Find the reader (typeahead past the 250ms debounce).
    await user.type(screen.getByLabelText('Find a reader'), 'RVS');
    await user.click(await screen.findByText('Ananya Rao'));
    expect(await screen.findByText(/Holding 2 of 2/)).toBeInTheDocument();

    // Find the book; availability shows before any issuing.
    await user.type(screen.getByLabelText('Find a book'), 'Mat');
    await user.click(await screen.findByText('Matilda'));
    expect(await screen.findByText('Available')).toBeInTheDocument();

    // At the limit: the API 409s and the counter turns it into a warn.
    await user.click(screen.getByRole('button', { name: 'Issue' }));
    const override = await screen.findByRole('button', { name: 'Issue anyway' });
    expect(screen.getByText(/Already holding 2 of 2/)).toBeInTheDocument();

    // The librarian's explicit call.
    await user.click(override);
    expect(await screen.findByTestId('issue-stamp')).toHaveTextContent('B-00042');
    expect(post).toHaveBeenLastCalledWith(
      '/library/issues',
      expect.objectContaining({ titleId: 't1', studentId: 's1', override: true }),
    );
  });
});

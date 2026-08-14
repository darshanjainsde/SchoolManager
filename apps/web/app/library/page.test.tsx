import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import LibraryCounterPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

/**
 * The counter's states, and the one promise it makes.
 *
 * The first-run states are checked in ORDER because the screen renders the
 * first match and each one has exactly one next action: a librarian must never
 * be shown a counter she cannot use. Enrolling is one button and instant;
 * stocking shelves takes an afternoon — so "nobody is signed up" comes before
 * "the shelves are empty", and getting that order wrong sends her away to do
 * the slow thing first.
 *
 * The money assertion is the one that matters most. No rupee figure may appear
 * on this screen in any state: a LOST fine is only ever created by a deliberate
 * human action with the amount and its source visible at that moment. If a
 * number a parent pays can surface on a screen nobody opened for that purpose,
 * the failure is not an angry parent — it is the librarian quietly stopping
 * reporting losses, and then the register is wrong forever.
 */

interface Overrides {
  status?: Record<string, unknown>;
  members?: unknown[];
  notReturned?: unknown[];
  day?: unknown[];
}

function stub({ status, members, notReturned, day }: Overrides = {}): ApiStub {
  return {
    get: vi.fn((path: string) => {
      if (path.startsWith('/manage/library/status'))
        return Promise.resolve(status ?? { provisioned: true, live: true, members: 412, copies: 161 });
      if (path.startsWith('/manage/library/members')) return Promise.resolve(members ?? []);
      if (path.startsWith('/manage/library/not-returned')) return Promise.resolve(notReturned ?? []);
      if (path.startsWith('/manage/library/day')) return Promise.resolve(day ?? []);
      if (path.startsWith('/manage/library/next-numbers')) return Promise.resolve([]);
      if (path.startsWith('/manage/library/period/now'))
        return Promise.resolve({
          date: '2026-08-15',
          periodsConfigured: false,
          attendanceOn: true,
          classes: [],
          warning: null,
        });
      // A stub that threw for an unlisted path would make this file fail every
      // time an unrelated section is added to the counter.
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
});

describe('the counter — first run, in the order she needs it', () => {
  it('a school with no library at all is told to ask the office, not shown a desk', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({ status: { provisioned: false, live: false, members: 0, copies: 0 } }) as never,
    );
    renderWithProviders(<LibraryCounterPage />);

    expect(await screen.findByText(/not set up yet/i)).toBeInTheDocument();
    // No counter field: a disabled input that eats keystrokes is worse than an
    // absent one.
    expect(screen.queryByLabelText(/book number to take back/i)).not.toBeInTheDocument();
  });

  it('offers to sign everyone up BEFORE it asks for books', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({ status: { provisioned: true, live: false, members: 0, copies: 0 } }) as never,
    );
    renderWithProviders(<LibraryCounterPage />);

    expect(await screen.findByText(/nobody is signed up yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign everyone up/i })).toBeInTheDocument();
    // The slow job must not be what she is shown first.
    expect(screen.queryByText(/shelves are empty/i)).not.toBeInTheDocument();
  });

  it('with members but no books, hands her the add form rather than a second console', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({ status: { provisioned: true, live: false, members: 412, copies: 0 } }) as never,
    );
    renderWithProviders(<LibraryCounterPage />);

    expect(await screen.findByText(/shelves are empty/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name of the book/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add to the register/i })).toBeInTheDocument();
  });
});

describe('the counter — running', () => {
  it('opens in TAKE BACK mode, because that is the higher-volume action', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderWithProviders(<LibraryCounterPage />);

    // Scoped to the mode group on purpose: the SUBMIT button is also labelled
    // "Take back" while that mode is active, so an unscoped query matches two
    // elements and throws. That duplication is deliberate in the UI — the verb
    // she picks and the verb she presses should agree — so the test adapts to
    // the screen rather than the screen being reworded for the test.
    const modes = within(await screen.findByRole('group', { name: /what are you doing/i }));
    // `data-on` is what the stylesheet fills; asserting it rather than a colour
    // keeps this a behaviour test.
    expect(modes.getByRole('button', { name: /^take back$/i })).toHaveAttribute('data-on', 'true');
    expect(modes.getByRole('button', { name: /^give out$/i })).toHaveAttribute('data-on', 'false');
    // Return needs no child chosen — one field, one keystroke pattern.
    expect(screen.getByLabelText(/book number to take back/i)).toBeEnabled();
  });

  it('says nothing is late in plain words rather than showing an empty list', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderWithProviders(<LibraryCounterPage />);

    expect(
      await screen.findByText(/nothing is late\. every book is back or still in time\./i),
    ).toBeInTheDocument();
  });

  it('never shows a rupee figure — in any state', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub({
        // A child who owes money, a late book, and a day's activity: every
        // shape that could carry an amount through to the screen.
        members: [
          { memberId: 'm1', code: 'S-2291', name: 'Aarav Sharma', classRef: '6-B', memberType: 'STUDENT', booksOut: 2, owed: 305 },
        ],
        notReturned: [
          { issueId: 'i1', memberName: 'Aarav Sharma', classRef: '6-B', title: 'The Hungry Tide', accessionNumber: '1142', daysLate: 9 },
        ],
        day: [
          { issueId: 'i1', kind: 'RETURNED', at: '2026-08-15T05:12:00.000Z', memberName: 'Aarav Sharma', title: 'The Hungry Tide', accessionNumber: '1142' },
        ],
      }) as never,
    );
    const { container } = renderWithProviders(<LibraryCounterPage />);

    await waitFor(() => expect(screen.getByText(/9 days late/i)).toBeInTheDocument());

    // The whole rendered tree, not one element: a figure that leaks into a
    // pill, a title attribute or an aria-label is still a figure she can read
    // out to a parent.
    expect(container.textContent).not.toMatch(/₹/);
    // `owed: 305` came back on the member shape and must not reach the screen.
    expect(container.textContent).not.toMatch(/305/);
  });

  it('shows the class teacher nudge only when something is actually late', async () => {
    vi.mocked(useApi).mockReturnValue(stub() as never);
    renderWithProviders(<LibraryCounterPage />);

    await screen.findByText(/nothing is late/i);
    expect(screen.queryByRole('button', { name: /tell the class teacher/i })).not.toBeInTheDocument();
  });
});

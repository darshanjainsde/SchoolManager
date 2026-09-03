import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import JobsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function job(over: Record<string, unknown> = {}) {
  return {
    id: 'j1', title: 'PGT Mathematics', summary: 'Senior maths, classes 8–10.', description: '',
    posts: 1, subject: 'Mathematics', status: 'APPROVED', rejectedReason: null, questions: [],
    applicationCount: 0, newApplicationCount: 0,
    ...over,
  };
}

function api(jobs: unknown[]): ApiStub {
  return {
    get: vi.fn((path: string) => (path === '/manage/jobs' ? Promise.resolve(jobs) : Promise.resolve([]))),
    post: vi.fn().mockResolvedValue({}), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as unknown as ApiStub;
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

/**
 * THE FACT THE PAGE COULD NOT SHOW.
 *
 * Every vacancy carried an identical "Applications" button and no number, so
 * the only way to find out whether anybody had applied was to open each posting
 * in turn. A posting nobody has opened is the one that costs the school a
 * candidate, so the unread count is the number the page leads with.
 */
describe('which vacancy has people waiting', () => {
  it('shows the total, and marks the ones nobody has opened', async () => {
    vi.mocked(useApi).mockReturnValue(
      api([
        job({ id: 'j1', title: 'PGT Mathematics', applicationCount: 7, newApplicationCount: 3 }),
        job({ id: 'j2', title: 'Librarian', applicationCount: 2, newApplicationCount: 0 }),
      ]) as never,
    );
    renderWithProviders(<JobsPage />);

    expect(await screen.findByText('PGT Mathematics')).toBeInTheDocument();
    expect(screen.getByText('3 new')).toBeInTheDocument();
    // A vacancy with nothing unread must not wear the badge — a badge on every
    // row is a badge that means nothing.
    expect(screen.queryByText('0 new')).not.toBeInTheDocument();
  });

  it('totals the unread across every vacancy at the top of the page', async () => {
    vi.mocked(useApi).mockReturnValue(
      api([
        job({ id: 'j1', title: 'PGT Mathematics', newApplicationCount: 3 }),
        job({ id: 'j2', title: 'Librarian', newApplicationCount: 4 }),
      ]) as never,
    );
    renderWithProviders(<JobsPage />);

    // Wait for the DATA, not for the tile: the tile exists on the first frame
    // reading 0, and `findByRole` resolves the moment it first matches — which
    // would assert against the loading state and pass or fail by timing.
    await screen.findByText('Librarian');
    expect(screen.getByRole('button', { name: /New applications/ })).toHaveTextContent('7');
  });

  it('says so plainly when there is nothing waiting', async () => {
    vi.mocked(useApi).mockReturnValue(api([job({ newApplicationCount: 0 })]) as never);
    renderWithProviders(<JobsPage />);

    expect(await screen.findByText('all caught up')).toBeInTheDocument();
  });
});

describe('finding the vacancies that need you', () => {
  it('filters by status', async () => {
    vi.mocked(useApi).mockReturnValue(
      api([
        job({ id: 'j1', title: 'PGT Mathematics', status: 'APPROVED' }),
        job({ id: 'j2', title: 'Librarian', status: 'DRAFT' }),
      ]) as never,
    );
    const user = userEvent.setup();
    renderWithProviders(<JobsPage />);

    await screen.findByText('PGT Mathematics');
    await user.click(screen.getByRole('button', { name: /^Draft 1$/ }));

    expect(screen.getByText('Librarian')).toBeInTheDocument();
    expect(screen.queryByText('PGT Mathematics')).not.toBeInTheDocument();
  });

  /** Only a draft or a rejected posting can be sent; a live one cannot. */
  it('offers Send for review only where it is possible', async () => {
    vi.mocked(useApi).mockReturnValue(
      api([job({ id: 'j1', title: 'Live one', status: 'APPROVED' })]) as never,
    );
    const { unmount } = renderWithProviders(<JobsPage />);
    await screen.findByText('Live one');
    expect(screen.queryByRole('button', { name: 'Send for review' })).not.toBeInTheDocument();
    unmount();

    vi.mocked(useApi).mockReturnValue(
      api([job({ id: 'j2', title: 'Draft one', status: 'DRAFT' })]) as never,
    );
    renderWithProviders(<JobsPage />);
    await screen.findByText('Draft one');
    expect(screen.getByRole('button', { name: 'Send for review' })).toBeInTheDocument();
  });

  /** A rejected posting must say why, or the school cannot act on it. */
  it('shows the reason a posting was sent back', async () => {
    vi.mocked(useApi).mockReturnValue(
      api([job({ status: 'REJECTED', rejectedReason: 'Salary range is missing' })]) as never,
    );
    renderWithProviders(<JobsPage />);

    expect(await screen.findByText(/Salary range is missing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for review' })).toBeInTheDocument();
  });
});

describe('the page is on the console’s own design system', () => {
  it('uses none of the old kit’s off-palette colours', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'app/app/jobs/page.tsx'), 'utf8');

    // `text-slate-400` on the cream ground is ~2.4:1 — below AA, and named in
    // the repo's own UI rules as something that gets sent back.
    expect(src).not.toMatch(/text-slate-\d/);
    expect(src).not.toMatch(/border-slate-\d/);
    expect(src).not.toMatch(/(text|bg|border)-teal-\d/);
    expect(src).not.toMatch(/@\/components\/ui\//);
  });
});

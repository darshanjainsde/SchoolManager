import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import DashboardTab from './dashboard-tab';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app/library', useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const DASH = {
  counts: { totalCopies: 4212, totalTitles: 1840, lostCopies: 7, outNow: 318, dueSoon: 41, finesCollectedRupees: 2450, finesDueRupees: 860 },
  outNow: [], dueSoon: [], today: '2026-09-26',
};

function mockApi(): ApiStub {
  return { get: vi.fn(async () => DASH), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi());
});

describe('the library home', () => {
  it('offers the counter’s two doors and Add a book before the numbers, each landing on the right mode', async () => {
    renderWithProviders(<DashboardTab base="/app/library" />);
    const group = await screen.findByRole('group', { name: 'Counter' });
    expect(within(group).getByRole('link', { name: /Give out a book/ })).toHaveAttribute('href', '/app/library/counter?mode=out');
    expect(within(group).getByRole('link', { name: /Take a book back/ })).toHaveAttribute('href', '/app/library/counter?mode=back');
    expect(within(group).getByRole('link', { name: /Add a book/ })).toHaveAttribute('href', '/app/library/books?add=1');
  });

  it('the doors come before the search and the figures — what a librarian DOES is first', async () => {
    const { container } = renderWithProviders(<DashboardTab base="/app/library" />);
    await screen.findByRole('group', { name: 'Counter' });
    const kids = [...container.querySelectorAll('.sk-libactions, .sk-kpis')];
    expect(kids[0]).toHaveClass('sk-libactions');
  });
});

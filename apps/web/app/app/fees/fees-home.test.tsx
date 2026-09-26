import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import FeesHomePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const SUMMARY = {
  todayByMethod: [{ method: 'UPI', amountMinor: 18_500_00, count: 1 }],
  todayTotalMinor: 18_500_00,
  awaitingReviewMinor: 51_300_00, awaitingReviewCount: 3,
  billedMinor: 3_18_33_950_00, collectedMinor: 12_600_00, outstandingMinor: 3_18_21_350_00,
};
const RECENT = [
  { id: 'p1', status: 'SUBMITTED', method: 'UPI', amountMinor: 18_500_00, paidOn: '2026-09-26', submittedAt: '2026-09-26T08:00:00.000Z', receiptNumber: null, student: { id: 's1', name: 'Aarav Mehta', className: '7 B' } },
  { id: 'p2', status: 'VERIFIED', method: 'CASH', amountMinor: 12_600_00, paidOn: '2026-09-25', submittedAt: '2026-09-25T08:00:00.000Z', receiptNumber: 'RCP-0001', student: { id: 's2', name: 'Saanvi Krishnamurthy', className: '3 A' } },
];

function mockApi(get: (path: string) => unknown): ApiStub {
  return { get: vi.fn(async (p: string) => get(p)), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('the Fees home — a hub', () => {
  it('numbers, four doors in one grid, and the latest payments as rows; the header action is what is waiting', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi((p) => (p.startsWith('/manage/fees/summary') ? SUMMARY : RECENT)));
    renderWithProviders(<FeesHomePage />);

    expect(await screen.findByRole('link', { name: 'Check 3 payments' })).toHaveAttribute('href', '/app/fees/verify');
    // Numbers, linked and toned.
    expect(screen.getByRole('link', { name: /Waiting for you/ })).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByRole('link', { name: /Still outstanding/ })).toHaveAttribute('data-tone', 'bad');
    expect(screen.getByRole('link', { name: /Still outstanding/ })).toHaveTextContent('under 1% collected');
    // Four doors in the one doors grid.
    const doors = document.querySelector('.sk-hubdoors')!;
    expect(within(doors as HTMLElement).getAllByRole('link')).toHaveLength(4);
    expect(within(doors as HTMLElement).getByRole('link', { name: /Payments to check/ })).toHaveTextContent('3 waiting');
    // The list: who, how much and how, where it stands, when.
    const list = screen.getByRole('list', { name: 'Latest payments' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Aarav Mehta');
    expect(rows[0]).toHaveTextContent('₹18,500');
    expect(rows[0]).toHaveTextContent('To check');
    expect(rows[1]).toHaveTextContent('RCP-0001');
    expect(rows[1]).toHaveTextContent('Confirmed');
    expect(screen.getByRole('link', { name: 'All →' })).toHaveAttribute('href', '/app/fees/verify');
  });

  it('with nothing waiting the action is Fee setup, and an older API without the recent read degrades to a sentence', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi((p) => {
      if (p.startsWith('/manage/fees/summary')) return { ...SUMMARY, awaitingReviewCount: 0, awaitingReviewMinor: 0 };
      throw new Error('Not found');
    }));
    renderWithProviders(<FeesHomePage />);
    expect(await screen.findByRole('link', { name: 'Fee setup' })).toHaveAttribute('href', '/app/fees/setup');
    expect(await screen.findByText('The payments could not load.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Latest payments' })).toBeNull();
  });
});

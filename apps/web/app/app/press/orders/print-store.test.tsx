import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PrintOrderRow } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import PressOrdersPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
vi.mock('@/components/press/order-drawer', () => ({ OrderDrawer: () => <div role="dialog" aria-label="Send a PDF" /> }));

const spec = { size: 'A4', colour: 'COLOUR', sides: 'DOUBLE', gsm: 80, finish: 'NONE' } as const;
const ORDERS: PrintOrderRow[] = [
  { id: 'o1', kind: 'UPLOAD', title: 'Term 1 paper', quantity: 100, spec, status: 'PRINTING', neededBy: null, quote: { priceMinor: 2_500_00, promisedBy: '2026-09-10T00:00:00.000Z', note: null, quotedAt: '2026-09-02T00:00:00.000Z' }, createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'o2', kind: 'REPORT_CARDS', title: 'Report cards · Class 3–5', quantity: 240, spec: { ...spec, gsm: 130 }, status: 'QUOTED', neededBy: null, quote: { priceMinor: 9_600_00, promisedBy: '2026-09-20T00:00:00.000Z', note: null, quotedAt: '2026-09-05T00:00:00.000Z' }, createdAt: '2026-09-04T00:00:00.000Z' },
  { id: 'o3', kind: 'UPLOAD', title: 'Admission forms', quantity: 500, spec, status: 'DELIVERED', neededBy: null, quote: { priceMinor: 4_000_00, promisedBy: '2026-08-20T00:00:00.000Z', note: null, quotedAt: '2026-08-12T00:00:00.000Z' }, createdAt: '2026-08-10T00:00:00.000Z' },
];

function mockApi(get: (path: string) => unknown): ApiStub {
  return { get: vi.fn(async (p: string) => get(p)), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('the Print Store — a hub', () => {
  it('numbers from the order book, open orders as rows by default, done behind a chip, and three doors that say what the store is for', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(() => ORDERS));
    renderWithProviders(<PressOrdersPage />);

    await screen.findByRole('list', { name: 'Orders' });
    // Numbers.
    expect(screen.getByText('Printing now').closest('.sk-kpi')).toHaveTextContent('1');
    expect(screen.getByText('Waiting for your OK').closest('.sk-kpi')).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByText('Waiting for your OK').closest('.sk-kpi')).toHaveTextContent('₹9,600 quoted');
    expect(screen.getByText('Next delivery').closest('.sk-kpi')).toHaveTextContent('10 Sept 2026');
    expect(screen.getByText('Delivered').closest('.sk-kpi')).toHaveTextContent('₹4,000 in all');
    // Open by default: two rows, status and money in their own columns.
    let rows = within(screen.getByRole('list', { name: 'Orders' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Term 1 paper');
    expect(rows[0]).toHaveTextContent('Printing');
    expect(rows[0]).toHaveTextContent('₹2,500');
    expect(rows[1]).toHaveTextContent('Quote ready');
    // Done, then all.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    rows = within(screen.getByRole('list', { name: 'Orders' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Admission forms');
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(within(screen.getByRole('list', { name: 'Orders' })).getAllByRole('listitem')).toHaveLength(3);
    // The doors: no prices, every one says quote first; two open the upload drawer.
    const doors = document.querySelector('.sk-hubdoors') as HTMLElement;
    expect(within(doors).getByRole('link', { name: /Report cards/ })).toHaveAttribute('href', '/app/press/results');
    expect(doors.textContent).not.toMatch(/₹/);
    expect(doors.textContent?.match(/quote first/g)).toHaveLength(3);
    await user.click(within(doors).getByRole('button', { name: /Anything on paper/ }));
    expect(screen.getByRole('dialog', { name: 'Send a PDF' })).toBeInTheDocument();
  });

  it('with nothing ordered yet says what to do, in the list card, not a lone card in a void', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(() => []));
    renderWithProviders(<PressOrdersPage />);
    expect(await screen.findByText(/Nothing ordered yet/)).toBeInTheDocument();
    expect(screen.getByText('Printing now').closest('.sk-kpi')).toHaveTextContent('nothing on the press');
    expect(screen.getByRole('button', { name: /Send a PDF to print/ })).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { PressOverview } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import PressHomePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

const OVERVIEW: PressOverview = {
  windows: [{ id: 'w1', name: 'Term I', academicYearId: 'y1', academicYearName: '2026-27', startDate: '2026-06-01', endDate: '2026-09-30', resultDay: null }],
  windowId: 'w1',
  classes: [
    { id: 'c1', label: 'III-A', students: 27, issued: 27 },
    { id: 'c2', label: 'VII-B', students: 22, issued: 15 },
    { id: 'c3', label: 'X-A', students: 22, issued: 0 },
  ],
  register: { total: 684, lastSerial: 'REP/2026/0212' },
  certificates: { lastSerial: 'TC/2026/0041', thisYear: 9 },
  orders: { awaitingConfirm: 1, quotedTotalMinor: 180000, open: 3 },
};

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

describe('Reports & Documents — the paper desk', () => {
  it('three desks, each wearing a live fact from the overview', async () => {
    const api = mockApi({
      get: vi.fn().mockImplementation((path: string) =>
        path.startsWith('/manage/press/overview') ? Promise.resolve(OVERVIEW) : Promise.resolve([])),
    });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<PressHomePage />);

    // The Result Room tile counts only what the roster can hold (42 of 71).
    await waitFor(() => expect(screen.getByText('42 of 71 cards issued this term')).toBeInTheDocument());
    expect(screen.getByText(/last TC\/2026\/0041 · 9 this year/)).toBeInTheDocument();
    expect(screen.getByText(/684 documents/)).toBeInTheDocument();
    // Printing moved out — the page points at the Print Store, with the
    // waiting quote surfaced.
    expect(screen.getByRole('link', { name: 'Print Store' })).toHaveAttribute('href', '/app/press/orders');
    expect(screen.getByText(/1 quote waiting for you/)).toBeInTheDocument();
    // The old scoreboard is gone — one screen owns readiness, and it is not this one.
    expect(screen.queryByText(/Needs work/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Compile/)).not.toBeInTheDocument();
  });

  it('the counter finds a child and offers the certificate path with the admission no. carried along', async () => {
    const api = mockApi({
      get: vi.fn().mockImplementation((path: string) => {
        if (path.startsWith('/manage/press/overview')) return Promise.resolve(OVERVIEW);
        if (path.startsWith('/manage/press/students')) {
          return Promise.resolve([{ id: 's1', name: 'Aarav Sharma', admissionNo: 'RPS-0710', classLabel: 'VII-B', isActive: true }]);
        }
        if (path.startsWith('/manage/press/register')) return Promise.resolve({ items: [], nextCursor: null });
        return Promise.resolve([]);
      }),
    });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);

    renderWithProviders(<PressHomePage />);
    fireEvent.change(screen.getByPlaceholderText(/Type a child/), { target: { value: 'aarav' } });

    await waitFor(() => expect(screen.getByText('Aarav Sharma')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'New certificate' }))
      .toHaveAttribute('href', '/app/press/certificates?q=RPS-0710');
    expect(screen.getByRole('link', { name: 'Student 360' })).toHaveAttribute('href', '/app/students/s1');
  });
});

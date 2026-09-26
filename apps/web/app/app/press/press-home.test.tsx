import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    // Printing is the fourth door, wearing the waiting quote; the numbers row
    // carries it too, in amber.
    expect(screen.getByRole('link', { name: /^Print Store/ })).toHaveAttribute('href', '/app/press/orders');
    expect(screen.getAllByText(/1 quote waiting for you/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: /Print orders open/ })).toHaveAttribute('data-tone', 'warn');
    // The header's one action, and the numbers as links to their desks.
    expect(screen.getByRole('link', { name: 'Issue a certificate' })).toHaveAttribute('href', '/app/press/certificates');
    expect(screen.getByRole('link', { name: /Cards issued this term/ })).toHaveTextContent('42 of 71');
    expect(screen.getByRole('link', { name: /In the register/ })).toHaveTextContent('684');
    // The old scoreboard is gone — one screen owns readiness, and it is not this one.
    expect(screen.queryByText(/Needs work/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Compile/)).not.toBeInTheDocument();
  });

  it('lists the last documents issued, from the register', async () => {
    const api = mockApi({
      get: vi.fn().mockImplementation((path: string) => {
        if (path.startsWith('/manage/press/overview')) return Promise.resolve(OVERVIEW);
        if (path === '/manage/press/register') {
          return Promise.resolve({ items: [
            { id: 'r1', type: 'TC', serial: 'TC/2026/0041', studentId: 's9', studentName: 'Rajeshwari Balasubramanian', issuedAt: '2026-09-20T05:00:00.000Z', voidedAt: null },
            { id: 'r2', type: 'REPORT_CARD', serial: 'REP/2026/0212', studentId: 's8', studentName: 'Aarav Sharma', issuedAt: '2026-09-18T05:00:00.000Z', voidedAt: '2026-09-19T05:00:00.000Z' },
          ], nextCursor: null });
        }
        return Promise.resolve([]);
      }),
    });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    renderWithProviders(<PressHomePage />);
    const list = await screen.findByRole('list', { name: 'Recently issued' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('TC/2026/0041');
    expect(rows[0]).toHaveTextContent('Issued');
    expect(rows[1]).toHaveTextContent('Void');
    expect(screen.getByRole('link', { name: 'The register →' })).toHaveAttribute('href', '/app/press/register');
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

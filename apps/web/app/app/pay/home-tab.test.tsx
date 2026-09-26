import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import HomeTab, { payDayLabel } from './home-tab';
import { PAY_SECTIONS } from './nav-items';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/pay',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => params,
}));

function mockApi(get: (path: string) => unknown): ApiStub {
  return { get: vi.fn(async (p: string) => get(p)), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

const SETTINGS = {
  countryCode: 'IN', currency: 'INR', region: 'RJ', taxYearStartMonth: 4,
  pack: {
    label: 'India', version: 'IN-2026.09.22', rulesAsAt: '2026-09-22', regionLabel: 'State',
    regions: [{ code: 'RJ', name: 'Rajasthan' }],
    regimes: [{ key: 'NEW', label: 'New regime (default)', allows: { hra: false, s80c: false, s80d: false, homeLoanInterest: false } }],
    defaultRegime: 'NEW', payDueDay: 7, fnfWorkingDays: 2, unverified: [],
  },
  countries: ['IN'],
};

const READY = {
  setup: { countryCode: 'IN', gradeCount: 8, rosterSize: 73, onPay: 72, notOnPay: 1, ready: true },
  period: { year: 2026, month: 10 },
  run: { id: 'run1', status: 'DRAFT', headcount: 72, grossMinor: 2_736_000_00, deductionMinor: 214_530_00, netMinor: 2_521_470_00, employerCostMinor: 89_640_00 },
  cost: { estimated: false, headcount: 72, grossMinor: 2_736_000_00, deductionMinor: 214_530_00, netMinor: 2_521_470_00, employerCostMinor: 89_640_00, totalCostMinor: 2_825_640_00 },
  previousTotalMinor: 2_710_500_00,
  exceptions: [
    { kind: 'NO_BANK', count: 2, label: '2 people have no bank account', names: ['Aarav Mehta', 'Priya Nair'], goTo: 'people' },
    { kind: 'NO_PAY', count: 1, label: '1 person has no pay set', names: ['Kabir Singh'], goTo: 'people' },
  ],
  recent: [
    { id: 'r0', periodYear: 2026, periodMonth: 10, status: 'DRAFT', headcount: 72, grossMinor: 2_736_000_00, employerCostMinor: 89_640_00, netMinor: 2_521_470_00 },
    { id: 'r1', periodYear: 2026, periodMonth: 9, status: 'PAID', headcount: 71, grossMinor: 2_710_500_00, employerCostMinor: 88_000_00, netMinor: 2_500_000_00 },
    { id: 'r2', periodYear: 2026, periodMonth: 8, status: 'PAID', headcount: 70, grossMinor: 2_698_000_00, employerCostMinor: 87_500_00, netMinor: 2_490_000_00 },
  ],
};

const FRESH = {
  ...READY,
  setup: { countryCode: 'IN', gradeCount: 0, rosterSize: 73, onPay: 0, notOnPay: 73, ready: false },
  run: null, exceptions: [], recent: [], previousTotalMinor: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  params.delete('guide');
  try { localStorage.clear(); } catch { /* jsdom */ }
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
});

const api = (overview: unknown) => mockApi((p) => (p === '/payroll/settings' ? SETTINGS : p === '/payroll/overview' ? overview : []));

describe('the Pay home — a front page, not a working screen', () => {
  it('Home is the index and This month is its own tab; the guide chip is not a section', () => {
    expect(PAY_SECTIONS[0]).toEqual({ seg: '', label: 'Home' });
    expect(PAY_SECTIONS[1]).toEqual({ seg: 'month', label: 'This month' });
    expect(PAY_SECTIONS.map((s) => s.label)).not.toContain('How it works');
  });

  it('shows the month at a glance beside the guide poster, the doors, and the months already paid', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api(READY));
    renderWithProviders(<HomeTab base="/app/pay" />);

    await screen.findByRole('heading', { name: 'October 2026' });
    // The figure is what the month COSTS, and the poster is a control beside it.
    expect(screen.getByText('₹28,25,640')).toBeInTheDocument();
    const poster = screen.getByRole('button', { name: /How Pay works/ });
    expect(poster).toHaveAttribute('aria-expanded', 'false');
    // Three figures: on pay, what needs a person (summed across kinds), pay day of the FOLLOWING month.
    expect(screen.getByText('on pay').previousSibling).toHaveTextContent('72');
    expect(screen.getByText('need a person').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('pay day').previousSibling).toHaveTextContent('7 Nov');
    // The working screen is one door away, and the primary action opens it.
    expect(screen.getByRole('link', { name: 'Open October' })).toHaveAttribute('href', '/app/pay/month');
    expect(screen.getByRole('link', { name: /^This month/ })).toHaveAttribute('href', '/app/pay/month');
    expect(screen.getByRole('link', { name: /^People/ })).toHaveTextContent('72 on pay · 1 waiting');
    // Months paid: the current month is not "paid", so it is left out.
    const list = screen.getByRole('list', { name: 'Months paid' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('September 2026');
    expect(rows[0]).toHaveTextContent('Paid');
    // The guide is NOT on the page until asked for.
    expect(screen.queryByRole('region', { name: 'How Pay works' })).toBeNull();
  });

  it('opens the guide inline, right under the top row, from the poster', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api(READY));
    renderWithProviders(<HomeTab base="/app/pay" />);
    await screen.findByRole('heading', { name: 'October 2026' });
    await user.click(screen.getByRole('button', { name: /How Pay works/ }));
    const guide = await screen.findByRole('region', { name: 'How Pay works' });
    // Within a screen of the control: the guide comes straight after the top row, before the doors.
    const top = document.querySelector('.sk-payhome-top')!;
    expect(top.nextElementSibling!.contains(guide)).toBe(true);
    expect(screen.getByRole('button', { name: /How Pay works/ })).toHaveAttribute('aria-expanded', 'true');
    // Hide puts it away again.
    await user.click(within(guide).getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'How Pay works' })).toBeNull());
  });

  it('opens the guide when the tab strip’s chip sent ?guide=1', async () => {
    params.set('guide', '1');
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api(READY));
    renderWithProviders(<HomeTab base="/app/pay" />);
    expect(await screen.findByRole('region', { name: 'How Pay works' })).toBeInTheDocument();
  });

  it('before the first run the guide is open above the setup steps, and hiding it is remembered', async () => {
    const user = userEvent.setup({ delay: null });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api(FRESH));
    const first = renderWithProviders(<HomeTab base="/app/pay" />);
    expect(await screen.findByRole('region', { name: 'How Pay works' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Set up Pay' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Draft my grades' })).toHaveAttribute('href', '/app/pay/grades');
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    // Hidden: the wide poster takes its place, so the guide is one press away, not gone.
    expect(await screen.findByRole('button', { name: /How Pay works/ })).toHaveAttribute('data-hero', 'true');
    first.unmount();
    renderWithProviders(<HomeTab base="/app/pay" />);
    await screen.findByRole('heading', { name: 'Set up Pay' });
    expect(screen.queryByRole('region', { name: 'How Pay works' })).toBeNull();
  });
});

describe('pay day', () => {
  it('is the pack’s due day of the FOLLOWING month, and wraps the year', () => {
    expect(payDayLabel(2026, 10, 7)).toBe('7 Nov');
    expect(payDayLabel(2026, 12, 7)).toBe('7 Jan');
  });
});

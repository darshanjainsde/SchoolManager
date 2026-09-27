import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { MyPay } from './my-pay';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

/**
 * `/me/pay` is no longer the only call this screen makes: the details card
 * asks for `/me/pay/details` too. A path-agnostic stub handed it the payslip
 * payload, which has no `missing` array — and the whole screen crashed on it.
 * Route by path, so each call gets the shape its endpoint really returns.
 */
const DETAILS = {
  bankAccount: '30123456789', bankIfsc: 'SBIN0001234', bankName: 'State Bank of India',
  pan: 'ABCDE1234F', uan: '100123456789', esiNumber: null, onPay: true, missing: [],
};
function mockApi(get: (p: string) => unknown, post?: (p: string, b?: unknown) => unknown): ApiStub {
  return {
    get: vi.fn(async (p: string) => (p === '/me/pay/details' ? DETAILS : get(p))),
    post: vi.fn(async (p: string, b?: unknown) => post?.(p, b) ?? {}),
    put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
}

const SLIP = {
  id: 'ps1', name: 'Priya Nair', designation: 'Teacher',
  lines: [
    { key: 'basic', name: 'Basic', kind: 'EARNING', amountMinor: 2_000_000, order: 1 },
    { key: 'hra', name: 'House rent allowance', kind: 'EARNING', amountMinor: 800_000, order: 3 },
    { key: 'pf_employee', name: 'Provident fund', kind: 'DEDUCTION', amountMinor: 240_000, order: 100 },
    { key: 'pf_employer', name: 'Provident fund — school’s share', kind: 'EMPLOYER_COST', amountMinor: 240_000, order: 200 },
  ],
  daysInMonth: 30, daysPaid: 30,
  grossMinor: 4_000_000, deductionMinor: 240_000, netMinor: 3_760_000, employerCostMinor: 240_000,
  incomeTaxMinor: 0, ytdGrossMinor: 24_000_000, ytdTaxMinor: 0, taxRegime: 'NEW' as const,
  payRun: { periodYear: 2026, periodMonth: 9, status: 'LOCKED', paidAt: null },
};

const BASE = {
  currency: 'INR', personKind: 'TEACHER' as const, taxYear: 2026, taxYearLabel: '2026-27',
  regimes: [
    { key: 'NEW' as const, label: 'New regime (default)', allows: { hra: false, s80c: false, s80d: false, homeLoanInterest: false } },
    { key: 'OLD' as const, label: 'Old regime', allows: { hra: true, s80c: true, s80d: true, homeLoanInterest: true } },
  ],
  defaultRegime: 'NEW' as const, declaration: null, payslips: [SLIP], empty: false,
};

beforeEach(() => vi.mocked(useHost).mockReturnValue('school.sckools.com'));

describe('My pay', () => {
  it('leads with the number that reached the bank', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => BASE) as never);
    renderWithProviders(<MyPay />);
    expect(await screen.findByText('September 2026')).toBeInTheDocument();
    expect(screen.getByText('Paid to you')).toBeInTheDocument();
    expect(screen.getByText('₹37,600')).toBeInTheDocument();
  });

  it('shows what the school paid in on top, and says it is not out of the pay', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => BASE) as never);
    renderWithProviders(<MyPay />);
    expect(await screen.findByText('Your school also paid in')).toBeInTheDocument();
    expect(screen.getByText(/on top of your pay, not out of it/)).toBeInTheDocument();
  });

  it('a school that has not run pay yet gets a sentence, not an empty screen', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(() => ({ ...BASE, payslips: [], empty: true })) as never);
    renderWithProviders(<MyPay />);
    expect(await screen.findByText(/No payslip yet/)).toBeInTheDocument();
  });

  it('asks only for what the chosen regime actually uses', async () => {
    const user = userEvent.setup();
    vi.mocked(useApi).mockReturnValue(mockApi(() => BASE) as never);
    renderWithProviders(<MyPay />);
    // New regime: rent and 80C are worth nothing, so they are not asked for.
    expect(await screen.findByText(/rent and savings do not reduce the tax/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Rent paid this year (₹)')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Tax regime'), 'OLD');
    expect(screen.getByLabelText('Rent paid this year (₹)')).toBeInTheDocument();
    expect(screen.getByLabelText('Savings under 80C (₹)')).toBeInTheDocument();
  });

  it('sends the declaration for the right tax year', async () => {
    const user = userEvent.setup();
    const posts: { p: string; b: unknown }[] = [];
    vi.mocked(useApi).mockReturnValue(mockApi(() => BASE, (p, b) => { posts.push({ p, b }); return { id: 'd1', status: 'SUBMITTED' }; }) as never);
    renderWithProviders(<MyPay />);
    await user.click(await screen.findByRole('button', { name: 'Send to the office' }));
    expect(posts[0].p).toBe('/me/pay/declaration');
    expect(posts[0].b).toMatchObject({ taxYear: 2026, regime: 'NEW', submit: true });
  });

  it('lets a person set the bank account their pay goes to', async () => {
    // The same rows the office writes — no second copy, nothing to sync.
    const user = userEvent.setup();
    const sent: { path: string; body?: unknown }[] = [];
    vi.mocked(useApi).mockReturnValue(mockApi(() => BASE, (path, body) => { sent.push({ path, body }); return DETAILS; }) as never);
    renderWithProviders(<MyPay />);

    const acct = await screen.findByLabelText('Bank account number');
    await user.clear(acct);
    await user.type(acct, '30999888777');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const save = sent.find((x) => x.path === '/me/pay/details');
      expect(save).toBeTruthy();
      expect(save!.body).toMatchObject({ bankAccount: '30999888777' });
    });
  });

  it('will not save an account without its branch', async () => {
    const user = userEvent.setup();
    vi.mocked(useApi).mockReturnValue(mockApi(() => BASE) as never);
    renderWithProviders(<MyPay />);

    const ifsc = await screen.findByLabelText('IFSC');
    await user.clear(ifsc);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/needs its IFSC/)).toBeInTheDocument();
  });

  it('names what is still missing, rather than counting it', async () => {
    vi.mocked(useApi).mockReturnValue({
      get: vi.fn(async (p: string) => (p === '/me/pay/details'
        ? { ...DETAILS, bankAccount: null, bankIfsc: null, missing: ['a bank account number', 'the branch IFSC'] }
        : BASE)),
      post: vi.fn(async () => ({})), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
    } as never);
    renderWithProviders(<MyPay />);
    expect(await screen.findByText(/a bank account number, the branch IFSC/)).toBeInTheDocument();
  });
});

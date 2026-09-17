import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import type { StudentFees } from '@/lib/fees';
import PortalFeesPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const TERM = (over: Partial<StudentFees['schedule'][number]>): StudentFees['schedule'][number] => ({
  termId: 't', name: 'Term', dueDate: '2099-01-15', expectedMinor: 1880000, paidMinor: 0, dueMinor: 1880000,
  status: 'UPCOMING', invoiceId: null, receiptNumber: null, lines: [], ...over,
});

const BASE: StudentFees = {
  student: { id: 's1', name: 'Ved Banerjee', admissionNo: 'RAF-00218', className: 'Nursery-A' },
  account: { admissionNo: 'RAF-00218', className: 'Nursery-A', admittedOn: '2026-04-03', isRte: false },
  year: { id: 'y', name: '2026–27', startDate: '2026-04-01', endDate: '2027-03-31' },
  planReady: true,
  schedule: [
    TERM({ termId: 't1', name: 'Term 1', dueDate: '2026-07-15', status: 'PAID', paidMinor: 1880000, dueMinor: 0, invoiceId: 'i1', receiptNumber: 'RCP/2026/00311' }),
    TERM({ termId: 't2', name: 'Term 2', dueDate: '2099-10-15' }),
    TERM({ termId: 't3', name: 'Term 3', dueDate: '2099-01-15' }),
  ],
  nextDue: { termId: 't2', name: 'Term 2', dueDate: '2099-10-15', amountMinor: 1880000, billed: false, invoiceId: null, status: 'UPCOMING' },
  yearTotalMinor: 5640000, yearPaidMinor: 1880000,
  concessions: [{ reason: 'Sibling discount', scope: 'Tuition', percentBps: 1000, amountMinor: null }],
  balanceMinor: 0, billedMinor: 1880000, paidMinor: 1880000, lateFeeRule: null,
  invoices: [{ id: 'i1', number: 'INV/1', termName: 'Term 1', dueDate: '2026-07-15', totalMinor: 1880000, paidMinor: 1880000, principalDueMinor: 0, lateFeeMinor: 0, dueMinor: 0, isPaid: true, isOverdue: false, lines: [] }],
  payments: [{ id: 'p1', status: 'VERIFIED', method: 'UPI', amountMinor: 1880000, providerRef: '4418', paidOn: '2026-07-12', submittedAt: '2026-07-12T00:00:00Z', verifiedAt: '2026-07-12T00:00:00Z', rejectionReason: null, receiptNumber: 'RCP/2026/00311' }],
  ledger: [{ kind: 'DEBIT', amountMinor: 1880000, narration: 'Term 1 bill INV/1', occurredAt: '2026-07-01T00:00:00Z' }, { kind: 'CREDIT', amountMinor: 1880000, narration: 'Payment received — UPI', occurredAt: '2026-07-12T00:00:00Z' }],
};
const HOW = { options: [], canPayOnline: false, canPayByTransfer: true };

function stub(fees: StudentFees | Error): ApiStub {
  return {
    get: vi.fn((path: string) => {
      if (path === '/me/fees') return fees instanceof Error ? Promise.reject(fees) : Promise.resolve(fees);
      if (path === '/me/fees/how-to-pay') return Promise.resolve(HOW);
      return Promise.reject(new Error(`unexpected ${path}`));
    }),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  } as unknown as ApiStub;
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

describe('the family fees page', () => {
  it('fully paid: still a full page — account facts, the next instalment, the year, the receipt', async () => {
    vi.mocked(useApi).mockReturnValue(stub(BASE) as never);
    renderWithProviders(<PortalFeesPage />);
    expect(await screen.findByText('Ved Banerjee')).toBeInTheDocument();
    expect(screen.getByTestId('fees-head')).toHaveTextContent('Nursery-A · Adm. RAF-00218 · admitted 3 Apr 2026');
    expect(screen.getByText('Nothing due')).toBeInTheDocument();
    const next = screen.getByTestId('next-due');
    expect(within(next).getByText('Next instalment')).toBeInTheDocument();
    expect(within(next).getByText(/Term 2 · due 15 Oct 2099/)).toBeInTheDocument();
    expect(within(next).getByText('₹18,800')).toBeInTheDocument();
    const year = screen.getByTestId('fees-year');
    expect(within(year).getByText('₹56,400 · ₹18,800 paid')).toBeInTheDocument();
    expect(within(screen.getByTestId('term-t1')).getByText('Receipt RCP/2026/00311')).toBeInTheDocument();
    expect(within(screen.getByTestId('term-t3')).getByText('Later')).toBeInTheDocument();
    expect(within(year).getByText(/Sibling discount · 10% off Tuition/)).toBeInTheDocument();
    expect(screen.getByTestId('receipt-p1')).toHaveAttribute('href', '/portal/fees/receipt/p1');
    expect(screen.getByTestId('fees-statement')).toBeInTheDocument();
  });

  it('a class with no fee plan is told so — never "every bill is paid"', async () => {
    vi.mocked(useApi).mockReturnValue(stub({ ...BASE, planReady: false, schedule: [], nextDue: null, yearTotalMinor: 0, yearPaidMinor: 0, invoices: [], payments: [], ledger: [], billedMinor: 0, paidMinor: 0 }) as never);
    renderWithProviders(<PortalFeesPage />);
    expect(await screen.findByTestId('fees-empty')).toHaveTextContent('hasn’t set up fees for Nursery-A this year yet');
    expect(screen.queryByText(/every bill is paid/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('fees-year')).not.toBeInTheDocument();
  });

  it('a plan with nothing billed yet says so, and names the first instalment', async () => {
    vi.mocked(useApi).mockReturnValue(stub({
      ...BASE, invoices: [], payments: [], ledger: [], billedMinor: 0, paidMinor: 0, yearPaidMinor: 0,
      schedule: BASE.schedule.map((t) => TERM({ ...t, status: 'UPCOMING', paidMinor: 0, dueMinor: t.expectedMinor, invoiceId: null, receiptNumber: null })),
      nextDue: { termId: 't1', name: 'Term 1', dueDate: '2099-07-15', amountMinor: 1880000, billed: false, invoiceId: null, status: 'UPCOMING' },
    }) as never);
    renderWithProviders(<PortalFeesPage />);
    expect(await screen.findByTestId('fees-not-billed')).toHaveTextContent('No bill has been issued yet. Term 1 · ₹18,800 falls due 15 Jul 2099');
  });

  it('an overdue bill reads as overdue at the top and offers a jump to the bill', async () => {
    vi.mocked(useApi).mockReturnValue(stub({
      ...BASE, balanceMinor: 1880000,
      schedule: [BASE.schedule[0], TERM({ termId: 't2', name: 'Term 2', dueDate: '2020-10-15', status: 'OVERDUE', invoiceId: 'i2' }), BASE.schedule[2]],
      nextDue: { termId: 't2', name: 'Term 2', dueDate: '2020-10-15', amountMinor: 1880000, billed: true, invoiceId: 'i2', status: 'OVERDUE' },
      invoices: [...BASE.invoices, { id: 'i2', number: 'INV/2', termName: 'Term 2', dueDate: '2020-10-15', totalMinor: 1880000, paidMinor: 0, principalDueMinor: 1880000, lateFeeMinor: 0, dueMinor: 1880000, isPaid: false, isOverdue: true, lines: [{ categoryName: 'Tuition', categoryDescription: 'Classroom teaching', grossMinor: 1880000, concessionMinor: 0, netMinor: 1880000, concessionReason: null, isCollectible: true }] }],
    }) as never);
    renderWithProviders(<PortalFeesPage />);
    const next = await screen.findByTestId('next-due');
    expect(next).toHaveAttribute('data-status', 'OVERDUE');
    expect(within(next).getByText('Overdue')).toBeInTheDocument();
    expect(within(next).getByRole('link', { name: 'Go to the bill' })).toHaveAttribute('href', '#bill-i2');
    expect(screen.getByText('Owes')).toBeInTheDocument();
    expect(screen.getByText('Classroom teaching')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay by bank transfer' })).toBeInTheDocument();
  });
});

import { fireEvent, render, within } from '@testing-library/react-native';
import Fees from '../(tabs)/fees';
import { api, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn(), upload: jest.fn() } };
});

const INVOICE = {
  id: 'inv-1', number: 'INV/2026/0042', termName: 'Term 2', dueDate: '2026-08-30',
  totalMinor: 2450000, paidMinor: 0, principalDueMinor: 2450000, lateFeeMinor: 0, dueMinor: 2450000,
  isPaid: false, isOverdue: true,
  lines: [
    { categoryName: 'Tuition', categoryDescription: 'Classroom teaching, Jul–Sep', grossMinor: 1800000, concessionMinor: 0, netMinor: 1800000, concessionReason: null, isCollectible: true },
    { categoryName: 'Exam', categoryDescription: 'Question papers, answer sheets, results', grossMinor: 80000, concessionMinor: 0, netMinor: 80000, concessionReason: null, isCollectible: true },
  ],
};
const TERM = (o: Record<string, unknown>) => ({ termId: 't', name: 'Term', dueDate: '2099-01-15', expectedMinor: 2450000, paidMinor: 0, dueMinor: 2450000, status: 'UPCOMING', invoiceId: null, receiptNumber: null, lines: [], ...o });
const FEES = {
  student: { id: 's1', name: 'Saanvi Krishnamurthy', admissionNo: 'A1', className: '7-B' },
  account: { admissionNo: 'A1', className: '7-B', admittedOn: '2020-04-03', isRte: false },
  year: { id: 'y', name: '2026–27', startDate: '2026-04-01', endDate: '2027-03-31' },
  planReady: true,
  schedule: [
    TERM({ termId: 't1', name: 'Term 1', dueDate: '2026-07-15', status: 'PAID', paidMinor: 2390000, dueMinor: 0, invoiceId: 'i0', receiptNumber: 'RCP/2026/00311', expectedMinor: 2390000 }),
    TERM({ termId: 't2', name: 'Term 2', dueDate: '2026-08-30', status: 'OVERDUE', invoiceId: 'inv-1', lines: [{ categoryName: 'Tuition' }, { categoryName: 'Exam' }] }),
    TERM({ termId: 't3', name: 'Term 3', dueDate: '2099-01-15' }),
  ],
  nextDue: { termId: 't2', name: 'Term 2', dueDate: '2026-08-30', amountMinor: 2450000, billed: true, invoiceId: 'inv-1', status: 'OVERDUE' },
  yearTotalMinor: 7290000, yearPaidMinor: 2390000,
  concessions: [],
  balanceMinor: 2450000, billedMinor: 4840000, paidMinor: 2390000, lateFeeRule: null,
  invoices: [INVOICE],
  payments: [
    { id: 'p-ok', status: 'VERIFIED', method: 'UPI', amountMinor: 2390000, providerRef: '4418', paidOn: '2026-07-10', submittedAt: '2026-07-10T10:00:00Z', verifiedAt: '2026-07-12T10:00:00Z', rejectionReason: null, receiptNumber: 'RCP/2026/00311' },
  ],
  ledger: [],
};
const HOW = { options: [], canPayOnline: false, canPayByTransfer: true };

function mockEndpoints(over: Record<string, unknown> = {}) {
  const map: Record<string, unknown> = { '/me/fees': FEES, '/me/fees/how-to-pay': HOW, ...over };
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path in map) {
      const v = map[path];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

beforeEach(() => {
  clearCache();
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
});

describe('Fees', () => {
  it('leads with what is owed, in rupees, with the late rule and the bill lines', async () => {
    mockEndpoints();
    const { findByTestId, getByTestId, getByText } = render(<Fees />);
    // The figure and the bill's "Due now" both say ₹24,500 — read the figure by id.
    const owed = await findByTestId('fees-owed');
    expect(within(owed).getByText('₹24,500')).toBeTruthy();
    expect(within(owed).getByText('You owe')).toBeTruthy();
    expect(getByTestId('fees-late-rule')).toBeTruthy();
    expect(getByText('Question papers, answer sheets, results')).toBeTruthy();
    // The next card and the bill's pill both say Overdue — read the bill's.
    expect(within(getByTestId('invoice-inv-1')).getByText('Overdue')).toBeTruthy();
  });

  it('a confirmed payment carries the stamp with its receipt', async () => {
    mockEndpoints();
    const { findByTestId, getByText } = render(<Fees />);
    expect(await findByTestId('paid-stamp')).toBeTruthy();
    expect(getByText('RCP/2026/00311')).toBeTruthy();
  });

  it('a submitted payment shows the three-step wait', async () => {
    mockEndpoints({ '/me/fees': { ...FEES, payments: [{ ...FEES.payments[0], id: 'p-wait', status: 'SUBMITTED', receiptNumber: null, verifiedAt: null }] } });
    const { findByTestId, getByText } = render(<Fees />);
    // The pending card and the history row both wear the "Being checked" pill.
    const card = await findByTestId('fees-pending');
    expect(within(card).getByText('Being checked')).toBeTruthy();
    expect(getByText('Office is checking it')).toBeTruthy();
  });

  it('a rejected payment shows the reason word for word and offers Send again', async () => {
    mockEndpoints({ '/me/fees': { ...FEES, payments: [{ ...FEES.payments[0], id: 'p-no', status: 'REJECTED', receiptNumber: null, rejectionReason: 'Amount does not match the bill.' }] } });
    const { findByText, getByTestId } = render(<Fees />);
    expect(await findByText('Amount does not match the bill.')).toBeTruthy();
    expect(getByTestId('payment-p-no-again')).toBeTruthy();
  });

  it('Pay by bank transfer opens the pay sheet for that bill', async () => {
    mockEndpoints({ '/me/fees/bank-instructions?invoiceId=inv-1': { kind: 'INSTRUCTIONS', bank: { accountName: 'Saraswati Public School', accountNumber: '50100441288', ifsc: 'HDFC0001234', bankName: 'HDFC', branch: null, upiId: null, upiQrUrl: null, upiIntentUri: null, instructions: null } } });
    const { findByTestId, findByText } = render(<Fees />);
    fireEvent.press(await findByTestId('invoice-inv-1-pay'));
    expect(await findByTestId('pay-sheet')).toBeTruthy();
    expect(await findByText('50100441288')).toBeTruthy();
  });

  it('a school not on the module gets the designed refusal, not an error', async () => {
    mockEndpoints({ '/me/fees': new ApiError(403, 'Feature not enabled'), '/me/fees/how-to-pay': new ApiError(403, 'x') });
    const { findByText } = render(<Fees />);
    expect(await findByText('Fees are not part of your school’s plan yet.')).toBeTruthy();
  });

  it('nothing due is still a full page — the year, the next instalment, the account facts', async () => {
    mockEndpoints({ '/me/fees': {
      ...FEES, balanceMinor: 0, invoices: [{ ...INVOICE, isPaid: true, isOverdue: false, paidMinor: 2450000, dueMinor: 0 }],
      schedule: [FEES.schedule[0], TERM({ termId: 't2', name: 'Term 2', dueDate: '2026-08-30', status: 'PAID', paidMinor: 2450000, dueMinor: 0, invoiceId: 'inv-1' }), FEES.schedule[2]],
      nextDue: { termId: 't3', name: 'Term 3', dueDate: '2099-01-15', amountMinor: 2450000, billed: false, invoiceId: null, status: 'UPCOMING' },
    } });
    const { findByText, getByTestId, getByText } = render(<Fees />);
    expect(await findByText('Nothing due')).toBeTruthy();
    expect(getByTestId('fees-account').props.children.join('')).toContain('admitted');
    expect(within(getByTestId('fees-year')).getByText('₹72,900')).toBeTruthy();
    expect(within(getByTestId('fees-next')).getByText('Next instalment')).toBeTruthy();
    expect(within(getByTestId('fees-next')).getByText(/bill not issued yet/)).toBeTruthy();
    expect(getByTestId('fees-schedule')).toBeTruthy();
    expect(getByText('Term 3 · ₹24,500')).toBeTruthy();
    expect(within(getByTestId('term-t1')).getByText('Paid')).toBeTruthy();
  });

  it('a class with no fee plan is told so — never "every bill is paid"', async () => {
    mockEndpoints({ '/me/fees': { ...FEES, planReady: false, schedule: [], nextDue: null, yearTotalMinor: 0, yearPaidMinor: 0, balanceMinor: 0, invoices: [], payments: [], billedMinor: 0, paidMinor: 0 } });
    const { findByText, queryByText, queryByTestId } = render(<Fees />);
    expect(await findByText(/hasn’t set up fees for 7-B this year yet/)).toBeTruthy();
    expect(queryByText(/every bill is paid/i)).toBeNull();
    expect(queryByTestId('fees-schedule')).toBeNull();
  });

  it('the overdue instalment is the amber-turned-red card with Pay on it', async () => {
    mockEndpoints();
    const { findByTestId } = render(<Fees />);
    const next = await findByTestId('fees-next');
    expect(within(next).getByText('Overdue')).toBeTruthy();
    expect(within(next).getByTestId('fees-next-pay')).toBeTruthy();
  });

  it('a confirmed payment opens its receipt', async () => {
    mockEndpoints();
    const { findByTestId } = render(<Fees />);
    fireEvent.press(await findByTestId('payment-p-ok-receipt'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/receipt/p-ok');
  });

  it('no signal gets a Try again, never a bare red sentence', async () => {
    mockEndpoints({ '/me/fees': new ApiError(0, 'Could not reach the school server.') });
    const { findByText, getByTestId } = render(<Fees />);
    expect(await findByText('No signal right now.')).toBeTruthy();
    expect(getByTestId('error-state-retry')).toBeTruthy();
  });
});

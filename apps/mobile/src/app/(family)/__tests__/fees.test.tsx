import { render, fireEvent } from '@testing-library/react-native';
import Fees from '../(tabs)/home/fees';
import Receipt from '../(tabs)/home/fees/[paymentId]';
import { api, ApiError } from '@/lib/api';

// `mock`-prefixed: jest hoists mock factories above every other statement, so a
// factory may only reference variables whose names start with `mock`.
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
  router: { push: (...a: unknown[]) => mockPush(...a) },
  useLocalSearchParams: () => ({ paymentId: 'pay-1' }),
}));

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn(), upload: jest.fn() } };
});

const FEES = {
  student: { id: 's1', name: 'Aarav Sharma', admissionNo: 'A-1024', className: 'VIII-B' },
  balanceMinor: 105_000,
  billedMinor: 1_345_000,
  paidMinor: 1_240_000,
  lateFeeRule: '₹50 per day past the due date after 7 grace days, up to ₹1,000',
  invoices: [{
    id: 'i1', number: 'INV/2026/00311', termName: 'Term 2', dueDate: '2026-08-15',
    totalMinor: 100_000, paidMinor: 0, principalDueMinor: 100_000,
    lateFeeMinor: 5_000, dueMinor: 105_000, isPaid: false, isOverdue: true,
    lines: [
      {
        categoryName: 'Tuition', categoryDescription: 'Term tuition',
        grossMinor: 120_000, concessionMinor: 20_000, netMinor: 100_000,
        concessionReason: 'Sibling concession', isCollectible: true,
      },
    ],
  }],
  payments: [
    {
      id: 'pay-1', status: 'VERIFIED', method: 'NEFT_IMPS', amountMinor: 1_240_000,
      providerRef: 'N123', paidOn: '2026-08-28', submittedAt: '2026-08-28T06:00:00.000Z',
      verifiedAt: '2026-08-29T04:30:00.000Z', rejectionReason: null,
      ackNote: 'Received by NEFT on 28 Aug. Thank you.', receiptNumber: 'RCP/2026/00042',
    },
    {
      id: 'pay-2', status: 'SUBMITTED', method: 'UPI', amountMinor: 50_000,
      providerRef: null, paidOn: '2026-08-30', submittedAt: '2026-08-30T06:00:00.000Z',
      verifiedAt: null, rejectionReason: null, ackNote: null, receiptNumber: null,
    },
  ],
  ledger: [],
};

const HOW = { options: [], canPayOnline: false, canPayByTransfer: true };

function mockFees() {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/me/fees') return Promise.resolve(FEES);
    if (path === '/me/fees/how-to-pay') return Promise.resolve(HOW);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
  mockPush.mockReset();
});

describe('the family fees screen', () => {
  it('leads with the balance and says what the late fee rule is before it costs anything', async () => {
    mockFees();
    const { findByText, findByTestId } = render(<Fees />);
    expect(await findByText('You owe')).toBeTruthy();
    // By testID, not by text: the outstanding bill happens to be the same
    // ₹1,050, and matching on the string finds both.
    expect(await findByTestId('fees-balance-amount')).toHaveTextContent('₹1,050');
    expect(await findByText(/₹50 per day past the due date/)).toBeTruthy();
  });

  it('breaks a bill down to the words the school wrote, and never hides the late fee inside the total', async () => {
    mockFees();
    const { findByText, findByTestId } = render(<Fees />);
    fireEvent.press(await findByTestId('fee-bill-toggle-i1'));

    expect(await findByText('Tuition')).toBeTruthy();
    // The sentence from setup — "Exam ₹800" starts an argument; this ends one.
    expect(await findByText('Term tuition')).toBeTruthy();
    expect(await findByText('−₹200 · Sibling concession')).toBeTruthy();
    // Its OWN line, not folded into "due ₹1,050".
    expect(await findByText('incl. ₹50 late fee')).toBeTruthy();
  });

  it('shows the school’s acknowledgement verbatim and opens the receipt behind it', async () => {
    mockFees();
    const { findByText, findByTestId } = render(<Fees />);
    expect(await findByText('“Received by NEFT on 28 Aug. Thank you.”')).toBeTruthy();
    expect(await findByText('Receipt RCP/2026/00042 ›')).toBeTruthy();

    fireEvent.press(await findByTestId('fee-payment-pay-1'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/fees/pay-1');
  });

  it('offers no receipt for a payment still being checked — the document does not exist yet', async () => {
    mockFees();
    const { findByText, queryByText, findByTestId } = render(<Fees />);
    expect(await findByText('Being checked')).toBeTruthy();
    await findByTestId('fee-payment-pay-2');
    expect(queryByText('Receipt null ›')).toBeNull();

    // Tapping a pending payment must not navigate anywhere.
    fireEvent.press(await findByTestId('fee-payment-pay-2'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('says the school has not bought Fees rather than showing an error', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(403, 'Forbidden'));
    const { findByText } = render(<Fees />);
    expect(await findByText('Fees are not part of your school’s plan yet.')).toBeTruthy();
  });
});

describe('the receipt', () => {
  const DOC = {
    receiptNumber: 'RCP/2026/00042',
    issuedAt: '2026-08-29T04:30:00.000Z',
    school: {
      name: 'Raffles Public School',
      addressLines: ['12 MG Road', 'Bengaluru Karnataka 560038'],
      phone: '+91 80 4000 1234', email: 'office@raffles.test',
    },
    student: { name: 'Aarav Sharma', admissionNo: 'A-1024', className: 'VIII-B' },
    payment: {
      id: 'pay-1', amountMinor: 1_300_000, method: 'NEFT_IMPS', providerRef: 'N123',
      paidOn: '2026-08-28', verifiedAt: '2026-08-29T04:30:00.000Z',
      ackNote: 'Received by NEFT on 28 Aug. Thank you.',
    },
    allocations: [
      { invoiceNumber: 'INV/2026/00311', termName: 'Term 2', categoryName: 'Tuition', amountMinor: 1_000_000 },
      { invoiceNumber: 'INV/2026/00311', termName: 'Term 2', categoryName: 'Transport', amountMinor: 240_000 },
    ],
    unallocatedMinor: 60_000,
  };

  it('names what the money cleared, and totals to what was received', async () => {
    (api.request as jest.Mock).mockResolvedValue(DOC);
    const { findByText, findByTestId } = render(<Receipt />);

    expect(await findByText('Raffles Public School')).toBeTruthy();
    expect(await findByText('RCP/2026/00042')).toBeTruthy();
    expect(await findByText('Tuition')).toBeTruthy();
    expect(await findByText('Transport')).toBeTruthy();
    // The advance is SHOWN, not dropped — otherwise the lines would not add up
    // to the amount received and the family could not tell where ₹600 went.
    expect(await findByText('Advance held against future bills')).toBeTruthy();
    expect(await findByTestId('fee-receipt-total')).toHaveTextContent('₹13,000');
    expect(await findByText('Received by NEFT on 28 Aug. Thank you.')).toBeTruthy();
  });

  it('explains a missing receipt instead of reading like a crash', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(404, 'Receipt not found'));
    const { findByText } = render(<Receipt />);
    expect(await findByText(/No receipt has been issued for this payment yet/)).toBeTruthy();
  });
});

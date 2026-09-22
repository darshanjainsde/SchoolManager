import { render, screen, fireEvent } from '@testing-library/react-native';
import { MyPay, rupees } from '@/components/MyPay';
import { ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
const mockFetch = jest.fn();
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: (...a: unknown[]) => mockFetch(...a) } };
});

const line = (key: string, name: string, kind: string, amountMinor: number, order: number) => ({ key, name, kind, amountMinor, order });
const SLIP = {
  id: 'ps1', name: 'Priya Nair', designation: 'Teacher',
  lines: [
    line('basic', 'Basic', 'EARNING', 2_000_000, 1),
    line('hra', 'House rent allowance', 'EARNING', 800_000, 3),
    line('pf_employee', 'Provident fund', 'DEDUCTION', 240_000, 100),
    line('pf_employer', 'Provident fund — school’s share', 'EMPLOYER_COST', 240_000, 200),
  ],
  daysInMonth: 30, daysPaid: 30,
  grossMinor: 4_000_000, deductionMinor: 240_000, netMinor: 3_760_000, employerCostMinor: 240_000,
  incomeTaxMinor: 0, ytdGrossMinor: 24_000_000, ytdTaxMinor: 0, taxRegime: 'NEW',
  payRun: { periodYear: 2026, periodMonth: 9, status: 'LOCKED', paidAt: null },
};
const OLDER = { ...SLIP, id: 'ps0', netMinor: 3_700_000, payRun: { ...SLIP.payRun, periodMonth: 8 } };
const PAYLOAD = {
  currency: 'INR', personKind: 'TEACHER', taxYear: 2026, taxYearLabel: '2026-27',
  regimes: [{ key: 'NEW', label: 'New regime' }], defaultRegime: 'NEW',
  declaration: null, payslips: [SLIP, OLDER], empty: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  mockFetch.mockResolvedValue(PAYLOAD);
});

describe('rupees', () => {
  it('groups the Indian way and keeps paise only when there are any', () => {
    expect(rupees(4_000_000)).toBe('₹40,000');
    expect(rupees(9_955)).toBe('₹99.55');
    expect(rupees(-50_000)).toBe('−₹500');
  });
});

describe('My pay', () => {
  it('opens on the newest month and leads with what reached the bank', async () => {
    render(<MyPay />);
    // A Figure with no onPress is a figure, not a button, so it carries no
    // accessibility label — read the text it draws instead.
    expect(await screen.findByTestId('pay-net')).toHaveTextContent(/₹37,600/);
    expect(screen.getByTestId('pay-net')).toHaveTextContent(/September 2026/);
  });

  it('shows what the school paid in on top, and says it is not out of the pay', async () => {
    render(<MyPay />);
    expect(await screen.findByTestId('pay-employer')).toBeTruthy();
    expect(screen.getByText(/on top of your pay, not out of it/)).toBeTruthy();
  });

  it('a school without the module gets a sentence, not a red error', async () => {
    mockFetch.mockRejectedValue(new ApiError(403, 'no'));
    render(<MyPay />);
    expect(await screen.findByText(/does not keep pay in Sckools yet/)).toBeTruthy();
  });

  it('a school that has not run pay yet gets its own sentence', async () => {
    mockFetch.mockResolvedValue({ ...PAYLOAD, payslips: [], empty: true });
    render(<MyPay />);
    expect(await screen.findByText(/No payslip yet/)).toBeTruthy();
  });

  it('an earlier month opens when tapped', async () => {
    render(<MyPay />);
    fireEvent.press(await screen.findByTestId('payslip-ps0'));
    expect(screen.getByTestId('pay-net')).toHaveTextContent(/₹37,000/);
    expect(screen.getByTestId('pay-net')).toHaveTextContent(/August 2026/);
  });
});

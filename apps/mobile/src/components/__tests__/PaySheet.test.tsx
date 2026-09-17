import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { PaySheet } from '../PaySheet';
import { api, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-router', () => ({
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

const BANK = {
  kind: 'INSTRUCTIONS',
  bank: { accountName: 'Saraswati Public School', accountNumber: '50100441288', ifsc: 'HDFC0001234', bankName: 'HDFC', branch: 'Malviya Nagar', upiId: 'saraswati@hdfcbank', upiQrUrl: null, upiIntentUri: 'upi://pay?pa=saraswati@hdfcbank&am=24500', instructions: null },
};

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
  (api.upload as jest.Mock).mockReset();
  (api.request as jest.Mock).mockResolvedValue(BANK);
});

describe('PaySheet', () => {
  it('shows the bank details and opens a UPI app with the amount filled in', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { findByTestId, getByText } = render(<PaySheet open onClose={() => {}} invoiceId="inv-1" dueMinor={2450000} onSubmitted={() => {}} />);
    expect(await findByTestId('pay-bank-details')).toBeTruthy();
    expect(getByText('saraswati@hdfcbank')).toBeTruthy();
    fireEvent.press(getByText('Open in a UPI app — ₹24,500'));
    expect(open).toHaveBeenCalledWith('upi://pay?pa=saraswati@hdfcbank&am=24500');
  });

  it('the claim goes up as multipart with the amount in paise and the ignored student id', async () => {
    (api.upload as jest.Mock).mockResolvedValue({ id: 'p1' });
    const onSubmitted = jest.fn();
    const { findByTestId, getByTestId } = render(<PaySheet open onClose={() => {}} invoiceId="inv-1" dueMinor={2450000} onSubmitted={onSubmitted} />);
    fireEvent.press(await findByTestId('pay-tell'));
    fireEvent.changeText(getByTestId('claim-reference'), '441822901234');
    fireEvent.press(getByTestId('claim-send'));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    const [path, form] = (api.upload as jest.Mock).mock.calls[0] as [string, FormData];
    expect(path).toBe('/me/fees/submit');
    // Under jest-expo FormData is the web one (get); on a device it is RN's (_parts). Read either.
    const rn = (form as unknown as { _parts?: [string, unknown][] })._parts;
    const get = (k: string) => (rn ? rn.find(([key]) => key === k)?.[1] : (form as unknown as { get: (k: string) => unknown }).get(k));
    expect(get('studentId')).toBe('00000000-0000-0000-0000-000000000000');
    expect(get('invoiceId')).toBe('inv-1');
    expect(get('amountMinor')).toBe('2450000');
    expect(get('method')).toBe('UPI');
    expect(get('reference')).toBe('441822901234');
  });

  it('the same transfer told twice is a fact, not a failure; no signal keeps the form', async () => {
    (api.upload as jest.Mock).mockRejectedValueOnce(new ApiError(409, 'Duplicate reference'));
    const { findByTestId, getByTestId, findByText } = render(<PaySheet open onClose={() => {}} invoiceId="inv-1" dueMinor={100} onSubmitted={() => {}} />);
    fireEvent.press(await findByTestId('pay-tell'));
    fireEvent.press(getByTestId('claim-send'));
    expect(await findByText('You’ve already told the school about this payment.')).toBeTruthy();
    (api.upload as jest.Mock).mockRejectedValueOnce(new ApiError(0, 'Could not reach the school server.'));
    fireEvent.changeText(getByTestId('claim-reference'), 'KEEPME');
    fireEvent.press(getByTestId('claim-send'));
    expect(await findByText(/No signal right now/)).toBeTruthy();
    expect(getByTestId('claim-reference').props.value).toBe('KEEPME');
  });
});

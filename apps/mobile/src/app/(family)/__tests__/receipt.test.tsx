import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Receipt from '../(tabs)/home/receipt/[paymentId]';
import { api } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ paymentId: 'p-ok' }),
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const R = {
  number: 'RCP/2026/00311', issuedAt: '2026-07-12T10:00:00Z', amountMinor: 1880000, method: 'UPI', providerRef: '4418',
  paidOn: '2026-07-12', verifiedAt: '2026-07-12T10:00:00Z', termName: 'Term 1', invoiceNumber: 'INV/2026/0042',
  student: { name: 'Ved Banerjee', admissionNo: 'RAF-00218', className: 'Nursery-A' }, school: { name: 'Saraswati Public School' },
};

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
});

it('draws the receipt and shares the same document as a PDF', async () => {
  (api.request as jest.Mock).mockResolvedValue(R);
  (Print.printToFileAsync as jest.Mock).mockResolvedValue({ uri: 'file:///tmp/r.pdf' });
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
  const { findByTestId, getByText } = render(<Receipt />);
  expect(await findByTestId('receipt')).toBeTruthy();
  expect(getByText('₹18,800')).toBeTruthy();
  expect(getByText('RCP/2026/00311')).toBeTruthy();
  expect(getByText(/Term 1 · INV\/2026\/0042/)).toBeTruthy();
  fireEvent.press(await findByTestId('receipt-share'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///tmp/r.pdf', expect.objectContaining({ mimeType: 'application/pdf' })));
  const html = (Print.printToFileAsync as jest.Mock).mock.calls[0][0].html as string;
  expect(html).toContain('RCP/2026/00311');
  expect(html).toContain('Ved Banerjee');
});

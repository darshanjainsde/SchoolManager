import { render } from '@testing-library/react-native';
import { LibraryShelf } from '../LibraryShelf';
import { api, ApiError } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const SHELF = {
  kind: 'STUDENT', limit: 3, loanDays: 14, finesEnabled: true, rules: { finePerDayRupees: 5, graceDays: 1, lostFeeRupees: 120 },
  holdings: [
    { issueId: 'i1', title: 'Malgudi Days', author: 'R. K. Narayan', accessionNo: 'A100', issuedOn: '2026-09-06', dueOn: '2026-09-20', daysLeft: 3, accruedFineRupees: 0 },
    { issueId: 'i2', title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', accessionNo: 'A101', issuedOn: '2026-08-01', dueOn: '2026-08-15', daysLeft: -33, accruedFineRupees: 66 },
  ],
  history: [{ issueId: 'h1', title: 'Swami and Friends', author: null, returnedOn: '2026-09-02', wasLost: false }],
  fines: [], finesDueRupees: 66, today: '2026-09-17',
};

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
});

describe('LibraryShelf', () => {
  it('lists the books out, due-soon in amber and late in red, with the fine so far', async () => {
    (api.request as jest.Mock).mockResolvedValue(SHELF);
    const { findByText, getByText, getAllByText, getByTestId } = render(<LibraryShelf />);
    expect(await findByText('Malgudi Days')).toBeTruthy();
    // The "Next due" figure and the row's pill both say 3 days.
    expect(getAllByText('3 days').length).toBe(2);
    expect(getByText('33 days late')).toBeTruthy();
    expect(getByText(/₹66 so far/)).toBeTruthy();
    expect(getByTestId('library-fine')).toBeTruthy();
    expect(getByText('Swami and Friends')).toBeTruthy();
  });

  it('a school without the library gets a quiet page', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(403, 'Feature not enabled'));
    const { findByText } = render(<LibraryShelf />);
    expect(await findByText('The library isn’t switched on for your school yet.')).toBeTruthy();
  });
});
